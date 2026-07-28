"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePermission } from "@/lib/permissions/server"
import { PERMISSIONS } from "@/lib/permissions"
import {
  Order,
  OrderTimeline,
  TrivaraOrderBooking,
  TrivaraOrderBookingStatus,
  type TrivaraWebhookEventStatus,
} from "@/lib/supabase/types"
import {
  extractTrivaraApiOrderId,
  extractToyckerOrderIdFromTrivaraExternalId,
  extractTrivaraExternalOrderId,
  extractTrivaraOrderId,
  extractTrivaraOrderStatus,
  extractTrivaraMerchantId,
  extractTrivaraWebhookEventName,
  extractTrivaraShipmentDetails,
  type TrivaraShipmentDetails,
  getTrivaraNewApiConfig,
  getTrivaraResponseBusinessError,
  sendTrivaraGetOrder,
  sendTrivaraGetShipment,
} from "@/lib/integrations/trivara"
import { cancelOrder, ensureAdmin, logOrderEvent, retryTrivaraBookingForOrder } from "./admin"
import {
  hasTrivaraFulfillmentDetails,
  mergeTrivaraFulfillmentMetadata,
} from "@/lib/util/trivara-fulfillment"

type LogisticsOrderSummary = Pick<
  Order,
  | "id"
  | "display_id"
  | "customer_email"
  | "status"
  | "payment_method"
  | "payment_status"
  | "total_amount"
  | "currency_code"
  | "created_at"
  | "shipping_address"
  | "tracking_number"
  | "metadata"
>

export type TrivaraLogisticsRecord = TrivaraOrderBooking & {
  order: LogisticsOrderSummary | null
  cancellation_event: Pick<
    OrderTimeline,
    "actor" | "created_at" | "description" | "title"
  > | null
}

export type TrivaraLogisticsListParams = {
  page?: number
  limit?: number
  status?: TrivaraOrderBookingStatus | "all"
  search?: string
}

export type TrivaraLogisticsListResponse = {
  records: TrivaraLogisticsRecord[]
  count: number
  totalPages: number
  currentPage: number
}

export type TrivaraLogisticsStatusCounts = {
  total: number
  pending: number
  new_order: number
  booked: number
  failed: number
  skipped: number
  cancelled: number
}

const LOGISTICS_STATUSES: TrivaraOrderBookingStatus[] = [
  "pending",
  "new_order",
  "booked",
  "failed",
  "skipped",
  "cancelled",
]

function revalidateLogistics(orderId?: string) {
  revalidatePath("/admin/logistics")
  if (orderId) {
    revalidatePath(`/admin/logistics/${orderId}`)
  }
}

async function getBooking(orderId: string): Promise<TrivaraOrderBooking> {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("trivara_order_bookings")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    throw new Error("Trivara New Order record was not found for this order.")
  }

  return data as TrivaraOrderBooking
}

export async function getTrivaraLogisticsStatusCounts(): Promise<TrivaraLogisticsStatusCounts> {
  await ensureAdmin()
  await requirePermission(PERMISSIONS.SHIPPING_READ)

  const supabase = await createAdminClient()
  const [{ count: totalCount, error: totalError }, ...statusResults] =
    await Promise.all([
      supabase
        .from("trivara_order_bookings")
        .select("*", { count: "exact", head: true }),
      ...LOGISTICS_STATUSES.map((status) =>
        supabase
          .from("trivara_order_bookings")
          .select("*", { count: "exact", head: true })
          .eq("status", status)
      ),
    ])

  if (totalError) {
    throw new Error(totalError.message)
  }

  const counts: TrivaraLogisticsStatusCounts = {
    total: totalCount || 0,
    pending: 0,
    new_order: 0,
    booked: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  }

  statusResults.forEach((result, index) => {
    if (result.error) {
      throw new Error(result.error.message)
    }

    counts[LOGISTICS_STATUSES[index]] = result.count || 0
  })

  return counts
}

