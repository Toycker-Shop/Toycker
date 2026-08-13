"use client"

import {
  META_CAPI_EVENT_NAMES,
  type MetaContent,
  type MetaCustomData,
  type MetaEventName,
} from "@/lib/analytics/meta-events"

export type MarketingItem = {
  item_id: string
  item_name: string
  price: number
  quantity: number
  item_variant?: string
  meta_content_id?: string
}

type GoogleEventParameter = string | number | boolean | MarketingItem[]
type GoogleEventParameters = Record<string, GoogleEventParameter>
type GtagFunction = (_command: "event", _eventName: string, _parameters: GoogleEventParameters) => void
type FbqFunction = (_command: "track", _eventName: MetaEventName, _parameters: MetaCustomData, _options?: { eventID?: string }) => void

type AnalyticsWindow = Window & { gtag?: GtagFunction; fbq?: FbqFunction }
type PendingMetaEvent = {
  eventName: MetaEventName
  parameters: MetaCustomData
  eventId?: string
}

type PendingGoogleEvent = {
  eventName: string
  parameters: GoogleEventParameters
}

const MAX_PENDING_META_EVENTS = 50
const MAX_PENDING_GOOGLE_EVENTS = 50
const pendingMetaEvents: PendingMetaEvent[] = []
const pendingGoogleEvents: PendingGoogleEvent[] = []

const getAnalyticsWindow = (): AnalyticsWindow => window as AnalyticsWindow

export function trackGoogleEvent(eventName: string, parameters: GoogleEventParameters): void {
  const gtag = getAnalyticsWindow().gtag

  if (gtag) {
    gtag("event", eventName, parameters)
    return
  }

  if (pendingGoogleEvents.length >= MAX_PENDING_GOOGLE_EVENTS) {
    pendingGoogleEvents.shift()
  }

  pendingGoogleEvents.push({ eventName, parameters })
}

export function flushPendingGoogleEvents(): void {
  const gtag = getAnalyticsWindow().gtag
  if (!gtag) return

  while (pendingGoogleEvents.length > 0) {
    const pendingEvent = pendingGoogleEvents.shift()
    if (!pendingEvent) continue
    gtag("event", pendingEvent.eventName, pendingEvent.parameters)
  }
}

const createMetaEventId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }

  return `meta-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const sendMetaEventToCapi = (eventName: MetaEventName, eventId: string, parameters: MetaCustomData): void => {
  if (!META_CAPI_EVENT_NAMES.has(eventName)) return

  void fetch("/api/marketing/meta/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: eventName,
      event_id: eventId,
      event_source_url: window.location.href,
      custom_data: parameters,
    }),
    keepalive: true,
  }).catch(() => undefined)
}

export function trackMetaEvent(eventName: MetaEventName, parameters: MetaCustomData, eventId?: string): void {
  const resolvedEventId = META_CAPI_EVENT_NAMES.has(eventName)
    ? eventId ?? createMetaEventId()
    : eventId
  const fbq = getAnalyticsWindow().fbq

  if (fbq) {
    fbq("track", eventName, parameters, resolvedEventId ? { eventID: resolvedEventId } : undefined)
  } else {
    if (pendingMetaEvents.length >= MAX_PENDING_META_EVENTS) pendingMetaEvents.shift()
    pendingMetaEvents.push({ eventName, parameters, eventId: resolvedEventId })
  }

  if (resolvedEventId) sendMetaEventToCapi(eventName, resolvedEventId, parameters)
}

export function flushPendingMetaEvents(): void {
  const fbq = getAnalyticsWindow().fbq
  if (!fbq) return

  while (pendingMetaEvents.length > 0) {
    const pendingEvent = pendingMetaEvents.shift()
    if (!pendingEvent) continue
    fbq(
      "track",
      pendingEvent.eventName,
      pendingEvent.parameters,
      pendingEvent.eventId ? { eventID: pendingEvent.eventId } : undefined,
    )
  }
}

export function trackProductEvent(
  eventName: "view_item" | "add_to_cart",
  item: MarketingItem,
  value: number,
  currency: string,
): void {
  trackGoogleEvent(eventName, { currency, value, items: [item] })
  const metaContent: MetaContent = {
    id: item.meta_content_id ?? item.item_id,
    quantity: item.quantity,
    item_price: item.price,
  }
  trackMetaEvent(eventName === "view_item" ? "ViewContent" : "AddToCart", {
    content_ids: [metaContent.id],
    contents: [metaContent],
    content_type: "product",
    value,
    currency: currency.toUpperCase(),
  })
}

export function trackCartEvent(
  eventName: "view_cart" | "begin_checkout",
  items: MarketingItem[],
  value: number,
  currency: string,
): void {
  trackGoogleEvent(eventName, { currency, value, items })
  if (eventName !== "begin_checkout") return

  const metaContents: MetaContent[] = items.map((item) => ({
    id: item.meta_content_id ?? item.item_id,
    quantity: item.quantity,
    item_price: item.price,
  }))
  trackMetaEvent("InitiateCheckout", {
    content_ids: metaContents.map((item) => item.id),
    contents: metaContents,
    content_type: "product",
    value,
    currency: currency.toUpperCase(),
    num_items: items.reduce((total, item) => total + item.quantity, 0),
  })
}

export function trackPurchaseEvent(orderId: string, items: MarketingItem[], value: number, currency: string): void {
  trackGoogleEvent("purchase", { transaction_id: orderId, currency, value, items })
  const metaContents: MetaContent[] = items.map((item) => ({
    id: item.meta_content_id ?? item.item_id,
    quantity: item.quantity,
    item_price: item.price,
  }))
  trackMetaEvent("Purchase", {
    content_ids: metaContents.map((item) => item.id),
    contents: metaContents,
    content_type: "product",
    value,
    currency: currency.toUpperCase(),
    num_items: items.reduce((total, item) => total + item.quantity, 0),
    order_id: orderId,
  }, orderId)
}

export function trackSearchEvent(searchString: string): void {
  const normalizedSearchString = searchString.trim()
  if (!normalizedSearchString) return

  trackMetaEvent("Search", { search_string: normalizedSearchString.slice(0, 100) })
}

export function trackAddPaymentInfoEvent(items: MarketingItem[], value: number, currency: string): void {
  const metaContents: MetaContent[] = items.map((item) => ({
    id: item.meta_content_id ?? item.item_id,
    quantity: item.quantity,
    item_price: item.price,
  }))

  trackMetaEvent("AddPaymentInfo", {
    content_ids: metaContents.map((item) => item.id),
    contents: metaContents,
    content_type: "product",
    value,
    currency: currency.toUpperCase(),
    num_items: items.reduce((total, item) => total + item.quantity, 0),
  })
}
