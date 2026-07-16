import { Order } from "@/lib/supabase/types"
import { getPendingPaymentProviderId } from "@/lib/util/order-pricing"

const CANCELLED_ORDER_STATUSES = new Set<Order["status"]>([
  "cancelled",
  "failed",
])

const FAILED_PAYMENT_STATUSES = new Set(["failed", "cancelled"])
const SUCCESS_PAYMENT_STATUSES = new Set(["captured", "paid", "partially_paid"])
const PENDING_PAYMENT_STATUSES = new Set(["pending", "awaiting", "unpaid"])
const ACCEPTED_ONLINE_PAYMENT_STATUSES = new Set(["captured", "paid"])
const ACCEPTED_PARTIAL_PAYMENT_STATUSES = new Set([
  "partially_paid",
  "captured",
  "paid",
])

export type CustomerOrderPageState =
  | "confirmed"
  | "payment_pending"
  | "cancelled"

export type CustomerOrderPageTone = "success" | "warning" | "danger"

type CustomerOrderStateInput = Pick<
  Order,
  "status" | "payment_status" | "payment_method" | "metadata"
>

type CustomerOrderMetadataInput = CustomerOrderStateInput &
  Pick<Order, "display_id">

type AcceptPaymentInput = Pick<
  Order,
  "payment_method" | "payment_status" | "metadata"
> & {
  payment_collection?: Order["payment_collection"]
}

export interface CustomerOrderPageContent {
  state: CustomerOrderPageState
  tone: CustomerOrderPageTone
  title: string
  description: string
  showTracking: boolean
}

const getMetadataPaymentMethod = (
  metadata: Order["metadata"]
): string | null => {
  const value = metadata?.payment_method
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

export const isCashOnDeliveryLikeOrder = (
  order: Pick<Order, "payment_method" | "metadata">
): boolean => {
  const paymentMethod =
    order.payment_method || getMetadataPaymentMethod(order.metadata) || ""
  const normalizedMethod = paymentMethod.toLowerCase()

  return (
    normalizedMethod.includes("cod") ||
    normalizedMethod.includes("cash") ||
    normalizedMethod.includes("pp_system_default") ||
    normalizedMethod === "manual"
  )
}

export const canAcceptOrderForPayment = (order: AcceptPaymentInput): boolean => {
  const paymentMethod =
    order.payment_method ||
    getMetadataPaymentMethod(order.metadata) ||
    getPendingPaymentProviderId(order.payment_collection) ||
    ""
  const normalizedMethod = paymentMethod.trim().toLowerCase()
  const normalizedStatus = (order.payment_status || "").trim().toLowerCase()

  if (
    !normalizedMethod ||
    isCashOnDeliveryLikeOrder({
      payment_method: paymentMethod,
      metadata: order.metadata,
    })
  ) {
    return true
  }

  if (normalizedMethod.includes("partial")) {
    return ACCEPTED_PARTIAL_PAYMENT_STATUSES.has(normalizedStatus)
  }

  return ACCEPTED_ONLINE_PAYMENT_STATUSES.has(normalizedStatus)
}

const getEffectivePaymentStatus = (
  order: CustomerOrderStateInput
): string => {
  const rawPaymentStatus = (order.payment_status || "").toLowerCase()
  if (rawPaymentStatus) {
    return rawPaymentStatus
  }

  if (order.status === "pending") {
    return "pending"
  }

  if (CANCELLED_ORDER_STATUSES.has(order.status)) {
    return "cancelled"
  }

  return ""
}

export const getCustomerOrderPageContent = (
  order: CustomerOrderStateInput
): CustomerOrderPageContent => {
  const paymentStatus = getEffectivePaymentStatus(order)
  const isCashOnDelivery = isCashOnDeliveryLikeOrder(order)

  const isCancelled =
    CANCELLED_ORDER_STATUSES.has(order.status) ||
    FAILED_PAYMENT_STATUSES.has(paymentStatus)

  if (isCancelled) {
    const isIncompleteTransaction = paymentStatus === "failed"

    return {
      state: "cancelled",
      tone: "danger",
      title: isIncompleteTransaction
        ? "Incomplete Transaction"
        : "Order Cancelled",
      description: isIncompleteTransaction
        ? "Payment was not completed within the payment window. You can place a new order when ready."
        : "This order was not successful. If this was a mistake, you can try placing it again from your cart.",
      showTracking: false,
    }
  }

  if (SUCCESS_PAYMENT_STATUSES.has(paymentStatus)) {
    return {
      state: "confirmed",
      tone: "success",
      title: "Order Confirmed!",
      description:
        "Thank you for shopping with Toycker. We're getting your order ready for delivery.",
      showTracking: true,
    }
  }

  const isPaymentPending =
    !isCashOnDelivery && PENDING_PAYMENT_STATUSES.has(paymentStatus)

  if (isPaymentPending) {
    return {
      state: "payment_pending",
      tone: "warning",
      title: "Payment Pending",
      description:
        "Your order is waiting for payment confirmation. Complete the payment to confirm this order.",
      showTracking: false,
    }
  }

  return {
    state: "confirmed",
    tone: "success",
    title: "Order Confirmed!",
    description:
      "Thank you for shopping with Toycker. We're getting your order ready for delivery.",
    showTracking: true,
  }
}

export const getCustomerOrderPageMetadata = (
  order: CustomerOrderMetadataInput
): { title: string; description: string } => {
  const content = getCustomerOrderPageContent(order)

  if (content.state === "payment_pending") {
    return {
      title: `Payment Pending #${order.display_id} | Toycker`,
      description: "Your order is waiting for payment confirmation.",
    }
  }

  if (content.state === "cancelled") {
    return {
      title: `${content.title} #${order.display_id} | Toycker`,
      description: content.description,
    }
  }

  return {
    title: `Order Confirmed #${order.display_id} | Toycker`,
    description: "Your order has been confirmed.",
  }
}
