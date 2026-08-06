import Link from "next/link"
import { ArrowPathIcon, XCircleIcon } from "@heroicons/react/24/outline"
import AdminBadge from "@modules/admin/components/admin-badge"
import AdminPageHeader from "@modules/admin/components/admin-page-header"
import RealtimeLogisticsListener from "@modules/admin/components/realtime-logistics-listener"
import { AdminPagination } from "@modules/admin/components/admin-pagination"
import { AdminSearchInput } from "@modules/admin/components/admin-search-input"
import { AdminTableWrapper } from "@modules/admin/components/admin-table-wrapper"
import { ClickableTableRow } from "@modules/admin/components/clickable-table-row"
import { SubmitButton } from "@modules/admin/components"
import { convertToLocale } from "@lib/util/money"
import { formatIST } from "@/lib/util/date"
import {
  cancelTrivaraOrder,
  getTrivaraLogisticsRecords,
  getTrivaraLogisticsStatusCounts,
  retryTrivaraBooking,
  syncTrivaraOrderStatus,
} from "@/lib/data/trivara-logistics"
import { TrivaraOrderBookingStatus } from "@/lib/supabase/types"
import {
  getPaymentMethodDisplay,
  getPaymentStatusDisplay,
} from "@/lib/util/payment-status"

const STATUS_FILTERS: Array<{
  label: string
  value: TrivaraOrderBookingStatus | "all"
}> = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Failed", value: "failed" },
  { label: "Skipped", value: "skipped" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Booked", value: "booked" },
]

