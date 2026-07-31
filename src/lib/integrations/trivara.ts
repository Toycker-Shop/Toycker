import { Order } from "@/lib/supabase/types"
import { isCashOnDeliveryLikeOrder } from "@/lib/util/customer-order-state"
import { getPartialPaymentDisplayData } from "@/lib/util/order-pricing"

export type TrivaraPaymentMode = "Prepaid" | "COD"

export type TrivaraNewApiConfig = {
  orderSyncEnabled: boolean
  apiBaseUrl: string
  apiKeyId: string
  apiSecret: string
  pickupAddressId: string
  channelName: string
  defaultWeightKg: number
  defaultLengthCm: number
  defaultWidthCm: number
  defaultHeightCm: number
}

export type TrivaraNewOrderItem = {
  name: string
  quantity: number
  price: number
  sku: string
  weight: number
  category: string
  hsnCode: string
  taxRate: number
  lengthCm: number
  widthCm: number
  heightCm: number
}

export type TrivaraNewOrderPayload = {
  customerName: string
  customerPhone: string
  addressLine1: string
  pincode: string
  city: string
  state: string
  items: TrivaraNewOrderItem[]
  weightKg: number
  paymentMode: TrivaraPaymentMode
  codAmount: number
  pickupAddressId: string
  customerEmail: string
  addressLine2: string
  country: string
  dimensions: string
  shippingCharges: number
  discount: number
  channelName: string
  externalOrderId: string
}

export type TrivaraApiResponse = {
  ok: boolean
  status: number
  responsePayload: Record<string, unknown>
}

export type TrivaraShipmentDetails = {
  awb: string | null
  courierName: string | null
  shipmentId: string | null
  shipmentStatus: string | null
  trackingUrl: string | null
}

export type TrivaraNewOrderResponse = {
  ok: boolean
  status: number
  orderId: string | null
  apiOrderId: string | null
  orderStatus: string | null
  errorMessage: string | null
  responsePayload: Record<string, unknown>
}

type FetchLike = (
  _input: string | URL,
  _init?: RequestInit
) => Promise<Response>

type OrderForTrivara = Pick<
  Order,
  | "id"
  | "display_id"
  | "customer_email"
  | "email"
  | "total_amount"
  | "total"
  | "shipping_total"
  | "discount_total"
  | "currency_code"
  | "shipping_address"
  | "payment_method"
  | "metadata"
  | "items"
>

const DEFAULT_TRIVARA_NEW_API_BASE_URL = "https://api-new.trivaralogistics.com"
const DEFAULT_TRIVARA_WEIGHT_KG = 0.5
const DEFAULT_TRIVARA_LENGTH_CM = 20
const DEFAULT_TRIVARA_WIDTH_CM = 15
const DEFAULT_TRIVARA_HEIGHT_CM = 10
const TRIVARA_API_KEY_TOKEN_PATH = "/merchant-api-keys/token"
const TRIVARA_NEW_ORDERS_PATH = "/orders"
const TRIVARA_ACCESS_TOKEN_CACHE_MS = 55 * 60 * 1000

let cachedAccessToken: {
  token: string
  expiresAtMs: number
  cacheKey: string
} | null = null

function getTrimmedEnv(key: string): string {
  return process.env[key]?.trim() || ""
}

function getRequiredEnv(key: string): string {
  const value = getTrimmedEnv(key)

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }

  return value
}

function getValidBaseUrl(value: string, envKey: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`Missing required environment variable: ${envKey}`)
  }

  try {
    const url = new URL(trimmed)

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Invalid protocol")
    }

    return url.toString().replace(/\/$/, "")
  } catch {
    throw new Error(
      `${envKey} must be a full URL starting with https:// or http://`
    )
  }
}

function getOptionalValidBaseUrl(
  envKey: string,
  defaultValue: string
): string {
  return getValidBaseUrl(getTrimmedEnv(envKey) || defaultValue, envKey)
}

