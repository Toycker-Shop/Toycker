"use client"

export type MarketingItem = {
  item_id: string
  item_name: string
  price: number
  quantity: number
  item_variant?: string
}

type MetaContent = {
  id: string
  quantity: number
  item_price: number
}

type EventParameter = string | number | boolean | string[] | MarketingItem[] | MetaContent[]
type EventParameters = Record<string, EventParameter>
type GtagFunction = (_command: "event", _eventName: string, _parameters: EventParameters) => void
type FbqFunction = (_command: "track", _eventName: string, _parameters: EventParameters, _options?: { eventID?: string }) => void

type AnalyticsWindow = Window & { gtag?: GtagFunction; fbq?: FbqFunction }
type PendingMetaEvent = {
  eventName: string
  parameters: EventParameters
  eventId?: string
}

const MAX_PENDING_META_EVENTS = 50
const pendingMetaEvents: PendingMetaEvent[] = []

const getAnalyticsWindow = (): AnalyticsWindow => window as AnalyticsWindow

export function trackGoogleEvent(eventName: string, parameters: EventParameters): void {
  getAnalyticsWindow().gtag?.("event", eventName, parameters)
}

export function trackMetaEvent(eventName: string, parameters: EventParameters, eventId?: string): void {
  const fbq = getAnalyticsWindow().fbq
  if (fbq) {
    fbq("track", eventName, parameters, eventId ? { eventID: eventId } : undefined)
    return
  }

  if (pendingMetaEvents.length >= MAX_PENDING_META_EVENTS) {
    pendingMetaEvents.shift()
  }

  pendingMetaEvents.push({ eventName, parameters, eventId })
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

export function trackProductEvent(eventName: "view_item" | "add_to_cart", item: MarketingItem, value: number, currency: string): void {
  trackGoogleEvent(eventName, { currency, value, items: [item] })
  const metaContent: MetaContent = {
    id: item.item_id,
    quantity: item.quantity,
    item_price: item.price,
  }
  trackMetaEvent(eventName === "view_item" ? "ViewContent" : "AddToCart", {
    content_ids: [item.item_id], contents: [metaContent], content_type: "product", value, currency,
  })
}

export function trackCartEvent(eventName: "view_cart" | "begin_checkout", items: MarketingItem[], value: number, currency: string): void {
  trackGoogleEvent(eventName, { currency, value, items })
  if (eventName === "begin_checkout") {
    const metaContents: MetaContent[] = items.map((item) => ({
      id: item.item_id,
      quantity: item.quantity,
      item_price: item.price,
    }))
    trackMetaEvent("InitiateCheckout", {
      content_ids: items.map((item) => item.item_id), contents: metaContents, content_type: "product", value, currency,
      num_items: items.reduce((total, item) => total + item.quantity, 0),
    })
  }
}

export function trackPurchaseEvent(orderId: string, items: MarketingItem[], value: number, currency: string): void {
  trackGoogleEvent("purchase", { transaction_id: orderId, currency, value, items })
  const metaContents: MetaContent[] = items.map((item) => ({
    id: item.item_id,
    quantity: item.quantity,
    item_price: item.price,
  }))
  trackMetaEvent("Purchase", {
    content_ids: items.map((item) => item.item_id), contents: metaContents, content_type: "product", value, currency,
    num_items: items.reduce((total, item) => total + item.quantity, 0),
  }, orderId)
}
