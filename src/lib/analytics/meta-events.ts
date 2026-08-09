export type MetaEventName =
  | "PageView"
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"
  | "Purchase"
  | "Search"
  | "AddPaymentInfo"

export type MetaContent = {
  id: string
  quantity: number
  item_price: number
}

export type MetaCustomData = {
  currency?: string
  value?: number
  contents?: MetaContent[]
  content_ids?: string[]
  content_type?: "product" | "product_group"
  num_items?: number
  order_id?: string
  search_string?: string
}

export const META_CAPI_EVENT_NAMES: ReadonlySet<MetaEventName> = new Set<MetaEventName>([
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "Search",
  "AddPaymentInfo",
])

export const isMetaEventName = (value: unknown): value is MetaEventName =>
  typeof value === "string" &&
  [
    "PageView",
    "ViewContent",
    "AddToCart",
    "InitiateCheckout",
    "Purchase",
    "Search",
    "AddPaymentInfo",
  ].includes(value)

export const isMetaCapiEventName = (
  value: unknown,
): value is Exclude<MetaEventName, "PageView" | "Purchase"> =>
  typeof value === "string" && META_CAPI_EVENT_NAMES.has(value as MetaEventName)