function readPositiveNumber(value: string, defaultValue: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

function readRequiredWhenEnabled(enabled: boolean, envKey: string): string {
  return enabled ? getRequiredEnv(envKey) : getTrimmedEnv(envKey)
}

function getErrorCauseDetail(error: unknown): string {
  if (!error || typeof error !== "object" || !("cause" in error)) {
    return ""
  }

  const cause = (error as { cause?: unknown }).cause
  if (!cause || typeof cause !== "object") {
    return ""
  }

  const values = cause as {
    code?: unknown
    hostname?: unknown
    syscall?: unknown
  }
  const parts = [values.code, values.hostname, values.syscall].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  )

  return parts.length > 0 ? ` (${parts.join(" ")})` : ""
}

function formatTrivaraNetworkError(url: URL, error: unknown): Error {
  const message = error instanceof Error ? error.message : "Unknown error"
  return new Error(
    `Trivara request failed before receiving a response${getErrorCauseDetail(
      error
    )}: ${message}. URL: ${url.origin}`
  )
}

export function getTrivaraNewApiConfig(): TrivaraNewApiConfig {
  const orderSyncEnabled = getTrimmedEnv("TRIVARA_ORDER_SYNC_ENABLED") === "true"

  return {
    orderSyncEnabled,
    apiBaseUrl: getOptionalValidBaseUrl(
      "TRIVARA_API_BASE_URL",
      DEFAULT_TRIVARA_NEW_API_BASE_URL
    ),
    apiKeyId: readRequiredWhenEnabled(orderSyncEnabled, "TRIVARA_API_KEY_ID"),
    apiSecret: readRequiredWhenEnabled(orderSyncEnabled, "TRIVARA_API_SECRET"),
    pickupAddressId: readRequiredWhenEnabled(
      orderSyncEnabled,
      "TRIVARA_PICKUP_ADDRESS_ID"
    ),
    channelName: getTrimmedEnv("TRIVARA_CHANNEL_NAME") || "Toycker",
    defaultWeightKg: readPositiveNumber(
      getTrimmedEnv("TRIVARA_DEFAULT_WEIGHT_KG"),
      DEFAULT_TRIVARA_WEIGHT_KG
    ),
    defaultLengthCm: readPositiveNumber(
      getTrimmedEnv("TRIVARA_DEFAULT_LENGTH_CM"),
      DEFAULT_TRIVARA_LENGTH_CM
    ),
    defaultWidthCm: readPositiveNumber(
      getTrimmedEnv("TRIVARA_DEFAULT_WIDTH_CM"),
      DEFAULT_TRIVARA_WIDTH_CM
    ),
    defaultHeightCm: readPositiveNumber(
      getTrimmedEnv("TRIVARA_DEFAULT_HEIGHT_CM"),
      DEFAULT_TRIVARA_HEIGHT_CM
    ),
  }
}

function compactAddressPart(value: string | null | undefined): string {
  return value?.trim() || ""
}

function formatConsigneeName(order: OrderForTrivara): string {
  const firstName = compactAddressPart(order.shipping_address?.first_name)
  const lastName = compactAddressPart(order.shipping_address?.last_name)
  return `${firstName} ${lastName}`.trim()
}

function formatMobile(phone: string | null | undefined): string {
  const digits = compactAddressPart(phone).replace(/\D/g, "")

  if (digits.length > 10 && digits.startsWith("91")) {
    return digits.slice(-10)
  }

  return digits
}

function formatAmountNumber(value: number | null | undefined): number {
  const amount = Number(value ?? 0)
  const safeAmount = Number.isFinite(amount) ? amount : 0

  return Math.max(0, Math.round(safeAmount * 100) / 100)
}

function formatProductDetail(order: OrderForTrivara): string {
  const titles =
    order.items
      ?.map((item) => item.title?.trim())
      .filter((title): title is string => Boolean(title)) || []

  return titles.length > 0 ? titles.join(", ") : `Toycker Order #${order.display_id}`
}

function formatProductSku(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback
}

function requireField(value: string, label: string): string {
  if (!value.trim()) {
    throw new Error(`${label} is required for Trivara New Order sync`)
  }

  return value.trim()
}

function formatCustomerName(order: OrderForTrivara): string {
  return requireField(formatConsigneeName(order), "Customer name")
}

function getOrderAmount(order: OrderForTrivara): number {
  return formatAmountNumber(order.total_amount ?? order.total)
}

function getShippingCharges(order: OrderForTrivara): number {
  return formatAmountNumber(order.shipping_total)
}