export async function getTrivaraLogisticsRecords(
  params: TrivaraLogisticsListParams = {}
): Promise<TrivaraLogisticsListResponse> {
  await ensureAdmin()
  await requirePermission(PERMISSIONS.SHIPPING_READ)

  const { page = 1, limit = 20, status = "all", search = "" } = params
  const supabase = await createAdminClient()
  const currentPage = Math.max(1, page)
  const offset = (currentPage - 1) * limit
  const from = offset
  const to = offset + limit - 1
  const normalizedSearch = search.trim()
  const matchingOrderIds: string[] = []

  if (normalizedSearch) {
    let orderSearchQuery = supabase
      .from("orders")
      .select("id")
      .ilike("customer_email", `%${normalizedSearch}%`)

    const numericSearch = Number(normalizedSearch)
    if (Number.isInteger(numericSearch) && numericSearch > 0) {
      orderSearchQuery = supabase
        .from("orders")
        .select("id")
        .or(
          `customer_email.ilike.%${normalizedSearch}%,display_id.eq.${numericSearch}`
        )
    }

    const { data: matchingOrders, error: matchingOrdersError } =
      await orderSearchQuery

    if (matchingOrdersError) {
      throw new Error(matchingOrdersError.message)
    }

    matchingOrderIds.push(
      ...((matchingOrders || []) as Array<{ id: string }>).map((order) => order.id)
    )
  }

  const searchFilter = normalizedSearch
    ? matchingOrderIds.length > 0
      ? `trivara_order_id.ilike.%${normalizedSearch}%,order_id.in.(${matchingOrderIds.join(",")})`
      : `trivara_order_id.ilike.%${normalizedSearch}%`
    : ""

  let countQuery = supabase
    .from("trivara_order_bookings")
    .select("*", { count: "exact", head: true })

  if (status !== "all") {
    countQuery = countQuery.eq("status", status)
  }

  if (searchFilter) {
    countQuery = countQuery.or(searchFilter)
  }

  const { count, error: countError } = await countQuery
  if (countError) {
    throw new Error(countError.message)
  }

  let query = supabase
    .from("trivara_order_bookings")
    .select("*")
    .order("updated_at", { ascending: false })
    .range(from, to)

  if (status !== "all") {
    query = query.eq("status", status)
  }

  if (searchFilter) {
    query = query.or(searchFilter)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  const bookings = (data || []) as TrivaraOrderBooking[]
  const orderIds = bookings.map((booking) => booking.order_id)
  const ordersById = new Map<string, LogisticsOrderSummary>()

  if (orderIds.length > 0) {
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select(
        "id, display_id, customer_email, status, payment_method, payment_status, total_amount, currency_code, created_at, shipping_address, tracking_number, metadata"
      )
      .in("id", orderIds)

    if (ordersError) {
      throw new Error(ordersError.message)
    }

    ;((orders || []) as LogisticsOrderSummary[]).forEach((order) => {
      ordersById.set(order.id, order)
    })
  }

  const records = bookings.map((booking) => ({
    ...booking,
    order: ordersById.get(booking.order_id) || null,
    cancellation_event: null,
  }))
  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / limit) || 1

  return {
    records,
    count: totalCount,
    totalPages,
    currentPage,
  }
}

