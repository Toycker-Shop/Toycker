import { createHash } from "node:crypto"

import type { CartItem, Order } from "@/lib/supabase/types"
import {
  isMetaCapiEventName,
  type MetaContent,
  type MetaCustomData,
  type MetaEventName,
} from "@/lib/analytics/meta-events"
import { createAdminClient } from "@/lib/supabase/admin"
import { getBaseURL } from "@/lib/util/env"

type MetaIntegration = {
  enabled: boolean
  pixel_id: string | null
  meta_access_token: string | null
  meta_test_event_code: string | null
}

export type MetaUserData = {
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
  client_ip_address?: string
  client_user_agent?: string
}

export type MetaCustomerIdentity = {
  email?: string | null
  phone?: string | null
  countryCode?: string | null
  externalId?: string | null
  firstName?: string | null
  lastName?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  fbp?: string | null
  fbc?: string | null
  clientIpAddress?: string | null
  clientUserAgent?: string | null
}

export type MetaEvent = {
  event_name: MetaEventName
  event_time: number
  event_id: string
  event_source_url: string
  action_source: "website"
  user_data: MetaUserData
  custom_data: MetaCustomData
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

const normalizeEmailValue = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim().toLowerCase()
  return normalized || undefined
}

const normalizeTextMatchValue = (value: string | null | undefined): string | undefined => {
  const normalized = value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")

  return normalized || undefined
}

const hashMatchValue = (value: string | null | undefined): string | undefined => {
  const normalized = normalizeTextMatchValue(value)
  return normalized ? sha256(normalized) : undefined
}

const hashEmail = (value: string | null | undefined): string | undefined => {
  const normalized = normalizeEmailValue(value)
  return normalized ? sha256(normalized) : undefined
}

export const normalizeMetaPhone = (
  value: string | null | undefined,
  countryCode: string | null | undefined,
): string | undefined => {
  const digits = value?.replace(/[^0-9]/g, "")
  if (!digits) return undefined

  const withoutInternationalPrefix = digits.startsWith("00") ? digits.slice(2) : digits
  const normalizedCountryCode = countryCode?.trim().toLowerCase()

  if (normalizedCountryCode === "in" && withoutInternationalPrefix.length === 10) {
    return `91${withoutInternationalPrefix}`
  }

  return withoutInternationalPrefix
}

const hashPhone = (value: string | null | undefined, countryCode: string | null | undefined): string | undefined => {
  const normalized = normalizeMetaPhone(value, countryCode)
  return normalized ? sha256(normalized) : undefined
}

const hashCountry = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z]/g, "")
  return normalized ? sha256(normalized) : undefined
}

const asHashedList = (value: string | undefined): string[] | undefined => value ? [value] : undefined

const buildMetaUserDataFromIdentity = (identity: MetaCustomerIdentity): MetaUserData => ({
  em: asHashedList(hashEmail(identity.email)),
  ph: asHashedList(hashPhone(identity.phone, identity.countryCode)),
  external_id: asHashedList(hashMatchValue(identity.externalId)),
  fn: asHashedList(hashMatchValue(identity.firstName)),
  ln: asHashedList(hashMatchValue(identity.lastName)),
  ct: asHashedList(hashMatchValue(identity.city)),
  st: asHashedList(hashMatchValue(identity.state)),
  zp: asHashedList(hashMatchValue(identity.zipCode)),
  country: asHashedList(hashCountry(identity.countryCode)),
  fbp: identity.fbp?.trim() || undefined,
  fbc: identity.fbc?.trim() || undefined,
  client_ip_address: identity.clientIpAddress?.trim() || undefined,
  client_user_agent: identity.clientUserAgent?.trim() || undefined,
})