function getOrderDiscount(order: OrderForTrivara): number {
  return formatAmountNumber(order.discount_total)
}

type TrivaraPaymentDetails = {
  paymentMode: TrivaraPaymentMode
  codAmount: number
}

function getPaymentDetails(order: OrderForTrivara): TrivaraPaymentDetails {
  const partialPaymentData = getPartialPaymentDisplayData(order.metadata)
  const pendingPartialBalance =
    order.payment_method === "pp_easebuzz_partial_payment" &&
    partialPaymentData?.balancePaymentStatus === "pending" &&
    partialPaymentData.balanceRemainingAmount > 0
  const paymentMode: TrivaraPaymentMode =
    pendingPartialBalance || isCashOnDeliveryLikeOrder(order) ? "COD" : "Prepaid"

  if (pendingPartialBalance) {
    return {
      paymentMode,
      codAmount: formatAmountNumber(partialPaymentData.balanceRemainingAmount),
    }
  }

  return {
    paymentMode,
    codAmount: paymentMode === "COD" ? getOrderAmount(order) : 0,
  }
}

type TrivaraOrderSourceItem = NonNullable<OrderForTrivara["items"]>[number]

function getItemQuantity(item: TrivaraOrderSourceItem): number {
  const quantity = Number(item.quantity)

  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1
}

function getItemUnitPrice(
  item: TrivaraOrderSourceItem,
  quantity: number
): number {
  const originalUnitPrice = Number(item.original_unit_price)

  if (Number.isFinite(originalUnitPrice)) {
    return formatAmountNumber(originalUnitPrice)
  }

  const originalLineTotal = Number(item.original_total)
  if (Number.isFinite(originalLineTotal) && quantity > 0) {
    return formatAmountNumber(originalLineTotal / quantity)
  }

  const unitPrice = Number(item.unit_price)

  if (Number.isFinite(unitPrice)) {
    return formatAmountNumber(unitPrice)
  }

  const lineTotal = Number(item.total)
  if (Number.isFinite(lineTotal) && quantity > 0) {
    return formatAmountNumber(lineTotal / quantity)
  }

  return 0
}

function getFallbackItemAmount(order: OrderForTrivara): number {
  return formatAmountNumber(
    getOrderAmount(order) - getShippingCharges(order) + getOrderDiscount(order)
  )
}

export function buildTrivaraNewOrderPayload(
  order: OrderForTrivara,
  config: Pick<
    TrivaraNewApiConfig,
    | "pickupAddressId"
    | "channelName"
    | "defaultWeightKg"
    | "defaultLengthCm"
    | "defaultWidthCm"
    | "defaultHeightCm"
  >
): TrivaraNewOrderPayload {
  const orderItems = order.items || []
  const shippingCharges = getShippingCharges(order)
  const discount = getOrderDiscount(order)
  const { paymentMode, codAmount } = getPaymentDetails(order)
  const length = config.defaultLengthCm
  const width = config.defaultWidthCm
  const height = config.defaultHeightCm
  const fallbackProductName = formatProductDetail(order)

  return {
    customerName: formatCustomerName(order),
    customerPhone: requireField(
      formatMobile(order.shipping_address?.phone),
      "Customer phone"
    ),
    addressLine1: requireField(
      compactAddressPart(order.shipping_address?.address_1),
      "Shipping address line 1"
    ),
    pincode: requireField(
      compactAddressPart(order.shipping_address?.postal_code),
      "Shipping pincode"
    ),
    city: requireField(compactAddressPart(order.shipping_address?.city), "City"),
    state: requireField(
      compactAddressPart(order.shipping_address?.province),
      "State"
    ),
    items:
      orderItems.length > 0
        ? orderItems.map((item, index) => {
            const quantity = getItemQuantity(item)

            return {
              name: requireField(
                item.title || item.product_title || fallbackProductName,
                "Product name"
              ),
              quantity,
              price: getItemUnitPrice(item, quantity),
              sku: formatProductSku(item.variant?.sku, `${order.display_id}-${index + 1}`),
              weight: config.defaultWeightKg,
              category: "Toys",
              hsnCode: "",
              taxRate: 0,
              lengthCm: length,
              widthCm: width,
              heightCm: height,
            }
          })
        : [
            {
              name: requireField(fallbackProductName, "Product name"),
              quantity: 1,
              price: getFallbackItemAmount(order),
              sku: String(order.display_id),
              weight: config.defaultWeightKg,
              category: "Toys",
              hsnCode: "",
              taxRate: 0,
              lengthCm: length,
              widthCm: width,
              heightCm: height,
            },
          ],
    weightKg: config.defaultWeightKg,
    paymentMode,
    codAmount,
    pickupAddressId: requireField(
      config.pickupAddressId,
      "Trivara pickup address ID"
    ),
    customerEmail: requireField(order.customer_email || order.email, "Customer email"),
    addressLine2: compactAddressPart(order.shipping_address?.address_2),
    country: compactAddressPart(order.shipping_address?.country_code).toUpperCase() || "IN",
    dimensions: `${length}x${width}x${height}`,
    shippingCharges,
    discount,
    channelName: config.channelName,
    externalOrderId: `toycker_${order.id}`,
  }
}