function formatRemoteStatus(record: {
  status: TrivaraOrderBookingStatus
  trivara_order_id: string | null
  trivara_order_status: string | null
}) {
  if (record.status === "booked" && !record.trivara_order_id) {
    return "Legacy Booked"
  }

  const value = record.trivara_order_status?.trim()

  if (!value) {
    return "-"
  }

  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_")

  if (normalized === "new_order" || normalized === "pending_approval") {
    return "Pending Approval"
  }

  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getRemoteStatusBadgeVariant(
  status: string | null,
  bookingStatus: TrivaraOrderBookingStatus,
  trivaraOrderId: string | null
) {
  if (bookingStatus === "booked" && !trivaraOrderId) {
    return "neutral" as const
  }

  const normalized = status?.trim().toLowerCase().replace(/[\s-]+/g, "_") || ""

  if (!normalized) {
    return "neutral" as const
  }

  if (["new_order", "pending", "pending_approval", "created", "order_created", "success"].includes(normalized)) {
    return "info" as const
  }

  if (["booked", "assigned", "ready_to_ship", "pickup_scheduled", "in_transit", "out_for_delivery"].includes(normalized)) {
    return "warning" as const
  }

  if (["delivered"].includes(normalized)) {
    return "success" as const
  }

  if (["cancelled", "canceled"].includes(normalized)) {
    return "neutral" as const
  }

  if (["failed", "failure", "error", "undelivered", "lost", "rto", "rto_initiated", "rto_in_transit", "rto_delivered"].includes(normalized)) {
    return "error" as const
  }

  return "neutral" as const
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "gray" | "blue" | "red" | "amber"
}) {
  const toneClass = {
    gray: "bg-gray-50 text-gray-900",
    blue: "bg-blue-50 text-blue-900",
    red: "bg-red-50 text-red-900",
    amber: "bg-amber-50 text-amber-900",
  }[tone]

  return (
    <div className={`rounded-xl border border-admin-border p-4 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  )
}

export default async function AdminLogistics({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string
    search?: string
    status?: TrivaraOrderBookingStatus | "all"
  }>
}) {
  const {
    page = "1",
    search = "",
    status = "all",
  } = await searchParams
  const pageNumber = parseInt(page, 10) || 1
  const [{ records, count, totalPages, currentPage }, statusCounts] =
    await Promise.all([
      getTrivaraLogisticsRecords({
        page: pageNumber,
        limit: 20,
        search,
        status,
      }),
      getTrivaraLogisticsStatusCounts(),
    ])

  return (
    <div className="space-y-6">
      <RealtimeLogisticsListener />
      <AdminPageHeader
        title="Logistics"
        subtitle="Manage Trivara logistics syncs created from accepted Toycker orders. Pending approvals and shipment status come from Trivara."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total records" value={statusCounts.total} tone="gray" />
        <SummaryCard label="Pending approvals" value={statusCounts.pending} tone="blue" />
        <SummaryCard label="Failed syncs" value={statusCounts.failed} tone="red" />
        <SummaryCard label="Skipped syncs" value={statusCounts.skipped} tone="amber" />
      </div>

      <AdminSearchInput
        defaultValue={search}
        basePath="/admin/logistics"
        placeholder="Search by order ID, customer email, or Trivara order ID..."
      />

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((item) => {
          const active = item.value === status
          const href =
            item.value === "all"
              ? "/admin/logistics"
              : `/admin/logistics?status=${item.value}`

          return (
            <Link
              key={item.value}
              href={href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100"
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>

      <div className="text-sm text-gray-500">
        Showing {count > 0 ? (currentPage - 1) * 20 + 1 : 0} to{" "}
        {Math.min(currentPage * 20, count)} of {count} logistics records
      </div>

      <AdminTableWrapper className="rounded-xl border border-admin-border bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 table-auto">
          <thead className="bg-[#f7f8f9]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Order
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Customer
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Payment & Payment Method
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Last Sync
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Remote Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {records.map((record) => {
              const hasTrivaraOrderId = Boolean(record.trivara_order_id)
              const paymentStatus = record.order
                ? getPaymentStatusDisplay({
                    paymentStatus: record.order.payment_status,
                    paymentMethod: record.order.payment_method,
                    orderStatus: record.order.status,
                  })
                : null
              const canRetry =
                record.status === "failed" || record.status === "skipped"
              const canCancelOrder = Boolean(
                record.order &&
                  ["pending", "order_placed", "accepted"].includes(
                    record.order.status
                  )
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

              return (
                <ClickableTableRow
                  key={record.id}
                  href={`/admin/logistics/${record.order_id}`}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className="text-sm font-semibold tracking-tight text-gray-900 transition-colors group-hover:text-indigo-600">
                      #{record.order?.display_id || record.order_id}
                    </span>
                    <p className="mt-1 text-xs font-mono text-gray-400">
                      {record.trivara_order_id || "No Trivara order ID"}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {record.order ? formatIST(record.order.created_at) : "-"}
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-700">
                      {record.order?.customer_email || "Order not found"}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Toycker: {record.order?.status || "-"}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {paymentStatus ? (
                      <AdminBadge variant={paymentStatus.tone}>
                        {paymentStatus.label}
                      </AdminBadge>
                    ) : (
                      <span className="text-sm text-gray-400">-</span>
                    )}
                    <p className="mt-2 text-sm font-medium text-gray-600">
                      {getPaymentMethodDisplay(record.order?.payment_method)}
                    </p>
                    {record.order && (
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        {convertToLocale({
                          amount: record.order.total_amount,
                          currency_code: record.order.currency_code,
                        })}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {formatIST(record.updated_at)}
                  </td>
                  <td className="px-6 py-4">
                    <AdminBadge variant={getRemoteStatusBadgeVariant(record.trivara_order_status, record.status, record.trivara_order_id)}>
                      {formatRemoteStatus(record)}
                    </AdminBadge>
                  </td>
                  <td className="relative z-20 px-6 py-4">
                    <div className="flex flex-wrap justify-end gap-2">
                      {canRetry && (
                        <form action={retryTrivaraBooking.bind(null, record.order_id)}>
                          <SubmitButton
                            loadingText=""
                            title="Retry Sync"
                            aria-label="Retry Sync"
                            className="h-8 min-w-0 w-8 rounded-lg bg-indigo-600 p-0 text-white hover:bg-indigo-700"
                          >
                            <ArrowPathIcon className="h-4 w-4" />
                          </SubmitButton>
                        </form>
                      )}
                      {canSyncRemoteStatus && (
                        <form action={syncTrivaraOrderStatus.bind(null, record.order_id)}>
                          <SubmitButton
                            loadingText=""
                            title="Sync from Trivara"
                            aria-label="Sync from Trivara"
                            variant="secondary"
                            className="h-8 min-w-0 w-8 rounded-lg bg-blue-50 p-0 text-blue-700 hover:bg-blue-100"
                          >
                            <ArrowPathIcon className="h-4 w-4" />
                          </SubmitButton>
                        </form>
                      )}
                      {(canCancelOrder || canSyncTrivaraCancellation) && (
                        <form action={cancelTrivaraOrder.bind(null, record.order_id)}>
                          <SubmitButton
                            loadingText=""
                            title={canCancelOrder ? "Cancel Order" : "Cancel Trivara"}
                            aria-label={canCancelOrder ? "Cancel Order" : "Cancel Trivara"}
                            variant="secondary"
                            className="h-8 min-w-0 w-8 rounded-lg bg-red-50 p-0 text-red-700 hover:bg-red-100"
                          >
                            <XCircleIcon className="h-4 w-4" />
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </td>
                </ClickableTableRow>
              )
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center text-sm text-gray-500">
                  No Trivara logistics records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </AdminTableWrapper>

      <AdminPagination currentPage={currentPage} totalPages={totalPages} />
    </div>
  )
}