const getMarketingValue = (metadata: Record<string, unknown> | null, key: string): string | undefined => {
  const marketing = metadata?.marketing
  if (!marketing || typeof marketing !== "object" || Array.isArray(marketing)) return undefined
  const value = (marketing as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

const getOrderItems = (order: Order): CartItem[] =>
  (order.items ?? []).filter((item) => item.metadata?.gift_wrap_line !== true)

export const buildMetaUserDataFromOrder = (order: Order): MetaUserData => {
  const customerAddress = order.billing_address ?? order.shipping_address
  return buildMetaUserDataFromIdentity({
    email: order.customer_email,
    phone: customerAddress?.phone,
    countryCode: customerAddress?.country_code,
    externalId: order.user_id ?? getMarketingValue(order.metadata, "visitor_id"),
    firstName: customerAddress?.first_name,
    lastName: customerAddress?.last_name,
    city: customerAddress?.city,
    state: customerAddress?.province,
    zipCode: customerAddress?.postal_code,
    fbp: getMarketingValue(order.metadata, "fbp"),
    fbc: getMarketingValue(order.metadata, "fbc"),
    clientIpAddress: getMarketingValue(order.metadata, "client_ip_address"),
    clientUserAgent: getMarketingValue(order.metadata, "client_user_agent"),
  })
}

export const buildMetaUserData = (input: MetaCustomerIdentity | Order): MetaUserData => {
  if ("customer_email" in input) return buildMetaUserDataFromOrder(input)
  return buildMetaUserDataFromIdentity(input)
}
export const buildMetaPurchaseEvent = (order: Order): MetaEvent => {
  const items = getOrderItems(order)
  const contents: MetaContent[] = items.map((item) => ({
    id: item.product_id,
    quantity: item.quantity,
    item_price: item.unit_price,
  }))

  return {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: order.id,
    event_source_url: `${getBaseURL()}/order/confirmed/${order.id}`,
    action_source: "website",
    user_data: buildMetaUserDataFromOrder(order),
    custom_data: {
      currency: order.currency_code.toUpperCase(),
      value: order.total_amount,
      contents,
      content_ids: contents.map((content) => content.id),
      content_type: "product",
      num_items: items.reduce((total, item) => total + item.quantity, 0),
      order_id: order.id,
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const getMetaIntegration = async (): Promise<MetaIntegration | null> => {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("marketing_integrations")
    .select("enabled, pixel_id, meta_access_token, meta_test_event_code")
    .eq("provider", "meta")
    .maybeSingle()

  if (error) {
    console.warn("Failed to load Meta integration:", error)
    return null
  }

  if (!isRecord(data)) return null

  return {
    enabled: data.enabled === true,
    pixel_id: typeof data.pixel_id === "string" ? data.pixel_id : null,
    meta_access_token: typeof data.meta_access_token === "string" ? data.meta_access_token : null,
    meta_test_event_code: typeof data.meta_test_event_code === "string" ? data.meta_test_event_code : null,
  }
}

const markDelivery = async (
  eventName: MetaEventName,
  eventId: string,
  status: "sent" | "failed",
  errorMessage?: string,
): Promise<void> => {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("marketing_event_deliveries")
    .update({
      status,
      last_error: errorMessage ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("provider", "meta")
    .eq("event_name", eventName)
    .eq("event_id", eventId)

  if (error) console.warn("Failed to update Meta delivery status:", error)
}

export async function sendMetaEvent(event: MetaEvent, orderId?: string | null): Promise<void> {
  if (event.event_name === "PageView") return

  const integration = await getMetaIntegration()
  if (!integration?.enabled || !integration.pixel_id || !integration.meta_access_token) return

  const supabase = await createAdminClient()
  const { data: existingDelivery } = await supabase
    .from("marketing_event_deliveries")
    .select("status")
    .eq("provider", "meta")
    .eq("event_name", event.event_name)
    .eq("event_id", event.event_id)
    .maybeSingle()

  if (isRecord(existingDelivery) && existingDelivery.status === "sent") return

  const { error: deliveryUpsertError } = await supabase
    .from("marketing_event_deliveries")
    .upsert({
      provider: "meta",
      event_name: event.event_name,
      event_id: event.event_id,
      order_id: orderId ?? null,
      status: "pending",
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider,event_name,event_id" })

  if (deliveryUpsertError) console.warn("Failed to create Meta delivery record:", deliveryUpsertError)

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
      await markDelivery(event.event_name, event.event_id, "failed", `Meta API ${response.status}: ${responseText.slice(0, 500)}`)
      return
    }

    const responseData: unknown = await response.json()
    const eventsReceived = isRecord(responseData) ? responseData.events_received : undefined
    if (typeof eventsReceived !== "number" || eventsReceived < 1) {
      await markDelivery(event.event_name, event.event_id, "failed", "Meta API accepted the request but reported no received events")
      return
    }

    await markDelivery(event.event_name, event.event_id, "sent")
  } catch (error) {
    await markDelivery(
      event.event_name,
      event.event_id,
      "failed",
      error instanceof Error ? error.message : "Meta API request failed",
    )
  }
}

export async function sendMetaPurchaseEvent(order: Order): Promise<void> {
  await sendMetaEvent(buildMetaPurchaseEvent(order), order.id)
}

export const isSupportedMetaCapiEvent = (value: unknown): value is Exclude<MetaEventName, "PageView" | "Purchase"> =>
  isMetaCapiEventName(value)