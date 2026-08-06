import { createHash } from "node:crypto"

import type { CartItem, Order } from "@/lib/supabase/types"
import { createAdminClient } from "@/lib/supabase/admin"
import { getBaseURL } from "@/lib/util/env"

type MetaIntegration = {
  enabled: boolean
  pixel_id: string | null
  meta_access_token: string | null
  meta_test_event_code: string | null
}

type MetaUserData = {
  em?: string[]
  ph?: string[]
  external_id?: string[]
  fn?: string[]
  ln?: string[]
  ct?: string[]
  st?: string[]
  zp?: string[]
  country?: string[]
  fbp?: string
  fbc?: string
}

type MetaContent = {
  id: string
  quantity: number
  item_price: number
}

type MetaPurchaseEvent = {
  event_name: "Purchase"
  event_time: number
  event_id: string
  event_source_url: string
  action_source: "website"
  user_data: MetaUserData
  custom_data: {
    currency: string
    value: number
    contents: MetaContent[]
    content_ids: string[]
    content_type: "product"
    num_items: number
  }
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex")

const normalizeMatchValue = (
  value: string | null | undefined,
): string | undefined => {
  const normalized = value?.trim().toLowerCase()
  return normalized || undefined
}

const hashMatchValue = (
  value: string | null | undefined,
): string | undefined => {
  const normalized = normalizeMatchValue(value)
  return normalized ? sha256(normalized) : undefined
}

const hashEmail = (value: string | null | undefined): string | undefined =>
  hashMatchValue(value)

const hashPhone = (value: string | null | undefined): string | undefined => {
  const normalized = value?.replace(/[^0-9]/g, "")
  return normalized ? sha256(normalized) : undefined
}

const asHashedList = (value: string | undefined): string[] | undefined =>
  value ? [value] : undefined

const getMarketingValue = (
  metadata: Record<string, unknown> | null,
  key: string,
): string | undefined => {
  const marketing = metadata?.marketing
  if (!marketing || typeof marketing !== "object") return undefined
  const value = (marketing as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

const getOrderItems = (order: Order): CartItem[] =>
  (order.items ?? []).filter((item) => item.metadata?.gift_wrap_line !== true)

const markDelivery = async (
  eventId: string,
  status: "sent" | "failed",
  errorMessage?: string,
) => {
  const supabase = await createAdminClient()
  await supabase
    .from("marketing_event_deliveries")
    .update({
      status,
      last_error: errorMessage ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("provider", "meta")
    .eq("event_name", "Purchase")
    .eq("event_id", eventId)
}

export async function sendMetaPurchaseEvent(order: Order): Promise<void> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("marketing_integrations")
    .select("enabled, pixel_id, meta_access_token, meta_test_event_code")
    .eq("provider", "meta")
    .maybeSingle()

  const integration = data as MetaIntegration | null
  if (!integration?.enabled || !integration.pixel_id || !integration.meta_access_token) {
    return
  }

  const { data: existingDelivery } = await supabase
    .from("marketing_event_deliveries")
    .select("status")
    .eq("provider", "meta")
    .eq("event_name", "Purchase")
    .eq("event_id", order.id)
    .maybeSingle()

  if ((existingDelivery as { status?: string } | null)?.status === "sent") {
    return
  }

  await supabase.from("marketing_event_deliveries").upsert(
    {
      provider: "meta",
      event_name: "Purchase",
      event_id: order.id,
      order_id: order.id,
      status: "pending",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider,event_name,event_id" },
  )

  const items = getOrderItems(order)
  const customerAddress = order.billing_address ?? order.shipping_address
  const hashedEmail = hashEmail(order.customer_email)
  const hashedPhone = hashPhone(customerAddress?.phone)
  const userData: MetaUserData = {
    em: asHashedList(hashedEmail),
    ph: asHashedList(hashedPhone),
    external_id: asHashedList(hashMatchValue(order.user_id)),
    fn: asHashedList(hashMatchValue(customerAddress?.first_name)),
    ln: asHashedList(hashMatchValue(customerAddress?.last_name)),
    ct: asHashedList(hashMatchValue(customerAddress?.city)),
    st: asHashedList(hashMatchValue(customerAddress?.province)),
    zp: asHashedList(hashMatchValue(customerAddress?.postal_code)),
    country: asHashedList(hashMatchValue(customerAddress?.country_code)),
    fbp: getMarketingValue(order.metadata, "fbp"),
    fbc: getMarketingValue(order.metadata, "fbc"),
  }
  const contents = items.map((item) => ({
    id: item.variant?.sku || item.variant_id || item.product_id,
    quantity: item.quantity,
    item_price: item.unit_price,
  }))
  const event: MetaPurchaseEvent = {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: order.id,
    event_source_url: `${getBaseURL()}/order/confirmed/${order.id}`,
    action_source: "website",
    user_data: userData,
    custom_data: {
      currency: order.currency_code.toUpperCase(),
      value: order.total_amount,
      contents,
      content_ids: contents.map((content) => content.id),
      content_type: "product",
      num_items: items.reduce((total, item) => total + item.quantity, 0),
    },
  }

  const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || "v20.0"
  const endpoint = `https://graph.facebook.com/${apiVersion}/${integration.pixel_id}/events?access_token=${encodeURIComponent(integration.meta_access_token)}`
  const body = integration.meta_test_event_code
    ? { data: [event], test_event_code: integration.meta_test_event_code }
    : { data: [event] }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    if (!response.ok) {
      const responseText = await response.text()
      await markDelivery(order.id, "failed", `Meta API ${response.status}: ${responseText.slice(0, 500)}`)
      return
    }

    await markDelivery(order.id, "sent")
  } catch (error) {
    await markDelivery(
      order.id,
      "failed",
      error instanceof Error ? error.message : "Meta API request failed",
    )
  }
}