async function parseTrivaraResponse(
  response: Response
): Promise<Record<string, unknown>> {
  const raw = await response.text()

  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }

    return { value: parsed }
  } catch {
    return { raw }
  }
}

function getStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function getStringOrNumberValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }

  if (typeof value === "number") {
    return String(value)
  }

  return null
}

function extractRecordString(
  value: Record<string, unknown> | null,
  candidateKeys: string[]
): string | null {
  if (!value) {
    return null
  }

  for (const key of candidateKeys) {
    const nestedValue = getStringOrNumberValue(value[key])

    if (nestedValue) {
      return nestedValue
    }
  }

  return null
}

function getTrivaraDataRecord(
  value: Record<string, unknown> | null
): Record<string, unknown> | null {
  const data = value?.data

  if (isRecord(data)) {
    return data
  }

  if (Array.isArray(data)) {
    const firstRecord = data.find(isRecord)

    return firstRecord || null
  }

  return null
}

function getTrivaraOrderRecord(
  value: Record<string, unknown> | null
): Record<string, unknown> | null {
  const dataRecord = getTrivaraDataRecord(value)

  if (!dataRecord) {
    return null
  }

  if (isRecord(dataRecord.order)) {
    return dataRecord.order
  }

  return dataRecord
}

function getTrivaraShipmentRecord(
  value: Record<string, unknown> | null
): Record<string, unknown> | null {
  const dataRecord = getTrivaraDataRecord(value)

  if (!dataRecord) {
    return null
  }

  if (isRecord(dataRecord.order)) {
    return dataRecord.order
  }

  if (isRecord(dataRecord.shipment)) {
    return dataRecord.shipment
  }

  return dataRecord
}

function extractTrivaraPayloadString(
  value: Record<string, unknown>,
  candidateKeys: string[]
): string | null {
  const queue: unknown[] = [value]

  while (queue.length > 0) {
    const current = queue.shift()

    if (!current || typeof current !== "object") {
      continue
    }

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    const record = current as Record<string, unknown>

    for (const key of candidateKeys) {
      const nestedValue = getStringOrNumberValue(record[key])

      if (nestedValue) {
        return nestedValue
      }
    }

    Object.values(record).forEach((nestedValue) => {
      if (nestedValue && typeof nestedValue === "object") {
        queue.push(nestedValue)
      }
    })
  }

  return null
}

const TRIVARA_ORDER_ID_KEYS = [
  "orderId",
  "order_id",
  "trivaraOrderId",
  "trivara_order_id",
  "orderNumber",
  "order_number",
  "orderNo",
  "order_no",
  "referenceNumber",
  "reference_number",
]

const TRIVARA_EXTERNAL_ORDER_ID_KEYS = [
  "externalOrderId",
  "external_order_id",
  "channelOrderId",
  "channel_order_id",
  "clientOrderId",
  "client_order_id",
  "merchantOrderId",
  "merchant_order_id",
  "referenceOrderId",
  "reference_order_id",
  "sellerOrderId",
  "seller_order_id",
  "sellerOrderNumber",
  "seller_order_number",
  "channelOrderNumber",
  "channel_order_number",
  "externalOrderNumber",
  "external_order_number",
]

