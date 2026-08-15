import "server-only"

import { createHash } from "node:crypto"

import { createAdminClient } from "@/lib/supabase/admin"
import type { CartItem, Order } from "@/lib/supabase/types"
import { isCashOnDeliveryLikeOrder } from "@/lib/util/customer-order-state"

const GA4_PROVIDER = "google_analytics"
const GA4_EVENT_NAME = "purchase"
const GA4_PURCHASE_SENT_MARKER = "ga4_purchase_sent_at"

const CONFIRMED_ORDER_STATUSES = new Set<Order["status"]>([
  "order_placed",
  "accepted",
  "shipped",
  "delivered",
])

const INVALID_PAYMENT_STATUSES = new Set(["failed", "cancelled"])

type Ga4Item = {
  item_id: string
  item_name: string
  price: number
  quantity: number
  item_variant?: string
}

type Ga4PurchaseParameters = {
  transaction_id: string
  currency: string
  value: number
  items: Ga4Item[]
  shipping?: number
  tax?: number
}

type Ga4PurchasePayload = {
  client_id: string
  events: Array<{
    name: typeof GA4_EVENT_NAME
    params: Ga4PurchaseParameters
  }>
}

type Ga4IntegrationRow = {
  enabled: boolean
  measurement_id: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const getOrderMarketingValue = (
  order: Pick<Order, "metadata">,
  key: string,
): string | null => {
  if (!isRecord(order.metadata) || !isRecord(order.metadata.marketing)) {
    return null
  }

  const value = order.metadata.marketing[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

const isEligibleOrder = (order: Order): boolean => {
  const paymentStatus = order.payment_status.trim().toLowerCase()

  if (
    order.status === "cancelled" ||
    order.status === "failed" ||
    INVALID_PAYMENT_STATUSES.has(paymentStatus)
  ) {
    return false
  }

  if (CONFIRMED_ORDER_STATUSES.has(order.status)) return true

  // The existing customer order state treats successful COD/manual checkout
  // as confirmed even while the order is waiting for Admin acceptance.
  return order.status === "pending" && isCashOnDeliveryLikeOrder(order)
}

const getOrderItems = (order: Order): Ga4Item[] => {
  return (order.items ?? [])
    .filter((item) => item.metadata?.gift_wrap_line !== true)
    .map((item: CartItem): Ga4Item | null => {
      const itemId = item.variant?.sku?.trim() || item.variant_id || item.product_id
      const price = Number(item.unit_price)
      const quantity = Number(item.quantity)

      if (!itemId || !Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || quantity <= 0) {
        return null
      }

      const itemVariant = item.variant?.title?.trim()

      return {
        item_id: itemId,
        item_name: item.product_title || item.title || "Product",
        price,
        quantity,
        ...(itemVariant ? { item_variant: itemVariant } : {}),
      }
    })
    .filter((item): item is Ga4Item => item !== null)
}

const getFallbackClientId = (orderId: string): string => {
  const hash = createHash("sha256").update(orderId).digest("hex")
  const numericPart = Number.parseInt(hash.slice(0, 10), 16).toString()
  return `${numericPart}.${Date.now()}`
}

const getClientId = (order: Order): string =>
  getOrderMarketingValue(order, "ga_client_id") || getFallbackClientId(order.id)

const getMeasurementId = async (): Promise<string | null> => {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("marketing_integrations")
    .select("enabled, measurement_id")
    .eq("provider", GA4_PROVIDER)
    .maybeSingle()

  if (error) {
    console.warn("Failed to load GA4 integration:", error.message)
    return null
  }

  const row = data as Ga4IntegrationRow | null
  const measurementId = row?.measurement_id?.trim()

  return row?.enabled && measurementId ? measurementId : null
}

const hasPurchaseBeenSent = (order: Order): boolean =>
  isRecord(order.metadata) && typeof order.metadata[GA4_PURCHASE_SENT_MARKER] === "string"

const markPurchaseAsSent = async (order: Order): Promise<void> => {
  const metadata = isRecord(order.metadata) ? order.metadata : {}
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("orders")
    .update({
      metadata: {
        ...metadata,
        [GA4_PURCHASE_SENT_MARKER]: new Date().toISOString(),
      },
    })
    .eq("id", order.id)

  if (error) {
    console.warn("GA4 Purchase sent, but delivery marker could not be saved:", error.message)
  }
}

const buildPurchasePayload = (order: Order): Ga4PurchasePayload | null => {
  const items = getOrderItems(order)
  if (items.length === 0) return null

  const itemValue = items.reduce(
    (total, item) => total + item.price * item.quantity,
    0,
  )
  const currency = order.currency_code.trim().toLowerCase()

  if (!currency) return null

  const params: Ga4PurchaseParameters = {
    transaction_id: order.id,
    currency,
    value: Number(itemValue.toFixed(2)),
    items,
  }

  const shipping = Number(order.shipping_total)
  const tax = Number(order.tax_total)
  if (Number.isFinite(shipping) && shipping >= 0) params.shipping = shipping
  if (Number.isFinite(tax) && tax >= 0) params.tax = tax

  return {
    client_id: getClientId(order),
    events: [{ name: GA4_EVENT_NAME, params }],
  }
}

export async function sendGa4PurchaseEvent(order: Order): Promise<void> {
  if (!isEligibleOrder(order) || hasPurchaseBeenSent(order)) return

  const apiSecret = process.env.GA4_API_SECRET?.trim()
  const measurementId = await getMeasurementId()

  if (!apiSecret || !measurementId) {
    if (!apiSecret) console.warn("GA4 Purchase skipped: GA4_API_SECRET is not configured.")
    return
  }

  const payload = buildPurchasePayload(order)
  if (!payload) {
    console.warn(`GA4 Purchase skipped: order ${order.id} has no valid product items.`)
    return
  }

  const query = new URLSearchParams({
    measurement_id: measurementId,
    api_secret: apiSecret,
  })

  try {
    const response = await fetch(
      `https://www.google-analytics.com/mp/collect?${query.toString()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      const responseText = await response.text()
      console.warn(
        `GA4 Purchase failed for order ${order.id}: ${response.status} ${responseText.slice(0, 300)}`,
      )
      return
    }

    await markPurchaseAsSent(order)
  } catch (error) {
    console.warn(
      `GA4 Purchase request failed for order ${order.id}:`,
      error instanceof Error ? error.message : "Unknown error",
    )
  }
}

export async function sendGa4PurchaseEventForOrderId(orderId: string): Promise<void> {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle()

  if (error) {
    console.warn(`Failed to load order ${orderId} for GA4 Purchase:`, error.message)
    return
  }

  if (data) await sendGa4PurchaseEvent(data as Order)
}
