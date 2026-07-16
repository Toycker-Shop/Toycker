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
} from "@/lib/supabase/types"
import {
  extractTrivaraApiOrderId,
  extractTrivaraOrderId,
  extractTrivaraOrderStatus,
  extractTrivaraShipmentDetails,
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

async function cancelToyckerOrderFromTrivara(orderId: string) {
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
      { provider: "trivara", source: "manual_sync" }
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
    { provider: "trivara", source: "manual_sync" }
  )
}

export async function syncTrivaraOrderStatus(orderId: string) {
  await ensureAdmin()
  await requirePermission(PERMISSIONS.SHIPPING_UPDATE)

  const booking = await getBooking(orderId)
  const visibleTrivaraOrderId =
    booking.trivara_order_id || extractTrivaraOrderId(booking.response_payload)
  const fallbackApiOrderId =
    visibleTrivaraOrderId && !visibleTrivaraOrderId.toUpperCase().startsWith("TRV-")
      ? visibleTrivaraOrderId
      : null
  const trivaraApiOrderId =
    extractTrivaraApiOrderId(booking.response_payload) || fallbackApiOrderId

  if (!trivaraApiOrderId) {
    throw new Error("Trivara internal API order ID was not found for sync.")
  }

  const config = getTrivaraNewApiConfig()
  if (!config.orderSyncEnabled) {
    throw new Error("Trivara order sync is disabled in environment settings.")
  }

  const response = await sendTrivaraGetOrder(trivaraApiOrderId, config)
  const remoteStatus = extractTrivaraOrderStatus(response.responsePayload)
  let shipmentDetails = extractTrivaraShipmentDetails(response.responsePayload)
  let trackingPayload: Record<string, unknown> = response.responsePayload

  if (response.ok && !shipmentDetails.awb && shipmentDetails.shipmentId) {
    const shipmentResponse = await sendTrivaraGetShipment(
      shipmentDetails.shipmentId,
      config
    )
    const shipmentResponseDetails = extractTrivaraShipmentDetails(
      shipmentResponse.responsePayload
    )

    shipmentDetails = {
      awb: shipmentDetails.awb || shipmentResponseDetails.awb,
      courierName: shipmentDetails.courierName || shipmentResponseDetails.courierName,
      shipmentId: shipmentDetails.shipmentId || shipmentResponseDetails.shipmentId,
      shipmentStatus:
        shipmentDetails.shipmentStatus || shipmentResponseDetails.shipmentStatus,
      trackingUrl: shipmentDetails.trackingUrl || shipmentResponseDetails.trackingUrl,
    }
    trackingPayload = {
      order: response.responsePayload,
      shipment: shipmentResponse.responsePayload,
    }
  }

  const errorMessage = response.ok
    ? null
    : getTrivaraResponseBusinessError(response.responsePayload) ||
      `Trivara status sync failed with status ${response.status}`
  const supabase = await createAdminClient()
  const syncedAt = new Date().toISOString()

  const { error: trackingUpdateError } = await supabase
    .from("trivara_order_bookings")
    .update({
      tracking_status: shipmentDetails.shipmentStatus || remoteStatus,
      tracking_payload: trackingPayload,
      tracking_synced_at: syncedAt,
      trivara_order_id: visibleTrivaraOrderId,
      trivara_order_status: remoteStatus || booking.trivara_order_status,
      error_message: response.ok ? null : errorMessage,
    })
    .eq("order_id", orderId)

  if (trackingUpdateError) {
    throw new Error(trackingUpdateError.message)
  }

  if (!response.ok) {
    throw new Error(errorMessage || "Trivara status sync failed.")
  }

  if (hasTrivaraFulfillmentDetails(shipmentDetails)) {
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

  if (isCancelledTrivaraStatus(remoteStatus)) {
    const cancelledAt = new Date().toISOString()
    const { error: cancellationUpdateError } = await supabase
      .from("trivara_order_bookings")
      .update({
        status: "cancelled",
        cancel_payload: response.responsePayload,
        cancel_error_message: null,
        cancelled_at: cancelledAt,
        trivara_order_status: remoteStatus,
      })
      .eq("order_id", orderId)

    if (cancellationUpdateError) {
      throw new Error(cancellationUpdateError.message)
    }

    await cancelToyckerOrderFromTrivara(orderId)
  }

  revalidateLogistics(orderId)
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath("/admin/orders")
  revalidatePath(`/order/confirmed/${orderId}`)
  revalidatePath(`/account/orders/details/${orderId}`)
}
export async function retryTrivaraBooking(orderId: string) {
  await retryTrivaraBookingForOrder(orderId)
  revalidateLogistics(orderId)
}

export async function cancelTrivaraOrder(orderId: string) {
  await ensureAdmin()
  await requirePermission(PERMISSIONS.SHIPPING_UPDATE)
  await cancelOrder(orderId)
  revalidateLogistics(orderId)
}
