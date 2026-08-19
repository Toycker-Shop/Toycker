import "server-only"

import { EasebuzzCallbackPayload } from "@/lib/easebuzz"
import { createAdminClient } from "@/lib/supabase/admin"
import { Address, Cart, Order } from "@/lib/supabase/types"
import { retrieveCart, handlePostOrderLogic } from "@/lib/data/cart"
import {
  currencyAmountsMatch,
  getPartialPaymentSessionData,
  getOrderPricingMetadata,
  getPendingPaymentProviderId,
  OrderPricingMetadata,
} from "@/lib/util/order-pricing"
import { getCustomerFacingEmail } from "@/lib/util/customer-email"
import { sendGa4PurchaseEventForOrderId } from "@/lib/integrations/ga4"
import { sendMetaPurchaseEvent } from "@/lib/integrations/meta-capi"

const EASEBUZZ_PROVIDER_ID = "pp_easebuzz_easebuzz"
const EASEBUZZ_PARTIAL_PROVIDER_ID = "pp_easebuzz_partial_payment"

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

type CreateOrderWithPaymentResponse = {
  success?: boolean
  order_id?: string
}

type EasebuzzOrderSnapshot = {
  email: string
  shippingAddress: Address
  billingAddress: Address
  paymentProviderId: string
  rewardsToApply: number
}

export type EasebuzzPaymentProcessingResult =
  | {
      kind: "success"
      orderId: string
      paymentStatus: "captured" | "partially_paid"
      alreadyProcessed: boolean
    }
  | {
      kind: "failure"
      status: string
      reason: string
      orderId?: string
      processed: boolean
    }
  | {
      kind: "ignored"
      status: string
      reason: string
      orderId?: string
    }

const SAFE_PAYLOAD_FIELDS = [
  "status",
  "txnid",
  "amount",
  "productinfo",
  "firstname",
  "email",
  "key",
  "udf1",
  "udf2",
  "udf3",
  "udf4",
  "udf5",
  "easepayid",
  "phone",
  "mode",
  "net_amount_debit",
  "payment_source",
  "pg_type",
  "cardCategory",
  "bank_ref_num",
  "bankcode",
  "addedon",
  "error",
  "error_Message",
] as const

function sanitizeEasebuzzPayload(
  payload: EasebuzzCallbackPayload
): Partial<EasebuzzCallbackPayload> {
  const safePayload: Record<string, string> = {}

  for (const field of SAFE_PAYLOAD_FIELDS) {
    const value = payload[field]
    if (typeof value === "string") {
      safePayload[field] = value
    }
  }

  return safePayload as Partial<EasebuzzCallbackPayload>
}

const buildEasebuzzOrderSnapshot = (
  cart: Cart,
  fallbackEmail: string
): EasebuzzOrderSnapshot | null => {
  const shippingAddress = cart.shipping_address
  const billingAddress = cart.billing_address ?? cart.shipping_address

  if (!shippingAddress || !billingAddress) {
    return null
  }

  const rewardsToApplyFromMetadata =
    typeof cart.metadata?.rewards_to_apply === "number"
      ? cart.metadata.rewards_to_apply
      : Number(cart.rewards_to_apply ?? 0)

  return {
    email:
      getCustomerFacingEmail(fallbackEmail, cart.email) || "guest@toycker.in",
    shippingAddress,
    billingAddress,
    paymentProviderId:
      getPendingPaymentProviderId(cart.payment_collection) ||
      EASEBUZZ_PROVIDER_ID,
    rewardsToApply: Number.isFinite(rewardsToApplyFromMetadata)
      ? rewardsToApplyFromMetadata
      : 0,
  }
}

