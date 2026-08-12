import {
  getAdminOrders,
  type AdminOrderListItem,
  type AdminOrderTab,
} from "@/lib/data/admin"
import { convertToLocale } from "@lib/util/money"
import AdminBadge from "@modules/admin/components/admin-badge"
import AdminPageHeader from "@modules/admin/components/admin-page-header"
import { AdminPagination } from "@modules/admin/components/admin-pagination"
import { AdminSearchInput } from "@modules/admin/components/admin-search-input"
import Link from "next/link"
import { ShoppingBagIcon } from "@heroicons/react/24/outline"
import { formatIST } from "@/lib/util/date"
import { ClickableTableRow } from "@modules/admin/components/clickable-table-row"
import RealtimeOrdersListener from "@modules/admin/components/realtime-orders-listener"
import { AdminTableWrapper } from "@modules/admin/components/admin-table-wrapper"
import { expireStaleEasebuzzPendingPayments } from "@/lib/actions/cancel-pending-payment"
import { cn } from "@lib/util/cn"
import {
  getPaymentMethodDisplay,
  getPaymentStatusDisplay,
} from "@/lib/util/payment-status"

function normalizePaymentMethod(method?: string | null, hasPayuTxn?: string | null, hasGatewayTxn?: string | null) {
  if (!method && hasGatewayTxn) return "easebuzz"
  if (!method && hasPayuTxn) return "payu"
  const m = (method || "").toLowerCase()
  if (m.includes("cod") || m.includes("cash") || m.includes("pp_system_default")) return "cod"
  if (m.includes("partial")) return "easebuzz_partial"
  if (m.includes("easebuzz")) return "easebuzz"
  if (m.includes("payu")) return "payu"
  if (!method) return "manual"
  return method
}

function _formatPaymentMethodDisplay(method?: string | null, hasPayuTxn?: string | null, hasGatewayTxn?: string | null) {
  const normalized = normalizePaymentMethod(method, hasPayuTxn, hasGatewayTxn)
  if (normalized === "easebuzz") return "Easebuzz"
  if (normalized === "easebuzz_partial") return "Easebuzz Partial"
  if (normalized === "payu") return "PayU"
  if (normalized === "cod" || normalized === "manual") return "Cash on Delivery (COD)"
  const label = (method || "").replace(/_/g, " ").trim()
  return label ? label.replace(/\b\w/g, c => c.toUpperCase()) : "—"
}

function _getPaymentBadge(paymentStatus: string, paymentMethod?: string | null, hasPayuTxn?: string | null, orderStatus?: string | null, hasGatewayTxn?: string | null) {
  const normalizedMethod = normalizePaymentMethod(paymentMethod, hasPayuTxn, hasGatewayTxn)
  const isCOD = normalizedMethod === "cod" || normalizedMethod === "manual"
  const isEasebuzz = normalizedMethod === "easebuzz" || normalizedMethod === "easebuzz_partial"
  const isCancelled = orderStatus === "cancelled" || paymentStatus === "cancelled" || paymentStatus === "failed"

  if (isCOD) {
    if (isCancelled) {
      return { variant: "error" as const, label: "COD Cancelled" }
    }
    if (paymentStatus === 'captured' || paymentStatus === 'paid') {
      return { variant: "success" as const, label: "Paid" }
    }
    return { variant: "warning" as const, label: "COD Pending" }
  }

  switch (paymentStatus) {
    case "captured":
    case "paid":
      return { variant: "success" as const, label: "Paid" }
    case "partially_paid":
      return { variant: "info" as const, label: "Partial Paid" }
    case "awaiting":
    case "pending":
      return { variant: "warning" as const, label: "Pending" }
    case "failed":
      if (isEasebuzz) {
        return { variant: "error" as const, label: "Incomplete Transaction" }
      }
      return { variant: "error" as const, label: "Payment Failed" }
    case "cancelled":
      return { variant: "error" as const, label: "Payment Cancelled" }
    case "refunded":
      return { variant: "neutral" as const, label: "Refunded" }
    default:
      return { variant: "neutral" as const, label: paymentStatus || "—" }
  }
}

// Helper to format fulfillment status for display
function getFulfillmentBadge(fulfillmentStatus: string) {
  switch (fulfillmentStatus) {
    case "shipped":
      return { variant: "info" as const, label: "Shipped" }
    case "delivered":
      return { variant: "success" as const, label: "Delivered" }
    case "not_shipped":
    case "not_fulfilled":
      return { variant: "warning" as const, label: "Not Shipped" }
    case "cancelled":
      return { variant: "error" as const, label: "Cancelled" }
    default:
      return { variant: "neutral" as const, label: fulfillmentStatus || "—" }
  }
}

function getAcceptanceBadge(status: AdminOrderListItem["status"]) {
  switch (status) {
    case "accepted":
    case "shipped":
    case "delivered":
      return { variant: "success" as const, label: "Accepted" }
    case "pending":
    case "order_placed":
      return { variant: "warning" as const, label: "Not Accepted" }
    case "cancelled":
    case "failed":
      return { variant: "neutral" as const, label: "Not Applicable" }
    default:
      return { variant: "neutral" as const, label: "—" }
  }
}

const ORDER_TABS: Array<{ value: AdminOrderTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
]