const TRIVARA_API_ORDER_ID_KEYS = [
  "id",
  "_id",
  "apiOrderId",
  "api_order_id",
  "trivaraApiOrderId",
  "trivara_api_order_id",
  "internalOrderId",
  "internal_order_id",
]

const TRIVARA_ORDER_STATUS_KEYS = [
  "orderStatus",
  "order_status",
  "shipmentStatus",
  "shipment_status",
  "trackingStatus",
  "tracking_status",
  "currentStatus",
  "current_status",
  "status",
]

const TRIVARA_AWB_KEYS = [
  "awb",
  "awbNumber",
  "awb_number",
  "awbNo",
  "awb_no",
  "waybill",
  "waybillNumber",
  "waybill_number",
  "waybillNo",
  "waybill_no",
  "trackingNumber",
  "tracking_number",
  "trackingNo",
  "tracking_no",
  "trackingCode",
  "tracking_code",
]

const TRIVARA_COURIER_KEYS = [
  "courierName",
  "courier_name",
  "courier",
  "carrierName",
  "carrier_name",
  "carrier",
  "logisticsPartner",
  "logistics_partner",
  "shippingPartner",
  "shipping_partner",
]

const TRIVARA_SHIPMENT_ID_KEYS = [
  "shipmentId",
  "shipment_id",
  "shipmentID",
  "shipmentNo",
  "shipment_no",
  "shipmentNumber",
  "shipment_number",
]

const TRIVARA_SHIPMENT_STATUS_KEYS = [
  "shipmentStatus",
  "shipment_status",
  "trackingStatus",
  "tracking_status",
  "currentStatus",
  "current_status",
  "status",
]

const TRIVARA_TRACKING_URL_KEYS = [
  "trackingUrl",
  "tracking_url",
  "trackingLink",
  "tracking_link",
  "trackUrl",
  "track_url",
  "publicUrl",
  "public_url",
]

export function extractTrivaraOrderId(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return (
    extractRecordString(getTrivaraOrderRecord(value), TRIVARA_ORDER_ID_KEYS) ||
    extractTrivaraPayloadString(value, TRIVARA_ORDER_ID_KEYS) ||
    extractTrivaraApiOrderId(value)
  )
}

export function extractTrivaraExternalOrderId(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return (
    extractRecordString(
      getTrivaraOrderRecord(value),
      TRIVARA_EXTERNAL_ORDER_ID_KEYS
    ) || extractTrivaraPayloadString(value, TRIVARA_EXTERNAL_ORDER_ID_KEYS)
  )
}

export function extractToyckerOrderIdFromTrivaraExternalId(
  externalOrderId: string | null
): string | null {
  const trimmed = externalOrderId?.trim()

  if (!trimmed) {
    return null
  }

  return trimmed.startsWith("toycker_")
    ? trimmed.slice("toycker_".length)
    : trimmed
}

export function extractTrivaraApiOrderId(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return (
    extractRecordString(getTrivaraOrderRecord(value), TRIVARA_API_ORDER_ID_KEYS) ||
    extractRecordString(getTrivaraDataRecord(value), TRIVARA_API_ORDER_ID_KEYS) ||
    extractTrivaraPayloadString(value, [
      "apiOrderId",
      "api_order_id",
      "trivaraApiOrderId",
      "trivara_api_order_id",
      "internalOrderId",
      "internal_order_id",
    ])
  )
}

export function extractTrivaraWebhookEventName(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return extractTrivaraPayloadString(value, [
    "event",
    "eventName",
    "event_name",
    "eventType",
    "event_type",
    "topic",
    "type",
  ])
}

export function extractTrivaraMerchantId(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return extractTrivaraPayloadString(value, [
    "merchantId",
    "merchant_id",
    "sellerId",
    "seller_id",
    "accountId",
    "account_id",
  ])
}

export function extractTrivaraOrderStatus(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return (
    extractRecordString(getTrivaraOrderRecord(value), TRIVARA_ORDER_STATUS_KEYS) ||
    extractTrivaraPayloadString(value, [
      "orderStatus",
      "order_status",
      "status",
    ])
  )
}

export function extractTrivaraAwb(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return (
    extractRecordString(getTrivaraShipmentRecord(value), TRIVARA_AWB_KEYS) ||
    extractTrivaraPayloadString(value, TRIVARA_AWB_KEYS)
  )
}

