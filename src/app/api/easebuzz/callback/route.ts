import { NextRequest, NextResponse } from "next/server"
import { verifyEasebuzzHash, EasebuzzCallbackPayload } from "@/lib/easebuzz"
import { createAdminClient } from "@/lib/supabase/admin"
import { Address, Cart, Order } from "@/lib/supabase/types"
import { retrieveCart } from "@/lib/data/cart"
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

export const dynamic = "force-dynamic"

const RECENT_CALLBACKS = new Map<string, number>()
const THROTTLE_MS = 2000
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

function htmlRedirect(path: string) {
  return new NextResponse(
    `<!doctype html><html><head><title>Redirecting...</title><meta charset="utf-8"></head>
     <body>
      <p>Processing payment response...</p>
      <script>window.location.replace(${JSON.stringify(path)})</script>
     </body></html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  )
}

const normalizeIp = (value: string | null): string =>
  value?.split(",")[0]?.trim() || "unknown"

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

  return fetchLatestOrderForCart(supabase, params.cartId)
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
  partialPaymentData?: ReturnType<typeof getPartialPaymentSessionData>
): OrderPricingMetadata => {
  const baseMetadata = {
    ...getOrderPricingMetadata(metadata),
    easebuzz_payload: payload,
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

export async function POST(request: NextRequest) {
  const ip = normalizeIp(request.headers.get("x-forwarded-for"))
  const now = Date.now()
  const lastHit = RECENT_CALLBACKS.get(ip)

  if (lastHit && now - lastHit < THROTTLE_MS) {
    console.warn("[EASEBUZZ] Throttling possible duplicate callback for IP:", ip)
    return new NextResponse("Throttled", { status: 429 })
  }
  RECENT_CALLBACKS.set(ip, now)

  if (RECENT_CALLBACKS.size > 1000) {
    // Delete only expired entries instead of wiping the whole map.
    // Clearing everything would reset throttle protection for all IPs simultaneously,
    // which a flood of 1000 unique IPs could exploit intentionally.
    const cutoff = now - THROTTLE_MS
    RECENT_CALLBACKS.forEach((ts, key) => {
      if (ts < cutoff) RECENT_CALLBACKS.delete(key)
    })
  }

  try {
    const bodyText = await request.text()
    const params = new URLSearchParams(bodyText)
    const payload = Object.fromEntries(
      params.entries()
    ) as EasebuzzCallbackPayload

    if (process.env.NODE_ENV === "development") {
      console.log("[EASEBUZZ] Callback hit:", {
        status: payload.status,
        txnid: payload.txnid,
        amount: payload.amount,
        easepayid: payload.easepayid,
        key: payload.key?.substring(0, 6) + "...",
      })
    }

    const salt = process.env.EASEBUZZ_MERCHANT_SALT
    if (!salt) {
      console.error(
        "[EASEBUZZ] Configuration error: Missing EASEBUZZ_MERCHANT_SALT env var"
      )
      return htmlRedirect("/checkout?step=payment&error=configuration_error")
    }

    if (!verifyEasebuzzHash(payload, salt)) {
      console.error(
        "[EASEBUZZ] Hash verification failed for txnid:",
        payload.txnid
      )
      return htmlRedirect("/checkout?step=payment&error=invalid_hash")
    }

    const status = payload.status
    const cartId = payload.udf1 || ""
    const txnid = payload.txnid
    const easepayid = payload.easepayid || txnid
    const amount = payload.amount
    const email = payload.email

    if (process.env.NODE_ENV === "development") {
      console.log("[EASEBUZZ] Processing payment:", {
        status,
        cartId,
        txnid,
        easepayid,
        amount,
      })
    }

    if (status === "success") {
      const supabase = await createAdminClient()
      const cart = await retrieveCart(cartId)

      if (!cart) {
        console.error("[EASEBUZZ] Cart not found:", cartId)
        return htmlRedirect("/checkout?error=cart_not_found")
      }

      const snapshot = buildEasebuzzOrderSnapshot(cart, email)
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
          console.error(
            "[EASEBUZZ] Missing checkout snapshot data for cart:",
            cartId
          )
          return htmlRedirect("/checkout?error=missing_checkout_snapshot")
        }

        try {
          orderToFinalize = await refreshPendingOrderSnapshot(
            supabase,
            cartId,
            snapshot
          )
        } catch (refreshError) {
          console.error(
            "[EASEBUZZ] Failed to refresh pending order snapshot:",
            refreshError
          )
          return htmlRedirect(
            "/checkout?error=order_snapshot_refresh_failed"
          )
        }
      }

      if (!orderToFinalize) {
        console.error("[EASEBUZZ] No order available for cart:", cartId)
        return htmlRedirect("/checkout?error=order_not_found")
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
        console.error("[EASEBUZZ] Missing partial payment session data:", {
          orderId: orderToFinalize.id,
          txnid,
        })
        return htmlRedirect("/checkout?step=payment&error=partial_payment_data_missing")
      }

      const orderAlreadyCaptured =
        orderToFinalize.payment_status === "captured" ||
        orderToFinalize.payment_status === "partially_paid"
      const existingMetadata = getOrderPricingMetadata(
        orderToFinalize.metadata
      )
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

        console.error("[EASEBUZZ] Amount mismatch:", {
          orderId: orderToFinalize.id,
          expectedPaymentAmount,
          callbackAmount: amount,
        })

        return htmlRedirect("/checkout?step=payment&error=amount_mismatch")
      }

      const shouldUpdateGatewayDetails =
        !orderAlreadyCaptured ||
        !orderToFinalize.gateway_txn_id ||
        !orderToFinalize.payment_method ||
        !existingMetadata.easebuzz_payload

      let finalizedOrderData = orderToFinalize

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
          .select()
          .single()

        if (updateError || !updatedOrder) {
          console.error(
            "[EASEBUZZ] Order update failed:",
            updateError?.message || "Unknown error"
          )
          return htmlRedirect(
            "/checkout?error=order_update_failed_payment_success"
          )
        }

        finalizedOrderData = updatedOrder as Order
      }

      if (!orderAlreadyCaptured) {
        // Wrap in try/catch: the order is already captured in the DB at this point.
        // A failure here (email, rewards, timeline) must NOT redirect the user back to
        // checkout — they paid successfully. Log the error for manual recovery instead.
        try {
          const { handlePostOrderLogic } = await import("@lib/data/cart")
          const { logOrderEvent } = await import("@/lib/data/admin")
          const finalizedMetadata = getOrderPricingMetadata(
            finalizedOrderData.metadata
          )
          const rewardsToApply = Number(finalizedMetadata.rewards_used ?? 0)

          await handlePostOrderLogic(finalizedOrderData, cart, rewardsToApply)
          await logOrderEvent(
            finalizedOrderData.id,
            "order_placed",
            isPartialPayment ? "Advance Payment Received" : "Order Placed",
            isPartialPayment
              ? "Order confirmed after Easebuzz advance payment. Balance remains due."
              : "Order confirmed via Easebuzz payment gateway callback.",
            "system"
          )
        } catch (postOrderError) {
          console.error(
            "[EASEBUZZ] Post-order logic failed for captured order — manual review required:",
            finalizedOrderData.id,
            postOrderError
          )
        }
      }

      await sendGa4PurchaseEventForOrderId(
        finalizedOrderData.id,
        isPartialPayment ? "partial_payment" : "full_payment",
      )
      await sendMetaPurchaseEvent(finalizedOrderData)
      console.log(
        "[EASEBUZZ] Order processed successfully:",
        finalizedOrderData.id
      )

      const response = htmlRedirect(
        `/order/confirmed/${finalizedOrderData.id}`
      )
      response.cookies.delete("toycker_cart_id")
      return response
    }

    const failureReason = payload.error_Message || payload.error || "payment_cancelled"
    console.log("[EASEBUZZ] Payment non-success callback:", { status, reason: failureReason })

    if (!cartId) {
      console.warn("[EASEBUZZ] Empty cartId in failure callback — cannot look up order")
    }

    // Only cancel the order for definitive failure statuses.
    // "pending" means the payment is still in progress (e.g. UPI awaiting confirmation,
    // or the gateway is sending an acknowledgement before the user completes payment).
    // Cancelling for "pending" would incorrectly mark active orders as cancelled.
    const DEFINITIVE_FAILURE_STATUSES = [
      "failure",
      "userCancelled",
      "dropped",
      "bounced",
      "failed",
    ]
    const isDefinitiveFailure = DEFINITIVE_FAILURE_STATUSES.includes(status)

    if (isDefinitiveFailure) {
      try {
        const supabase = await createAdminClient()
        const existingOrder = await fetchLatestOrderForEasebuzzPayment(
          supabase,
          { cartId, txnid }
        )

        if (existingOrder && existingOrder.payment_status !== "captured") {
          await supabase
            .from("orders")
            .update({
              status: "failed",
              payment_status: "failed",
              fulfillment_status: "cancelled",
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingOrder.id)

          const { revokeOrReplaceMembership } = await import("@lib/data/club")
          await revokeOrReplaceMembership(existingOrder.id, "payment_failed")

          const { logOrderEvent } = await import("@/lib/data/admin")
          await logOrderEvent(
            existingOrder.id,
            "payment_failed",
            "Payment Incomplete",
            `Payment was not completed via Easebuzz. Reason: ${failureReason}`,
            "system"
          )
        }
      } catch (updateErr) {
        console.error(
          "[EASEBUZZ] Failed to update order status for failure:",
          updateErr
        )
      }
    } else {
      console.log("[EASEBUZZ] Non-definitive status — skipping order cancellation:", status)
    }

    return htmlRedirect(
      `/checkout?step=payment&error=${encodeURIComponent(
        failureReason
      )}&status=${encodeURIComponent(status)}`
    )
  } catch (error) {
    console.error("[EASEBUZZ] Callback fatal error:", error)
    return htmlRedirect("/checkout?error=callback_failed")
  }
}

export async function GET() {
  return new NextResponse("Easebuzz Callback Endpoint Active", { status: 200 })
}
