"use client"

export type MarketingItem = {
  item_id: string
  item_name: string
  price: number
  quantity: number
  item_variant?: string
}

type EventParameter = string | number | boolean | string[] | MarketingItem[]
type EventParameters = Record<string, EventParameter>
type GtagFunction = (_command: "event", _eventName: string, _parameters: EventParameters) => void
type FbqFunction = (_command: "track", _eventName: string, _parameters: EventParameters, _options?: { eventID?: string }) => void

type AnalyticsWindow = Window & { gtag?: GtagFunction; fbq?: FbqFunction }
const getAnalyticsWindow = (): AnalyticsWindow => window as AnalyticsWindow

export function trackGoogleEvent(eventName: string, parameters: EventParameters): void {
  getAnalyticsWindow().gtag?.("event", eventName, parameters)
}

export function trackMetaEvent(eventName: string, parameters: EventParameters, eventId?: string): void {
  getAnalyticsWindow().fbq?.("track", eventName, parameters, eventId ? { eventID: eventId } : undefined)
}

export function trackProductEvent(eventName: "view_item" | "add_to_cart", item: MarketingItem, value: number, currency: string): void {
  trackGoogleEvent(eventName, { currency, value, items: [item] })
  trackMetaEvent(eventName === "view_item" ? "ViewContent" : "AddToCart", {
    content_ids: [item.item_id], contents: [item], content_type: "product", value, currency, num_items: item.quantity,
  })
}

export function trackCartEvent(eventName: "view_cart" | "begin_checkout", items: MarketingItem[], value: number, currency: string): void {
  trackGoogleEvent(eventName, { currency, value, items })
  if (eventName === "begin_checkout") {
    trackMetaEvent("InitiateCheckout", {
      content_ids: items.map((item) => item.item_id), contents: items, content_type: "product", value, currency,
      num_items: items.reduce((total, item) => total + item.quantity, 0),
    })
  }
}

export function trackPurchaseEvent(orderId: string, items: MarketingItem[], value: number, currency: string): void {
  trackGoogleEvent("purchase", { transaction_id: orderId, currency, value, items })
  trackMetaEvent("Purchase", {
    content_ids: items.map((item) => item.item_id), contents: items, content_type: "product", value, currency,
    num_items: items.reduce((total, item) => total + item.quantity, 0),
  }, orderId)
}