function parseOrderTab(value?: string): AdminOrderTab {
  if (
    value === "confirmed" ||
    value === "pending" ||
    value === "cancelled"
  ) {
    return value
  }

  return "all"
}

export default async function AdminOrders({
  searchParams
}: {
  searchParams: Promise<{ page?: string; search?: string; tab?: string }>
}) {
  const { page = "1", search = "", tab: tabParam } = await searchParams
  const pageNumber = parseInt(page, 10) || 1
  const activeTab = parseOrderTab(tabParam)

  await expireStaleEasebuzzPendingPayments()

  const { orders, count, totalPages, currentPage, counts } = await getAdminOrders({
    page: pageNumber,
    limit: 20,
    search: search || undefined,
    tab: activeTab,
  })

  const hasSearch = search && search.trim().length > 0
  const buildUrl = (
    newTab: AdminOrderTab = activeTab,
    newPage?: number,
    clearSearch = false
  ) => {
    const params = new URLSearchParams()
    if (newTab !== "all") {
      params.set("tab", newTab)
    }
    if (newPage && newPage > 1) {
      params.set("page", newPage.toString())
    }
    if (!clearSearch && hasSearch) {
      params.set("search", search)
    }
    const queryString = params.toString()
    return queryString ? `/admin/orders?${queryString}` : "/admin/orders"
  }
  const currentBackUrl = buildUrl(activeTab, currentPage)
  const encodedBackUrl = encodeURIComponent(currentBackUrl)

  return (
    <div className="space-y-8">
      <RealtimeOrdersListener />
      <AdminPageHeader title="Orders" />

      {/* Search Bar */}
      <AdminSearchInput defaultValue={search} basePath="/admin/orders" placeholder="Search orders by order ID or customer email..." />

      {/* Results Count */}
      <div className="text-sm text-gray-500">
        Showing {count > 0 ? ((currentPage - 1) * 20) + 1 : 0} to {Math.min(currentPage * 20, count)} of {count} orders
      </div>

      <div className="p-0 border-none shadow-none bg-transparent">
        <AdminTableWrapper className="bg-white rounded-xl border border-admin-border shadow-sm">
          <nav
            aria-label="Order filters"
            className="border-b border-gray-200 px-4"
          >
            <div className="flex space-x-6 overflow-x-auto">
              {ORDER_TABS.map((tab) => (
                <Link
                  key={tab.value}
                  href={buildUrl(tab.value)}
                  aria-current={activeTab === tab.value ? "page" : undefined}
                  className={cn(
                    "whitespace-nowrap py-3 text-sm font-medium border-b-2 transition-colors",
                    activeTab === tab.value
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  )}
                >
                  {tab.label} ({counts[tab.value]})
                </Link>
              ))}
            </div>
          </nav>

          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-[#f7f8f9]">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[100px]">Order</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Club</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Accepted</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fulfillment</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {orders.length > 0 ? orders.map((order) => {
                const paymentBadge = getPaymentStatusDisplay({
                  paymentStatus: order.payment_status,
                  paymentMethod: order.payment_method,
                  orderStatus: order.status,
                })
                const acceptanceBadge = getAcceptanceBadge(order.status)
                const fulfillmentBadge = getFulfillmentBadge(order.fulfillment_status)
                const paymentMethodDisplay = getPaymentMethodDisplay(order.payment_method)

                return (
                  <ClickableTableRow
                    key={order.id}
                    href={`/admin/orders/${order.id}?from=${encodedBackUrl}`}
                    className="hover:bg-gray-50 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors tracking-tight">#{order.display_id}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatIST(order.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">{order.customer_email}</span>
                        {order.is_repeat_customer ? (
                          <AdminBadge variant="info">Repeat</AdminBadge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {order.is_club_member ? (
                        <AdminBadge variant="success">Club Member</AdminBadge>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <AdminBadge variant={acceptanceBadge.variant}>
                        {acceptanceBadge.label}
                      </AdminBadge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <AdminBadge variant={paymentBadge.tone}>
                        {paymentBadge.label}
                      </AdminBadge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-600 font-medium">{paymentMethodDisplay}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <AdminBadge variant={fulfillmentBadge.variant}>
                        {fulfillmentBadge.label}
                      </AdminBadge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                      {convertToLocale({ amount: order.total_amount, currency_code: order.currency_code })}
                    </td>
                  </ClickableTableRow>
                )
              }) : (
                <tr>
                  <td colSpan={9} className="px-6 py-20 text-center text-gray-500 text-sm">
                    <div className="flex flex-col items-center">
                      <ShoppingBagIcon className="w-12 h-12 text-gray-200 mb-3" />
                      <p className="text-sm font-bold text-gray-900">No orders found</p>
                      {hasSearch ? (
                        <p className="text-xs text-gray-400 mt-1">
                          Try adjusting your search or{" "}
                          <Link
                            href={buildUrl(activeTab, undefined, true)}
                            className="text-indigo-600 hover:underline"
                          >
                            clear the search
                          </Link>
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400 mt-1">No orders yet.</p>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </AdminTableWrapper>

        {/* Pagination */}
        <AdminPagination currentPage={currentPage} totalPages={totalPages} />
      </div>
    </div>
  )
}
