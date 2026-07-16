import Link from "next/link"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  CubeIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline"
import AdminBadge from "@modules/admin/components/admin-badge"
import AdminCard from "@modules/admin/components/admin-card"
import { convertToLocale } from "@lib/util/money"
import { formatIST } from "@/lib/util/date"
import {
  cancelTrivaraOrder,
  getTrivaraLogisticsRecord,
  retryTrivaraBooking,
  syncTrivaraOrderStatus,
} from "@/lib/data/trivara-logistics"
import { TrivaraOrderBookingStatus } from "@/lib/supabase/types"
import {
  getPaymentMethodDisplay,
  getPaymentStatusDisplay,
  isPartialPaymentMethod,
} from "@/lib/util/payment-status"
import { getPartialPaymentDisplayData } from "@/lib/util/order-pricing"
import { extractTrivaraApiOrderId } from "@/lib/integrations/trivara"
import {
  getTrivaraFulfillmentMetadata,
  getTrivaraTrackingUrl,
} from "@/lib/util/trivara-fulfillment"

type Props = {
  params: Promise<{ orderId: string }>
}

function getStatusBadge(status: TrivaraOrderBookingStatus) {
  switch (status) {
    case "new_order":
      return { variant: "info" as const, label: "New Order" }
    case "booked":
      return { variant: "success" as const, label: "Legacy Booked" }
    case "pending":
      return { variant: "info" as const, label: "Pending" }
    case "failed":
      return { variant: "error" as const, label: "Failed" }
    case "skipped":
      return { variant: "warning" as const, label: "Skipped" }
    case "cancelled":
      return { variant: "neutral" as const, label: "Cancelled" }
  }
}

function getRemoteStatusBadgeVariant(status: string | null | undefined) {
  const normalized = status?.trim().toLowerCase() || ""

  if (!normalized) {
    return "neutral" as const
  }

  if (["new order", "created", "order created", "success"].includes(normalized)) {
    return "info" as const
  }

  if (["cancelled", "canceled"].includes(normalized)) {
    return "neutral" as const
  }

  if (["failed", "failure", "error"].includes(normalized)) {
    return "error" as const
  }

  return "warning" as const
}

function formatStatusLabel(value: string | null | undefined): string {
  if (!value) {
    return "-"
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getCurrentTrivaraStatus(
  record: Awaited<ReturnType<typeof getTrivaraLogisticsRecord>>
): string | null {
  if (!record) {
    return null
  }

  if (record.trivara_order_status) {
    return record.trivara_order_status
  }

  if (record.status === "new_order") {
    return "New Order"
  }

  if (record.status === "booked") {
    return "Legacy Booked"
  }

  return formatStatusLabel(record.status)
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-3 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-right text-sm font-medium text-gray-900">
        {value || "-"}
      </span>
    </div>
  )
}

function MetricCell({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <div className="mt-1 break-words text-sm font-semibold text-gray-900">
        {value ?? "-"}
      </div>
    </div>
  )
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asDisplayValue(value: unknown): string | number | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }

  if (typeof value === "number") {
    return value
  }

  return null
}

function getPayloadValue(
  payload: Record<string, unknown> | null,
  keys: string[]
): unknown {
  const queue: unknown[] = payload ? [payload] : []

  while (queue.length > 0) {
    const current = queue.shift()

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    if (!isObjectRecord(current)) {
      continue
    }

    for (const [key, value] of Object.entries(current)) {
      if (keys.includes(key)) {
        return value
      }

      if (isObjectRecord(value) || Array.isArray(value)) {
        queue.push(value)
      }
    }
  }

  return null
}

function getPayloadNumberOrString(
  payload: Record<string, unknown> | null,
  keys: string[]
): string | number | null {
  const value = getPayloadValue(payload, keys)
  return asDisplayValue(value)
}