export async function getTrivaraLogisticsRecord(
  orderId: string
): Promise<TrivaraLogisticsRecord | null> {
  await ensureAdmin()
  await requirePermission(PERMISSIONS.SHIPPING_READ)

  const booking = await getBooking(orderId).catch(() => null)
  if (!booking) {
    return null
  }

  const supabase = await createAdminClient()
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, display_id, customer_email, status, payment_method, payment_status, total_amount, currency_code, created_at, shipping_address, tracking_number, metadata"
    )
    .eq("id", orderId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  const { data: cancellationEvent, error: cancellationEventError } =
    await supabase
      .from("order_timeline")
      .select("actor, created_at, description, title")
      .eq("order_id", orderId)
      .eq("event_type", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

  if (cancellationEventError) {
    throw new Error(cancellationEventError.message)
  }

  let cancellationDisplayEvent = cancellationEvent

  if (!cancellationDisplayEvent) {
    const {
      data: cancellationNoteEvent,
      error: cancellationNoteEventError,
    } = await supabase
      .from("order_timeline")
      .select("actor, created_at, description, title")
      .eq("order_id", orderId)
      .in("title", ["Trivara New Order Cancelled", "Order Cancelled from Trivara"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (cancellationNoteEventError) {
      throw new Error(cancellationNoteEventError.message)
    }

    cancellationDisplayEvent = cancellationNoteEvent
  }

  return {
    ...booking,
    order: order ? (order as LogisticsOrderSummary) : null,
    cancellation_event: cancellationDisplayEvent
      ? (cancellationDisplayEvent as Pick<
          OrderTimeline,
          "actor" | "created_at" | "description" | "title"
        >)
      : null,
  }
}

function isCancelledTrivaraStatus(status: string | null): boolean {
  const normalized = status?.trim().toLowerCase() || ""

  return normalized === "cancelled" || normalized === "canceled"
}

type TrivaraCancellationSyncSource = "manual_sync" | "webhook" | "fallback"

async function cancelToyckerOrderFromTrivara(
  orderId: string,
  source: TrivaraCancellationSyncSource = "manual_sync"
) {
  const supabase = await createAdminClient()
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle()

  if (orderError) {
    throw new Error(orderError.message)
  }

  if (!order || ["cancelled", "failed"].includes(order.status)) {
    return
  }

  if (["shipped", "delivered"].includes(order.status)) {
    await logOrderEvent(
      orderId,
      "note_added",
      "Trivara Cancellation Sync Skipped",
      "Trivara shows this order as cancelled, but Toycker did not auto-cancel because the order is already shipped or delivered.",
      "system",
      { provider: "trivara", source }
    )
    return
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      fulfillment_status: "cancelled",
      payment_status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)

  if (updateError) {
    throw new Error(updateError.message)
  }

  try {
    const { deductClubSavingsFromOrder, revokeOrReplaceMembership } = await import(
      "@lib/data/club"
    )
    await deductClubSavingsFromOrder(orderId)
    await revokeOrReplaceMembership(orderId, "order_cancelled")
  } catch (clubError) {
    console.error(
      `[TRIVARA] Failed to apply club cancellation side effects for ${orderId}:`,
      clubError
    )
  }

  await logOrderEvent(
    orderId,
    "cancelled",
    "Order Cancelled from Trivara",
    "Order was cancelled in Trivara Logistics and synced back to Toycker.",
    "Trivara Logistics",
    { provider: "trivara", source }
  )
}

type AdminSupabaseClient = Awaited<ReturnType<typeof createAdminClient>>

type TrivaraSyncSource = "manual_sync" | "webhook" | "fallback"

type TrivaraWebhookIdentifiers = {
  eventName: string | null
  merchantId: string | null
  externalOrderId: string | null
  toyckerOrderId: string | null
  visibleTrivaraOrderId: string | null
  apiOrderId: string | null
}

export type TrivaraWebhookProcessResult =
  | {
      matched: true
      orderId: string
      updated: true
      eventId: string | null
      message: string
    }
  | {
      matched: false
      eventId: string | null
      message: string
      error?: string
    }

export type TrivaraRemoteSyncResult =
  | {
      ok: true
      orderId: string
      trivaraOrderId: string | null
      message: string
    }
  | {
      ok: false
      orderId: string
      error: string
    }

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}

function getTrivaraWebhookIdentifiers(
  payload: Record<string, unknown>
): TrivaraWebhookIdentifiers {
  const externalOrderId = extractTrivaraExternalOrderId(payload)

  return {
    eventName: extractTrivaraWebhookEventName(payload),
    merchantId: extractTrivaraMerchantId(payload),
    externalOrderId,
    toyckerOrderId: extractToyckerOrderIdFromTrivaraExternalId(externalOrderId),
    visibleTrivaraOrderId: extractTrivaraOrderId(payload),
    apiOrderId: extractTrivaraApiOrderId(payload),
  }
}

function hasWebhookOrderIdentifier(identifiers: TrivaraWebhookIdentifiers): boolean {
  return Boolean(
    identifiers.externalOrderId ||
      identifiers.toyckerOrderId ||
      identifiers.visibleTrivaraOrderId ||
      identifiers.apiOrderId
  )
}

function getTrivaraApiOrderIdFromBooking(
  booking: Pick<
    TrivaraOrderBooking,
    "trivara_order_id" | "response_payload"
  >
): string | null {
  const visibleTrivaraOrderId =
    booking.trivara_order_id || extractTrivaraOrderId(booking.response_payload)
  const fallbackApiOrderId =
    visibleTrivaraOrderId && !visibleTrivaraOrderId.toUpperCase().startsWith("TRV-")
      ? visibleTrivaraOrderId
      : null

  return extractTrivaraApiOrderId(booking.response_payload) || fallbackApiOrderId
}

async function createTrivaraWebhookEvent(
  supabase: AdminSupabaseClient,
  payload: Record<string, unknown>,
  identifiers: TrivaraWebhookIdentifiers
): Promise<string | null> {
  const { data, error } = await supabase
    .from("trivara_webhook_events")
    .insert({
      event_name: identifiers.eventName,
      merchant_id: identifiers.merchantId,
      extracted_external_order_id: identifiers.externalOrderId,
      extracted_toycker_order_id: identifiers.toyckerOrderId,
      extracted_trivara_order_id: identifiers.visibleTrivaraOrderId,
      extracted_trivara_api_order_id: identifiers.apiOrderId,
      status: "received" satisfies TrivaraWebhookEventStatus,
      payload,
    })
    .select("id")
    .maybeSingle()

  if (error) {
    console.error("[TRIVARA_WEBHOOK] Failed to store webhook event", error)
    return null
  }

  return typeof data?.id === "string" ? data.id : null
}

async function updateTrivaraWebhookEvent(
  supabase: AdminSupabaseClient,
  eventId: string | null,
  patch: {
    status: TrivaraWebhookEventStatus
    responseStatus: number
    matchedOrderId?: string | null
    errorMessage?: string | null
  }
) {
  if (!eventId) {
    return
  }

  const { error } = await supabase
    .from("trivara_webhook_events")
    .update({
      status: patch.status,
      response_status: patch.responseStatus,
      matched_order_id: patch.matchedOrderId ?? null,
      error_message: patch.errorMessage ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId)

  if (error) {
    console.error("[TRIVARA_WEBHOOK] Failed to update webhook event", error)
  }
}

async function findBookingByWebhookPayload(
  supabase: AdminSupabaseClient,
  payload: Record<string, unknown>
): Promise<TrivaraOrderBooking | null> {
  const externalOrderId = extractTrivaraExternalOrderId(payload)
  const toyckerOrderId = extractToyckerOrderIdFromTrivaraExternalId(externalOrderId)

  if (
    toyckerOrderId &&
    (externalOrderId?.startsWith("toycker_") || isLikelyUuid(toyckerOrderId))
  ) {
    const { data, error } = await supabase
      .from("trivara_order_bookings")
      .select("*")
      .eq("order_id", toyckerOrderId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (data) {
      return data as TrivaraOrderBooking
    }
  }

  const visibleTrivaraOrderId = extractTrivaraOrderId(payload)
  if (visibleTrivaraOrderId) {
    const { data, error } = await supabase
      .from("trivara_order_bookings")
      .select("*")
      .eq("trivara_order_id", visibleTrivaraOrderId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (data) {
      return data as TrivaraOrderBooking
    }
  }

  const apiOrderId = extractTrivaraApiOrderId(payload)
  if (!apiOrderId) {
    return null
  }

  const { data, error } = await supabase
    .from("trivara_order_bookings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200)

  if (error) {
    throw new Error(error.message)
  }

  const bookings = (data || []) as TrivaraOrderBooking[]
  return (
    bookings.find(
      (booking) => getTrivaraApiOrderIdFromBooking(booking) === apiOrderId
    ) || null
  )
}

function mergeShipmentDetails(
  primary: TrivaraShipmentDetails,
  fallback: TrivaraShipmentDetails
): TrivaraShipmentDetails {
  return {
    awb: primary.awb || fallback.awb,
    courierName: primary.courierName || fallback.courierName,
    shipmentId: primary.shipmentId || fallback.shipmentId,
    shipmentStatus: primary.shipmentStatus || fallback.shipmentStatus,
    trackingUrl: primary.trackingUrl || fallback.trackingUrl,
  }
}

async function updateOrderShipmentDetails(
  supabase: AdminSupabaseClient,
  orderId: string,
  shipmentDetails: TrivaraShipmentDetails,
  syncedAt: string
) {
  if (!hasTrivaraFulfillmentDetails(shipmentDetails)) {
    return
  }

  const { data: orderRow, error: orderMetadataError } = await supabase
    .from("orders")
    .select("metadata")
    .eq("id", orderId)
    .maybeSingle()

  if (orderMetadataError) {
    throw new Error(orderMetadataError.message)
  }

  const orderMetadata = orderRow as { metadata: Record<string, unknown> | null } | null
  const orderUpdate: {
    metadata: Record<string, unknown>
    tracking_number?: string
  } = {
    metadata: mergeTrivaraFulfillmentMetadata(orderMetadata?.metadata, {
      ...shipmentDetails,
      syncedAt,
    }),
  }

  if (shipmentDetails.awb) {
    orderUpdate.tracking_number = shipmentDetails.awb
  }

  const { error: orderShipmentError } = await supabase
    .from("orders")
    .update(orderUpdate)
    .eq("id", orderId)

  if (orderShipmentError) {
    throw new Error(orderShipmentError.message)
  }
}

async function storeTrivaraTrackingSync(params: {
  supabase: AdminSupabaseClient
  booking: TrivaraOrderBooking
  remoteStatus: string | null
  visibleTrivaraOrderId: string | null
  shipmentDetails: TrivaraShipmentDetails
  trackingPayload: Record<string, unknown>
  syncedAt: string
  errorMessage: string | null
}) {
  const { error: trackingUpdateError } = await params.supabase
    .from("trivara_order_bookings")
    .update({
      tracking_status:
        params.shipmentDetails.shipmentStatus ||
        params.remoteStatus ||
        params.booking.tracking_status,
      tracking_payload: params.trackingPayload,
      tracking_synced_at: params.syncedAt,
      trivara_order_id:
        params.visibleTrivaraOrderId || params.booking.trivara_order_id,
      trivara_order_status:
        params.remoteStatus || params.booking.trivara_order_status,
      error_message: params.errorMessage,
      updated_at: params.syncedAt,
    })
    .eq("order_id", params.booking.order_id)

  if (trackingUpdateError) {
    throw new Error(trackingUpdateError.message)
  }

  await updateOrderShipmentDetails(
    params.supabase,
    params.booking.order_id,
    params.shipmentDetails,
    params.syncedAt
  )
}

async function storeTrivaraCancellationSync(params: {
  supabase: AdminSupabaseClient
  booking: TrivaraOrderBooking
  remoteStatus: string | null
  cancelPayload: Record<string, unknown>
  syncedAt: string
  source: TrivaraSyncSource
}) {
  if (!isCancelledTrivaraStatus(params.remoteStatus)) {
    return
  }

  const { error: cancellationUpdateError } = await params.supabase
    .from("trivara_order_bookings")
    .update({
      status: "cancelled",
      cancel_payload: params.cancelPayload,
      cancel_error_message: null,
      cancelled_at: params.syncedAt,
      trivara_order_status: params.remoteStatus,
      updated_at: params.syncedAt,
    })
    .eq("order_id", params.booking.order_id)

  if (cancellationUpdateError) {
    throw new Error(cancellationUpdateError.message)
  }

  await cancelToyckerOrderFromTrivara(params.booking.order_id, params.source)
}

function revalidateTrivaraSyncedOrder(orderId: string) {
  revalidateLogistics(orderId)
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath("/admin/orders")
  revalidatePath(`/order/confirmed/${orderId}`)
  revalidatePath(`/account/orders/details/${orderId}`)
}

async function applyTrivaraPayloadToBooking(params: {
  supabase: AdminSupabaseClient
  booking: TrivaraOrderBooking
  payload: Record<string, unknown>
  source: TrivaraSyncSource
  trackingPayload?: Record<string, unknown>
}): Promise<TrivaraRemoteSyncResult> {
  const remoteStatus = extractTrivaraOrderStatus(params.payload)
  const visibleTrivaraOrderId =
    extractTrivaraOrderId(params.payload) || params.booking.trivara_order_id
  let shipmentDetails = extractTrivaraShipmentDetails(params.payload)
  let trackingPayload: Record<string, unknown> =
    params.trackingPayload || { [params.source]: params.payload }

  if (!shipmentDetails.awb && shipmentDetails.shipmentId) {
    try {
      const config = getTrivaraNewApiConfig()

      if (config.orderSyncEnabled) {
        const shipmentResponse = await sendTrivaraGetShipment(
          shipmentDetails.shipmentId,
          config
        )
        const shipmentResponseDetails = extractTrivaraShipmentDetails(
          shipmentResponse.responsePayload
        )

        shipmentDetails = mergeShipmentDetails(
          shipmentDetails,
          shipmentResponseDetails
        )
        trackingPayload = {
          ...trackingPayload,
          shipment: shipmentResponse.responsePayload,
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      trackingPayload = {
        ...trackingPayload,
        shipment_sync_error: message,
      }
    }
  }

  const syncedAt = new Date().toISOString()

  await storeTrivaraTrackingSync({
    supabase: params.supabase,
    booking: params.booking,
    remoteStatus,
    visibleTrivaraOrderId,
    shipmentDetails,
    trackingPayload,
    syncedAt,
    errorMessage: null,
  })

  await storeTrivaraCancellationSync({
    supabase: params.supabase,
    booking: params.booking,
    remoteStatus,
    cancelPayload: params.payload,
    syncedAt,
    source: params.source,
  })

  revalidateTrivaraSyncedOrder(params.booking.order_id)

  return {
    ok: true,
    orderId: params.booking.order_id,
    trivaraOrderId: visibleTrivaraOrderId,
    message: "Trivara payload synced to Toycker.",
  }
}

async function syncTrivaraBookingFromRemote(params: {
  supabase: AdminSupabaseClient
  booking: TrivaraOrderBooking
  source: TrivaraSyncSource
  triggerPayload?: Record<string, unknown>
}): Promise<TrivaraRemoteSyncResult> {
  const trivaraApiOrderId = getTrivaraApiOrderIdFromBooking(params.booking)

  if (!trivaraApiOrderId) {
    return {
      ok: false,
      orderId: params.booking.order_id,
      error: "Trivara internal API order ID was not found for sync.",
    }
  }

  const config = getTrivaraNewApiConfig()
  if (!config.orderSyncEnabled) {
    return {
      ok: false,
      orderId: params.booking.order_id,
      error: "Trivara order sync is disabled in environment settings.",
    }
  }

  const response = await sendTrivaraGetOrder(trivaraApiOrderId, config)
  const remoteStatus = extractTrivaraOrderStatus(response.responsePayload)
  const visibleTrivaraOrderId =
    extractTrivaraOrderId(response.responsePayload) || params.booking.trivara_order_id
  let shipmentDetails = extractTrivaraShipmentDetails(response.responsePayload)
  let trackingPayload: Record<string, unknown> = params.triggerPayload
    ? { trigger: params.triggerPayload, order: response.responsePayload }
    : { order: response.responsePayload }

  if (response.ok && !shipmentDetails.awb && shipmentDetails.shipmentId) {
    const shipmentResponse = await sendTrivaraGetShipment(
      shipmentDetails.shipmentId,
      config
    )
    const shipmentResponseDetails = extractTrivaraShipmentDetails(
      shipmentResponse.responsePayload
    )

    shipmentDetails = mergeShipmentDetails(
      shipmentDetails,
      shipmentResponseDetails
    )
    trackingPayload = {
      ...trackingPayload,
      shipment: shipmentResponse.responsePayload,
    }
  }

  const errorMessage = response.ok
    ? null
    : getTrivaraResponseBusinessError(response.responsePayload) ||
      `Trivara status sync failed with status ${response.status}`
  const syncedAt = new Date().toISOString()

  await storeTrivaraTrackingSync({
    supabase: params.supabase,
    booking: params.booking,
    remoteStatus,
    visibleTrivaraOrderId,
    shipmentDetails,
    trackingPayload,
    syncedAt,
    errorMessage,
  })

  if (!response.ok) {
    return {
      ok: false,
      orderId: params.booking.order_id,
      error: errorMessage || "Trivara status sync failed.",
    }
  }

  await storeTrivaraCancellationSync({
    supabase: params.supabase,
    booking: params.booking,
    remoteStatus,
    cancelPayload: response.responsePayload,
    syncedAt,
    source: params.source,
  })

  revalidateTrivaraSyncedOrder(params.booking.order_id)

  return {
    ok: true,
    orderId: params.booking.order_id,
    trivaraOrderId: visibleTrivaraOrderId,
    message: "Latest Trivara order data synced to Toycker.",
  }
}

export async function processTrivaraWebhookPayload(
  payload: Record<string, unknown>
): Promise<TrivaraWebhookProcessResult> {
  const supabase = await createAdminClient()
  const identifiers = getTrivaraWebhookIdentifiers(payload)
  const eventId = await createTrivaraWebhookEvent(supabase, payload, identifiers)
  const booking = await findBookingByWebhookPayload(supabase, payload)

  if (!booking) {
    const message = hasWebhookOrderIdentifier(identifiers)
      ? "Webhook received, but no Toycker logistics record matched it."
      : "Webhook received and ignored because it does not contain an order identifier."

    await updateTrivaraWebhookEvent(supabase, eventId, {
      status: "ignored",
      responseStatus: 200,
      errorMessage: hasWebhookOrderIdentifier(identifiers) ? message : null,
    })

    return {
      matched: false,
      eventId,
      message,
      error: hasWebhookOrderIdentifier(identifiers) ? message : undefined,
    }
  }

  const remoteResult = await syncTrivaraBookingFromRemote({
    supabase,
    booking,
    source: "webhook",
    triggerPayload: payload,
  })
  const fallbackResult = remoteResult.ok
    ? remoteResult
    : await applyTrivaraPayloadToBooking({
        supabase,
        booking,
        payload,
        source: "webhook",
      })

  await updateTrivaraWebhookEvent(supabase, eventId, {
    status: fallbackResult.ok ? "processed" : "failed",
    responseStatus: fallbackResult.ok ? 200 : 500,
    matchedOrderId: booking.order_id,
    errorMessage: fallbackResult.ok ? null : fallbackResult.error,
  })

  if (!fallbackResult.ok) {
    throw new Error(fallbackResult.error)
  }

  return {
    matched: true,
    orderId: booking.order_id,
    updated: true,
    eventId,
    message: fallbackResult.message,
  }
}

export async function syncRecentTrivaraBookings(
  limit = 10
): Promise<TrivaraRemoteSyncResult[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 25)
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("trivara_order_bookings")
    .select("*")
    .in("status", ["pending", "new_order", "booked"])
    .order("tracking_synced_at", { ascending: true, nullsFirst: true })
    .order("updated_at", { ascending: false })
    .limit(safeLimit)

  if (error) {
    throw new Error(error.message)
  }

  const bookings = (data || []) as TrivaraOrderBooking[]
  const results: TrivaraRemoteSyncResult[] = []

  for (const booking of bookings) {
    try {
      results.push(
        await syncTrivaraBookingFromRemote({
          supabase,
          booking,
          source: "fallback",
        })
      )
    } catch (error) {
      results.push({
        ok: false,
        orderId: booking.order_id,
        error: error instanceof Error ? error.message : "Unknown sync error",
      })
    }
  }

  return results
}

export async function syncTrivaraOrderStatus(orderId: string) {
  await ensureAdmin()
  await requirePermission(PERMISSIONS.SHIPPING_UPDATE)

  const supabase = await createAdminClient()
  const booking = await getBooking(orderId)
  const result = await syncTrivaraBookingFromRemote({
    supabase,
    booking,
    source: "manual_sync",
  })

  if (!result.ok) {
    throw new Error(result.error)
  }
}export async function retryTrivaraBooking(orderId: string) {
  await retryTrivaraBookingForOrder(orderId)
  revalidateLogistics(orderId)
}

export async function cancelTrivaraOrder(orderId: string) {
  await ensureAdmin()
  await requirePermission(PERMISSIONS.SHIPPING_UPDATE)
  await cancelOrder(orderId)
  revalidateLogistics(orderId)
}