const fetchLatestOrderForCart = async (
  supabase: AdminClient,
  cartId: string
): Promise<Order | null> => {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .contains("metadata", { cart_id: cartId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data ? (data as Order) : null
}

const fetchLatestOrderForEasebuzzPayment = async (
  supabase: AdminClient,
  params: { cartId: string; txnid: string }
): Promise<Order | null> => {
  if (params.txnid) {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .contains("payment_collection", {
        payment_sessions: [
          {
            data: {
              txnid: params.txnid,
            },
          },
        ],
      })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (data) {
      return data as Order
    }
  }

  return params.cartId
    ? fetchLatestOrderForCart(supabase, params.cartId)
    : null
}

const refreshPendingOrderSnapshot = async (
  supabase: AdminClient,
  cartId: string,
  snapshot: EasebuzzOrderSnapshot
): Promise<Order> => {
  const { data, error } = await supabase.rpc("create_order_with_payment", {
    p_cart_id: cartId,
    p_email: snapshot.email,
    p_shipping_address: snapshot.shippingAddress,
    p_billing_address: snapshot.billingAddress,
    p_payment_provider: snapshot.paymentProviderId,
    p_rewards_to_apply: snapshot.rewardsToApply,
  })

  if (error) {
    throw new Error(error.message)
  }

  const result = data as CreateOrderWithPaymentResponse | null
  if (!result?.order_id) {
    throw new Error("create_order_with_payment did not return an order id")
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", result.order_id)
    .single()

  if (orderError || !order) {
    throw new Error(orderError?.message || "Failed to load refreshed order")
  }

  return order as Order
}

const mergeEasebuzzMetadata = (
  metadata: unknown,
  payload: EasebuzzCallbackPayload,
  paymentMethod: string,
  partialPaymentData: ReturnType<typeof getPartialPaymentSessionData>
): OrderPricingMetadata => {
  const baseMetadata = {
    ...getOrderPricingMetadata(metadata),
    easebuzz_payload: sanitizeEasebuzzPayload(payload),
    payment_method: paymentMethod,
  }

  if (!partialPaymentData) {
    return {
      ...baseMetadata,
      payment_type: "full",
    }
  }

  return {
    ...baseMetadata,
    payment_type: "partial",
    advance_percentage: partialPaymentData.advance_percentage,
    advance_amount: partialPaymentData.advance_amount,
    balance_amount: partialPaymentData.balance_amount,
    full_order_amount: partialPaymentData.full_order_amount,
    partial_payment_rule_id: partialPaymentData.partial_payment_rule_id ?? null,
    partial_payment_rule_min_order_amount:
      partialPaymentData.partial_payment_rule_min_order_amount ?? null,
    partial_payment_rule_max_order_amount:
      partialPaymentData.partial_payment_rule_max_order_amount ?? null,
    balance_payment_status: "pending",
  }
}

const isPaidPaymentStatus = (status: string | null | undefined): boolean =>
  status === "captured" || status === "partially_paid" || status === "paid"

const definitiveFailureStatuses = new Set([
  "failure",
  "userCancelled",
  "dropped",
  "bounced",
  "failed",
])

export async function processEasebuzzPayment(
  payload: EasebuzzCallbackPayload
): Promise<EasebuzzPaymentProcessingResult> {
  const status = String(payload.status || "").trim()
  const cartId = payload.udf1 || ""
  const txnid = payload.txnid || ""
  const easepayid = payload.easepayid || txnid
  const amount = payload.amount || ""

  if (status === "success") {
    const supabase = await createAdminClient()
    const cart = cartId ? await retrieveCart(cartId) : null

    if (!cart) {
      throw new Error(`Easebuzz cart not found: ${cartId || "missing cart id"}`)
    }

    const snapshot = buildEasebuzzOrderSnapshot(cart, payload.email || "")
    let orderToFinalize = await fetchLatestOrderForEasebuzzPayment(
      supabase,
      { cartId, txnid }
    )

    const shouldRefreshPendingSnapshot =
      !orderToFinalize ||
      (orderToFinalize.payment_status !== "captured" &&
        !orderToFinalize.payment_method)

    if (shouldRefreshPendingSnapshot) {
      if (!snapshot) {
        throw new Error(`Easebuzz checkout snapshot missing for cart: ${cartId}`)
      }

      orderToFinalize = await refreshPendingOrderSnapshot(
        supabase,
        cartId,
        snapshot
      )
    }

    if (!orderToFinalize) {
      throw new Error(`Easebuzz order not found for transaction: ${txnid}`)
    }

    const paymentMethod =
      snapshot?.paymentProviderId ||
      orderToFinalize.payment_method ||
      EASEBUZZ_PROVIDER_ID
    const isPartialPayment = paymentMethod === EASEBUZZ_PARTIAL_PROVIDER_ID
    const partialPaymentData = isPartialPayment
      ? getPartialPaymentSessionData(
          orderToFinalize.payment_collection,
          EASEBUZZ_PARTIAL_PROVIDER_ID
        )
      : null

    if (isPartialPayment && !partialPaymentData) {
      throw new Error(
        `Easebuzz partial-payment data missing for order: ${orderToFinalize.id}`
      )
    }

    const orderAlreadyCaptured = isPaidPaymentStatus(
      orderToFinalize.payment_status
    )
    const existingMetadata = getOrderPricingMetadata(orderToFinalize.metadata)
    const expectedPaymentAmount =
      partialPaymentData?.advance_amount ?? orderToFinalize.total_amount

    if (
      !orderAlreadyCaptured &&
      !currencyAmountsMatch(expectedPaymentAmount, amount)
    ) {
      const { logOrderEvent } = await import("@/lib/data/admin")
      await logOrderEvent(
        orderToFinalize.id,
        "note_added",
        "Payment Amount Mismatch",
        `Easebuzz amount ${amount} did not match expected payment amount ${expectedPaymentAmount}.`,
        "system"
      )
      throw new Error(`Easebuzz amount mismatch for order: ${orderToFinalize.id}`)
    }

    const shouldUpdateGatewayDetails =
      !orderAlreadyCaptured ||
      !orderToFinalize.gateway_txn_id ||
      !orderToFinalize.payment_method ||
      !existingMetadata.easebuzz_payload

    let finalizedOrderData = orderToFinalize
    let newlyProcessed = false

    if (shouldUpdateGatewayDetails) {
      const metadata = mergeEasebuzzMetadata(
        orderToFinalize.metadata,
        payload,
        paymentMethod,
        partialPaymentData
      )

      const { data: updatedOrder, error: updateError } = await supabase
        .from("orders")
        .update({
          status: "order_placed",
          payment_status: isPartialPayment ? "partially_paid" : "captured",
          payment_method: paymentMethod,
          gateway_txn_id: orderAlreadyCaptured
            ? orderToFinalize.gateway_txn_id || easepayid
            : easepayid,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderToFinalize.id)
        .in("payment_status", ["pending", "failed", "cancelled"])
        .select()
        .maybeSingle()

      if (updateError) {
        throw new Error(updateError.message)
      }

      if (updatedOrder) {
        finalizedOrderData = updatedOrder as Order
        newlyProcessed = true
      } else {
        const { data: currentOrder, error: currentOrderError } = await supabase
          .from("orders")
          .select("*")
          .eq("id", orderToFinalize.id)
          .single()

        if (currentOrderError || !currentOrder) {
          throw new Error(
            currentOrderError?.message ||
              `Easebuzz order disappeared during processing: ${orderToFinalize.id}`
          )
        }

        finalizedOrderData = currentOrder as Order
        if (!isPaidPaymentStatus(finalizedOrderData.payment_status)) {
          throw new Error(
            `Easebuzz order was not updated: ${orderToFinalize.id}`
          )
        }
      }
    }

    if (newlyProcessed) {
      try {
        const finalizedMetadata = getOrderPricingMetadata(
          finalizedOrderData.metadata
        )
        const rewardsToApply = Number(finalizedMetadata.rewards_used ?? 0)

        await handlePostOrderLogic(finalizedOrderData, cart, rewardsToApply)

        const { logOrderEvent } = await import("@/lib/data/admin")
        await logOrderEvent(
          finalizedOrderData.id,
          "order_placed",
          isPartialPayment ? "Advance Payment Received" : "Order Placed",
          isPartialPayment
            ? "Order confirmed after Easebuzz advance payment. Balance remains due."
            : "Order confirmed via Easebuzz payment notification.",
          "system"
        )
      } catch (postOrderError) {
        console.error(
          "[EASEBUZZ] Post-order logic failed for captured order — manual review required:",
          finalizedOrderData.id,
          postOrderError
        )
      }

      try {
        await sendGa4PurchaseEventForOrderId(
          finalizedOrderData.id,
          isPartialPayment ? "partial_payment" : "full_payment"
        )
        await sendMetaPurchaseEvent(finalizedOrderData)
      } catch (analyticsError) {
        console.error(
          "[EASEBUZZ] Purchase analytics failed after payment was saved:",
          finalizedOrderData.id,
          analyticsError
        )
      }
    }

    return {
      kind: "success",
      orderId: finalizedOrderData.id,
      paymentStatus: isPartialPayment ? "partially_paid" : "captured",
      alreadyProcessed: !newlyProcessed,
    }
  }

  const failureReason =
    payload.error_Message || payload.error || "payment_cancelled"

  if (!definitiveFailureStatuses.has(status)) {
    return {
      kind: "ignored",
      status,
      reason: "Non-definitive payment status; order was left unchanged.",
    }
  }

  const supabase = await createAdminClient()
  const existingOrder = await fetchLatestOrderForEasebuzzPayment(supabase, {
    cartId,
    txnid,
  })

  if (!existingOrder || isPaidPaymentStatus(existingOrder.payment_status)) {
    return {
      kind: "ignored",
      status,
      reason: existingOrder
        ? "A paid order was not downgraded by a failure notification."
        : "No matching order was found.",
      orderId: existingOrder?.id,
    }
  }

  const { data: updatedOrder, error: updateError } = await supabase
    .from("orders")
    .update({
      status: "failed",
      payment_status: "failed",
      fulfillment_status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", existingOrder.id)
    .eq("status", "pending")
    .eq("payment_status", "pending")
    .select("id")
    .maybeSingle()

  if (updateError) {
    throw new Error(updateError.message)
  }

  if (!updatedOrder) {
    return {
      kind: "ignored",
      status,
      reason: "The order was already processed by another payment event.",
      orderId: existingOrder.id,
    }
  }

  const { revokeOrReplaceMembership } = await import("@/lib/data/club")
  await revokeOrReplaceMembership(existingOrder.id, "payment_failed")

  const { logOrderEvent } = await import("@/lib/data/admin")
  await logOrderEvent(
    existingOrder.id,
    "payment_failed",
    "Payment Incomplete",
    `Payment was not completed via Easebuzz. Reason: ${failureReason}`,
    "system"
  )

  return {
    kind: "failure",
    status,
    reason: failureReason,
    orderId: existingOrder.id,
    processed: true,
  }
}