function toDiagnosticNumber(value: string | number | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatCurrencyDiagnostic(
  amount: number | null | undefined,
  currencyCode: string | null | undefined
): string | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return null
  }

  return convertToLocale({
    amount,
    currency_code: currencyCode || "inr",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function getDimensions(payload: Record<string, unknown> | null): string | null {
  const dimensions = getPayloadNumberOrString(payload, ["dimensions"])

  if (dimensions) {
    return String(dimensions)
  }

  const length = getPayloadNumberOrString(payload, ["lengthCm"])
  const width = getPayloadNumberOrString(payload, ["widthCm"])
  const height = getPayloadNumberOrString(payload, ["heightCm"])

  if (!length || !width || !height) {
    return null
  }

  return `${length} x ${width} x ${height} cm`
}

function getWeight(payload: Record<string, unknown> | null): string | null {
  const weightKg = getPayloadNumberOrString(payload, ["weightKg"])
  return weightKg ? `${weightKg} kg` : null
}

function getFirstDataRecord(
  payload: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!payload) {
    return null
  }

  if (
    ["status", "orderStatus", "order_status", "message", "orderId", "order_id", "id", "_id"].some(
      (key) => key in payload
    )
  ) {
    return payload
  }

  const data = payload.data

  if (Array.isArray(data)) {
    const firstRecord = data.find(isObjectRecord)
    return firstRecord || null
  }

  if (isObjectRecord(data)) {
    return data
  }

  return null
}

function getRecordValue(
  record: Record<string, unknown> | null,
  keys: string[]
): string | number | null {
  if (!record) {
    return null
  }

  for (const key of keys) {
    const value = asDisplayValue(record[key])

    if (value !== null) {
      return value
    }
  }

  return null
}

function getBookingResult(payload: Record<string, unknown> | null) {
  const data = getFirstDataRecord(payload)

  return {
    status: getRecordValue(data, ["orderStatus", "order_status", "status"]),
    message: getRecordValue(data, ["message"]),
    result: getRecordValue(data, ["result"]),
  }
}

function getCancelResult(payload: Record<string, unknown> | null) {
  const data = getFirstDataRecord(payload)

  return {
    status: getRecordValue(data, ["orderStatus", "order_status", "status"]),
    message: getRecordValue(data, ["message"]),
    result: getRecordValue(data, ["result"]),
  }
}

function getRequestItems(payload: Record<string, unknown> | null): unknown[] {
  return Array.isArray(payload?.items) ? payload.items : []
}

type PackageItemView = {
  sku: string | number | null
  name: string
  quantity: string | number | null
  amount: string | number | null
}

function getPackageItems(
  payload: Record<string, unknown> | null
): PackageItemView[] {
  const items = getRequestItems(payload)

  if (items.length === 0) {
    return []
  }

  return items.filter(isObjectRecord).map((item, index) => {
    const name = getRecordValue(item, ["name"])

    return {
      sku: getRecordValue(item, ["sku"]),
      name: typeof name === "string" ? name : `Item ${index + 1}`,
      quantity: getRecordValue(item, ["quantity"]),
      amount: getRecordValue(item, ["price"]),
    }
  })
}

function moneyValue(value: string | number | null): string {
  if (typeof value === "number") {
    return `Rs. ${value}`
  }

  return value ? `Rs. ${value}` : "-"
}
function PackageItemsCard({ items }: { items: PackageItemView[] }) {
  return (
    <AdminCard title="Package Items">
      {items.length > 0 ? (
        <div className="divide-y divide-gray-100">
          {items.map((item, index) => (
            <div
              key={`${item.sku || "item"}-${index}`}
              className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-start md:justify-between"
            >
              <div className="flex min-w-0 gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                  <CubeIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-gray-900">
                    {item.name}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    SKU: {item.sku || "-"} - Qty: {item.quantity || "-"}
                  </p>
                </div>
              </div>
              <p className="text-sm font-semibold text-gray-900">
                {moneyValue(item.amount)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Package item details are not available in the Trivara request payload.
        </p>
      )}
    </AdminCard>
  )
}

type LogisticsDetailRecord = NonNullable<
  Awaited<ReturnType<typeof getTrivaraLogisticsRecord>>
>

function getCancellationDetails(record: LogisticsDetailRecord) {
  const event = record.cancellation_event
  const eventActor = event?.actor?.trim()
  const eventTitle = event?.title?.trim()
  const eventDescription = event?.description?.trim()
  const normalizedActor = eventActor?.toLowerCase() || ""
  const currentStatus = getCurrentTrivaraStatus(record)?.trim().toLowerCase()
  const remoteCancelled = currentStatus === "cancelled" || currentStatus === "canceled"
  const isCancelled =
    record.status === "cancelled" ||
    record.order?.status === "cancelled" ||
    Boolean(record.cancelled_at) ||
    remoteCancelled

  if (!isCancelled) {
    return null
  }

  const source = normalizedActor.includes("trivara")
    ? "Trivara dashboard"
    : normalizedActor === "system"
      ? "Toycker system"
      : eventActor
        ? "Toycker admin"
        : "Not recorded"

  return {
    cancelledBy: eventActor || "Not recorded",
    source,
    cancelledAt: event?.created_at || record.cancelled_at,
    note:
      eventDescription ||
      eventTitle ||
      (record.cancel_error_message
        ? `Trivara cancellation error: ${record.cancel_error_message}`
        : null),
  }
}

export default async function AdminLogisticsDetail({ params }: Props) {
  const { orderId } = await params
  const record = await getTrivaraLogisticsRecord(orderId)

  if (!record) {
    notFound()
  }

  const statusBadge = getStatusBadge(record.status)
  const canRetry = record.status === "failed" || record.status === "skipped"
  const hasTrivaraOrderId = Boolean(record.trivara_order_id)
  const trivaraApiOrderId = extractTrivaraApiOrderId(record.response_payload)
  const currentTrivaraStatus = getCurrentTrivaraStatus(record)
  const bookingResult = getBookingResult(record.response_payload)
  const cancelResult = getCancelResult(record.cancel_payload)
  const packageItems = getPackageItems(record.request_payload)
  const orderPaymentStatus = record.order
    ? getPaymentStatusDisplay({
        paymentStatus: record.order.payment_status,
        paymentMethod: record.order.payment_method,
        orderStatus: record.order.status,
      })
    : null
  const partialPaymentData = record.order
    ? getPartialPaymentDisplayData(record.order.metadata)
    : null
  const diagnosticBillAmount = record.order
    ? formatCurrencyDiagnostic(
        record.order.total_amount,
        record.order.currency_code
      )
    : null
  const payloadCodAmount = toDiagnosticNumber(
    getPayloadNumberOrString(record.request_payload, ["codAmount"])
  )
  const diagnosticCodAmount =
    record.order &&
    isPartialPaymentMethod(record.order.payment_method) &&
    partialPaymentData?.balancePaymentStatus === "pending"
      ? formatCurrencyDiagnostic(
          partialPaymentData.balanceRemainingAmount,
          record.order.currency_code
        )
      : record.order &&
          (record.order.payment_method || "").toLowerCase().includes("cash")
        ? formatCurrencyDiagnostic(
            record.order.total_amount,
            record.order.currency_code
          )
        : formatCurrencyDiagnostic(payloadCodAmount, record.order?.currency_code)
  const canCancelOrder = Boolean(
    record.order &&
      ["pending", "order_placed", "accepted"].includes(record.order.status)
  )
  const canSyncTrivaraCancellation = Boolean(
    record.order &&
      ["cancelled", "failed"].includes(record.order.status) &&
      record.status !== "cancelled" &&
      hasTrivaraOrderId
  )
  const canSyncRemoteStatus = Boolean(
    hasTrivaraOrderId && record.status !== "cancelled"
  )
  const cancellationDetails = getCancellationDetails(record)
  const trivaraFulfillment = getTrivaraFulfillmentMetadata(record.order?.metadata)
  const awbNumber = record.order?.tracking_number || trivaraFulfillment?.awb || null
  const courierName = trivaraFulfillment?.courierName || null
  const shipmentTrackingUrl = getTrivaraTrackingUrl(trivaraFulfillment, awbNumber)

  return (
    <div className="space-y-6">
      <nav className="flex items-center text-xs font-bold uppercase tracking-widest text-gray-400">
        <Link
          href="/admin/logistics"
          className="flex items-center transition-colors hover:text-black"
        >
          <ChevronLeftIcon className="mr-1 h-3 w-3" strokeWidth={3} />
          Back to Logistics
        </Link>
      </nav>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-black tracking-tighter text-gray-900">
              Logistics #{record.order?.display_id || record.order_id}
            </h1>
            <AdminBadge variant={statusBadge.variant}>{statusBadge.label}</AdminBadge>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Trivara Order ID: {" "}
            <span className="font-mono text-gray-800">
              {record.trivara_order_id || "Not created yet"}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canRetry && (
            <form action={retryTrivaraBooking.bind(null, record.order_id)}>
              <button className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700">
                <ArrowPathIcon className="h-4 w-4" />
                Retry Sync
              </button>
            </form>
          )}
          {canSyncRemoteStatus && (
            <form action={syncTrivaraOrderStatus.bind(null, record.order_id)}>
              <button className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                <ArrowPathIcon className="h-4 w-4" />
                Sync from Trivara
              </button>
            </form>
          )}
          {(canCancelOrder || canSyncTrivaraCancellation) && (
            <form action={cancelTrivaraOrder.bind(null, record.order_id)}>
              <button className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">
                <XCircleIcon className="h-4 w-4" />
                {canCancelOrder ? "Cancel Order" : "Cancel Trivara"}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <AdminCard title="Trivara Status">
          <DetailRow
            label="Sync status"
            value={<AdminBadge variant={statusBadge.variant}>{statusBadge.label}</AdminBadge>}
          />
          <DetailRow
            label="Remote status"
            value={
              <AdminBadge variant={getRemoteStatusBadgeVariant(currentTrivaraStatus)}>
                {formatStatusLabel(currentTrivaraStatus)}
              </AdminBadge>
            }
          />

          <DetailRow
            label="New Order created"
            value={
              record.new_order_created_at
                ? formatIST(record.new_order_created_at)
                : null
            }
          />
          <DetailRow label="Last updated" value={formatIST(record.updated_at)} />
        </AdminCard>

        <AdminCard title="Toycker Order">
          <DetailRow
            label="Order"
            value={record.order ? `#${record.order.display_id}` : record.order_id}
          />
          <DetailRow label="Customer" value={record.order?.customer_email} />
          <DetailRow label="Order status" value={record.order?.status} />
          <DetailRow
            label="Payment"
            value={
              record.order
                ? `${getPaymentMethodDisplay(record.order.payment_method)}${
                    orderPaymentStatus ? ` - ${orderPaymentStatus.label}` : ""
                  }`
                : null
            }
          />
          <DetailRow
            label="Total"
            value={
              record.order
                ? convertToLocale({
                    amount: record.order.total_amount,
                    currency_code: record.order.currency_code,
                  })
                : null
            }
          />
        </AdminCard>

        <AdminCard title="Delivery Address">
          <DetailRow
            label="Name"
            value={`${record.order?.shipping_address?.first_name || ""} ${
              record.order?.shipping_address?.last_name || ""
            }`.trim()}
          />
          <DetailRow
            label="Address"
            value={[
              record.order?.shipping_address?.address_1,
              record.order?.shipping_address?.address_2,
            ]
              .filter((value): value is string => Boolean(value))
              .join(", ")}
          />
          <DetailRow label="City" value={record.order?.shipping_address?.city} />
          <DetailRow
            label="State"
            value={record.order?.shipping_address?.province}
          />
          <DetailRow
            label="Pincode"
            value={record.order?.shipping_address?.postal_code}
          />
          <DetailRow label="Phone" value={record.order?.shipping_address?.phone} />
        </AdminCard>
      </div>

      <AdminCard title="Logistics Payload Summary">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <MetricCell
            label="Pickup address ID"
            value={getPayloadNumberOrString(record.request_payload, ["pickupAddressId"])}
          />
          <MetricCell
            label="External order ID"
            value={getPayloadNumberOrString(record.request_payload, ["externalOrderId"])}
          />
          <MetricCell
            label="Payment mode"
            value={getPayloadNumberOrString(record.request_payload, ["paymentMode"])}
          />
          <MetricCell label="Bill amount" value={diagnosticBillAmount} />
          <MetricCell label="COD collection amount" value={diagnosticCodAmount} />
          <MetricCell
            label="Delivery pincode"
            value={getPayloadNumberOrString(record.request_payload, ["pincode"])}
          />
          <MetricCell label="Weight" value={getWeight(record.request_payload)} />
          <MetricCell label="Dimensions" value={getDimensions(record.request_payload)} />
        </div>
      </AdminCard>
      <AdminCard title="Shipment Details">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <MetricCell label="AWB number" value={awbNumber} />
          <MetricCell label="Courier" value={courierName} />
          <MetricCell
            label="Shipment status"
            value={trivaraFulfillment?.shipmentStatus}
          />
          <MetricCell label="Shipment ID" value={trivaraFulfillment?.shipmentId} />
          <MetricCell
            label="Last synced"
            value={
              trivaraFulfillment?.syncedAt
                ? formatIST(trivaraFulfillment.syncedAt)
                : null
            }
          />
          <MetricCell
            label="Tracking link"
            value={
              shipmentTrackingUrl ? (
                <a
                  href={shipmentTrackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-700 hover:text-indigo-900"
                >
                  Track shipment
                </a>
              ) : null
            }
          />
        </div>
      </AdminCard>

      {(record.error_message || record.cancel_error_message) && (
        <AdminCard title="Errors">
          {record.error_message && (
            <p className="text-sm font-medium text-red-700">
              {record.error_message}
            </p>
          )}
          {record.cancel_error_message && (
            <p className="mt-2 text-sm text-red-700">
              {record.cancel_error_message}
            </p>
          )}
        </AdminCard>
      )}

      {cancellationDetails && (
        <AdminCard title="Cancellation Details">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCell
              label="Cancelled at"
              value={
                cancellationDetails.cancelledAt
                  ? formatIST(cancellationDetails.cancelledAt)
                  : null
              }
            />
            <MetricCell
              label="Cancelled by"
              value={cancellationDetails.cancelledBy}
            />
            <MetricCell
              label="Cancellation source"
              value={cancellationDetails.source}
            />
            <MetricCell
              label="Cancellation note"
              value={cancellationDetails.note}
            />
          </div>
        </AdminCard>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PackageItemsCard items={packageItems} />

        <AdminCard title="Technical Details">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-indigo-700 outline-none transition-colors hover:text-indigo-800">
              Show Trivara API and response details
            </summary>
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MetricCell label="Trivara API ID" value={trivaraApiOrderId} />
                <MetricCell
                  label="Response status"
                  value={
                    bookingResult.status ? (
                      <AdminBadge
                        variant={getRemoteStatusBadgeVariant(String(bookingResult.status))}
                      >
                        {formatStatusLabel(String(bookingResult.status))}
                      </AdminBadge>
                    ) : null
                  }
                />
                <MetricCell label="Response message" value={bookingResult.message} />
                <MetricCell label="Response result" value={bookingResult.result} />
              </div>

              {(cancelResult.status || cancelResult.message || cancelResult.result) && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Cancellation response
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <MetricCell
                      label="Status"
                      value={
                        cancelResult.status ? (
                          <AdminBadge
                            variant={getRemoteStatusBadgeVariant(String(cancelResult.status))}
                          >
                            {formatStatusLabel(String(cancelResult.status))}
                          </AdminBadge>
                        ) : null
                      }
                    />
                    <MetricCell label="Message" value={cancelResult.message} />
                    <MetricCell label="Result" value={cancelResult.result} />
                  </div>
                </div>
              )}
            </div>
          </details>
        </AdminCard>
      </div>
    </div>
  )
}