export function extractTrivaraCourierName(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return (
    extractRecordString(getTrivaraShipmentRecord(value), TRIVARA_COURIER_KEYS) ||
    extractTrivaraPayloadString(value, TRIVARA_COURIER_KEYS)
  )
}

export function extractTrivaraShipmentId(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return (
    extractRecordString(getTrivaraShipmentRecord(value), TRIVARA_SHIPMENT_ID_KEYS) ||
    extractTrivaraPayloadString(value, TRIVARA_SHIPMENT_ID_KEYS)
  )
}

export function extractTrivaraShipmentStatus(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return (
    extractRecordString(
      getTrivaraShipmentRecord(value),
      TRIVARA_SHIPMENT_STATUS_KEYS
    ) || extractTrivaraPayloadString(value, TRIVARA_SHIPMENT_STATUS_KEYS)
  )
}

export function extractTrivaraTrackingUrl(
  value: Record<string, unknown> | null
): string | null {
  if (!value) {
    return null
  }

  return (
    extractRecordString(getTrivaraShipmentRecord(value), TRIVARA_TRACKING_URL_KEYS) ||
    extractTrivaraPayloadString(value, TRIVARA_TRACKING_URL_KEYS)
  )
}

export function extractTrivaraShipmentDetails(
  value: Record<string, unknown> | null
): TrivaraShipmentDetails {
  return {
    awb: extractTrivaraAwb(value),
    courierName: extractTrivaraCourierName(value),
    shipmentId: extractTrivaraShipmentId(value),
    shipmentStatus: extractTrivaraShipmentStatus(value),
    trackingUrl: extractTrivaraTrackingUrl(value),
  }
}
export function getTrivaraResponseBusinessError(
  value: Record<string, unknown> | null
): string | null {
  const queue: unknown[] = value ? [value] : []

  while (queue.length > 0) {
    const current = queue.shift()

    if (!current || typeof current !== "object" || Array.isArray(current)) {
      continue
    }

    const record = current as Record<string, unknown>
    const status = getStringValue(record.status)?.toLowerCase()
    const success = record.success
    const error = getStringValue(record.error)
    const message = getStringValue(record.message)

    if (error) {
      return error
    }

    if (status && ["error", "failed", "failure"].includes(status)) {
      return message || "Trivara returned an error response."
    }

    if (typeof success === "string") {
      const normalized = success.trim().toLowerCase()
      if (["0", "false", "failed", "error"].includes(normalized)) {
        return message || "Trivara returned an unsuccessful response."
      }
    }

    if (success === false) {
      return message || "Trivara returned an unsuccessful response."
    }

    Object.values(record).forEach((nestedValue) => {
      if (nestedValue && typeof nestedValue === "object") {
        if (Array.isArray(nestedValue)) {
          queue.push(...nestedValue)
        } else {
          queue.push(nestedValue)
        }
      }
    })
  }

  return null
}

function extractTrivaraAccessToken(value: Record<string, unknown>): string | null {
  return extractTrivaraPayloadString(value, [
    "token",
    "accessToken",
    "access_token",
    "jwt",
  ])
}

async function getTrivaraAccessToken(
  config: Pick<TrivaraNewApiConfig, "apiBaseUrl" | "apiKeyId" | "apiSecret">,
  fetcher: FetchLike,
  forceRefresh = false
): Promise<string> {
  const cacheKey = `${config.apiBaseUrl}|${config.apiKeyId}`

  if (
    !forceRefresh &&
    cachedAccessToken &&
    cachedAccessToken.cacheKey === cacheKey &&
    cachedAccessToken.expiresAtMs > Date.now() + 30_000
  ) {
    return cachedAccessToken.token
  }

  const url = new URL(TRIVARA_API_KEY_TOKEN_PATH, config.apiBaseUrl)
  let response: Response

  try {
    response = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keyId: config.apiKeyId,
        secret: config.apiSecret,
      }),
      cache: "no-store",
    })
  } catch (error) {
    throw formatTrivaraNetworkError(url, error)
  }

  const responsePayload = await parseTrivaraResponse(response)
  const businessError = getTrivaraResponseBusinessError(responsePayload)
  const accessToken = extractTrivaraAccessToken(responsePayload)
  const message = extractTrivaraPayloadString(responsePayload, ["message"])

  if (!response.ok || businessError || !accessToken) {
    throw new Error(
      businessError || message || `Trivara token request failed with status ${response.status}`
    )
  }

  cachedAccessToken = {
    token: accessToken,
    expiresAtMs: Date.now() + TRIVARA_ACCESS_TOKEN_CACHE_MS,
    cacheKey,
  }

  return accessToken
}

async function sendTrivaraAuthorizedJsonRequest(
  path: string,
  init: {
    method: "GET" | "POST" | "PATCH" | "DELETE"
    body?: unknown
  },
  config: Pick<TrivaraNewApiConfig, "apiBaseUrl" | "apiKeyId" | "apiSecret">,
  fetcher: FetchLike = fetch,
  forceRefresh = false
): Promise<TrivaraApiResponse> {
  const url = new URL(path, config.apiBaseUrl)
  const accessToken = await getTrivaraAccessToken(config, fetcher, forceRefresh)
  let response: Response

  try {
    response = await fetcher(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    })
  } catch (error) {
    throw formatTrivaraNetworkError(url, error)
  }

  if (response.status === 401 && !forceRefresh) {
    cachedAccessToken = null
    return sendTrivaraAuthorizedJsonRequest(path, init, config, fetcher, true)
  }

  const responsePayload = await parseTrivaraResponse(response)
  const businessError = getTrivaraResponseBusinessError(responsePayload)

  return {
    ok: response.ok && !businessError,
    status: response.status,
    responsePayload,
  }
}

export async function sendTrivaraNewOrder(
  payload: TrivaraNewOrderPayload,
  config: Pick<TrivaraNewApiConfig, "apiBaseUrl" | "apiKeyId" | "apiSecret">,
  fetcher: FetchLike = fetch
): Promise<TrivaraNewOrderResponse> {
  const response = await sendTrivaraAuthorizedJsonRequest(
    TRIVARA_NEW_ORDERS_PATH,
    {
      method: "POST",
      body: payload,
    },
    config,
    fetcher
  )

  return {
    ok: response.ok,
    status: response.status,
    orderId: extractTrivaraOrderId(response.responsePayload),
    apiOrderId: extractTrivaraApiOrderId(response.responsePayload),
    orderStatus: extractTrivaraOrderStatus(response.responsePayload),
    errorMessage: getTrivaraResponseBusinessError(response.responsePayload),
    responsePayload: response.responsePayload,
  }
}

export async function sendTrivaraGetOrder(
  trivaraApiOrderId: string,
  config: Pick<TrivaraNewApiConfig, "apiBaseUrl" | "apiKeyId" | "apiSecret">,
  fetcher: FetchLike = fetch
): Promise<TrivaraApiResponse> {
  return sendTrivaraAuthorizedJsonRequest(
    `${TRIVARA_NEW_ORDERS_PATH}/${encodeURIComponent(trivaraApiOrderId)}`,
    {
      method: "GET",
    },
    config,
    fetcher
  )
}

export async function sendTrivaraGetShipment(
  trivaraShipmentId: string,
  config: Pick<TrivaraNewApiConfig, "apiBaseUrl" | "apiKeyId" | "apiSecret">,
  fetcher: FetchLike = fetch
): Promise<TrivaraApiResponse> {
  return sendTrivaraAuthorizedJsonRequest(
    `/shipments/${encodeURIComponent(trivaraShipmentId)}`,
    {
      method: "GET",
    },
    config,
    fetcher
  )
}

export async function sendTrivaraCancelNewOrder(
  trivaraApiOrderId: string,
  config: Pick<TrivaraNewApiConfig, "apiBaseUrl" | "apiKeyId" | "apiSecret">,
  fetcher: FetchLike = fetch
): Promise<TrivaraApiResponse> {
  return sendTrivaraAuthorizedJsonRequest(
    `${TRIVARA_NEW_ORDERS_PATH}/${encodeURIComponent(trivaraApiOrderId)}/status`,
    {
      method: "PATCH",
      body: { status: "CANCELLED" },
    },
    config,
    fetcher
  )
}
