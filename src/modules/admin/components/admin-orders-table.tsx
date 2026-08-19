'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type {
  AdminOrderListItem,
  AdminOrderCounts,
  AdminOrderTab,
} from '@/lib/data/admin'
import { cn } from '@lib/util/cn'
import { convertToLocale } from '@lib/util/money'
import AdminBadge from '@modules/admin/components/admin-badge'
import { AdminPagination } from '@modules/admin/components/admin-pagination'
import { ClickableTableRow } from '@modules/admin/components/clickable-table-row'
import RealtimeOrdersListener, {
  type RealtimeOrderChange,
} from '@modules/admin/components/realtime-orders-listener'
import { ShoppingBagIcon } from '@heroicons/react/24/outline'
import { formatIST } from '@/lib/util/date'
import { getPaymentMethodDisplay, getPaymentStatusDisplay } from '@/lib/util/payment-status'

interface AdminOrdersTableProps {
  initialOrders: AdminOrderListItem[]
  initialCounts: AdminOrderCounts,
  activeTab: AdminOrderTab
  search: string
  currentPage: number
  totalPages: number
  encodedBackUrl: string
  clearSearchHref: string
  tabHrefs: Record<AdminOrderTab, string>
}

type AdminOrderResponse = {
  order: AdminOrderListItem
}
type AdminOrderCountsResponse = {
  counts: AdminOrderCounts
}
const ORDER_TABS: Array<{ value: AdminOrderTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'pending', label: 'Pending' },
  { value: 'cancelled', label: 'Cancelled' },
]



const CONFIRMED_STATUSES = new Set<AdminOrderListItem['status']>([
  'order_placed',
  'accepted',
  'shipped',
  'delivered',
])

const PENDING_PAYMENT_STATUSES = new Set(['pending', 'awaiting', 'unpaid'])
const CANCELLED_ORDER_STATUSES = new Set(['cancelled', 'failed'])
const CANCELLED_PAYMENT_STATUSES = new Set(['failed', 'cancelled'])

function matchesOrderTab(order: AdminOrderListItem, tab: AdminOrderTab) {
  const paymentStatus = order.payment_status.toLowerCase()

  if (tab === 'all') {
    return true
  }

  if (tab === 'confirmed') {
    return (
      CONFIRMED_STATUSES.has(order.status) &&
      !CANCELLED_PAYMENT_STATUSES.has(paymentStatus) &&
      !PENDING_PAYMENT_STATUSES.has(paymentStatus)
    )
  }

  if (tab === 'pending') {
    return (
      (order.status === 'pending' || PENDING_PAYMENT_STATUSES.has(paymentStatus)) &&
      !CANCELLED_ORDER_STATUSES.has(order.status) &&
      !CANCELLED_PAYMENT_STATUSES.has(paymentStatus)
    )
  }

  return (
    CANCELLED_ORDER_STATUSES.has(order.status) ||
    CANCELLED_PAYMENT_STATUSES.has(paymentStatus)
  )
}

function matchesOrderSearch(order: AdminOrderListItem, search: string) {
  const searchTerm = search.trim()

  if (!searchTerm) {
    return true
  }

  const normalizedSearchTerm = searchTerm.toLowerCase()
  const matchesOrderId = /^\d+$/.test(searchTerm)
    ? order.display_id === Number(searchTerm)
    : false
  const matchesCustomerName =
    order.customer_name?.toLowerCase().includes(normalizedSearchTerm) ?? false
  const matchesCustomerPhone =
    order.customer_phone?.toLowerCase().includes(normalizedSearchTerm) ?? false

  return matchesOrderId || matchesCustomerName || matchesCustomerPhone
}

function compareAdminOrders(
  firstOrder: AdminOrderListItem,
  secondOrder: AdminOrderListItem
) {
  const firstCreatedAt = Date.parse(firstOrder.created_at)
  const secondCreatedAt = Date.parse(secondOrder.created_at)
  const firstTimestamp = Number.isNaN(firstCreatedAt) ? 0 : firstCreatedAt
  const secondTimestamp = Number.isNaN(secondCreatedAt) ? 0 : secondCreatedAt
  const createdAtDifference = secondTimestamp - firstTimestamp

  if (createdAtDifference !== 0) {
    return createdAtDifference
  }

  if (secondOrder.display_id !== firstOrder.display_id) {
    return secondOrder.display_id - firstOrder.display_id
  }

  return secondOrder.id.localeCompare(firstOrder.id)
}

function isAdminOrderResponse(value: unknown): value is AdminOrderResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const response = value as Record<string, unknown>
  const order = response.order

  return Boolean(
    order &&
      typeof order === 'object' &&
      typeof (order as Record<string, unknown>).id === 'string'
  )
}
function isAdminOrderCountsResponse(
  value: unknown
): value is AdminOrderCountsResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const response = value as Record<string, unknown>
  const counts = response.counts

  if (!counts || typeof counts !== 'object') {
    return false
  }

  const countRecord = counts as Record<string, unknown>
  return ['all', 'confirmed', 'pending', 'cancelled'].every(
    (tab) => typeof countRecord[tab] === 'number'
  )
}

function getAcceptanceBadge(status: AdminOrderListItem['status']) {
  switch (status) {
    case 'accepted':
    case 'shipped':
    case 'delivered':
      return { variant: 'success' as const, label: 'Accepted' }
    case 'pending':
    case 'order_placed':
      return { variant: 'warning' as const, label: 'Not Accepted' }
    case 'cancelled':
    case 'failed':
      return { variant: 'neutral' as const, label: 'Not Applicable' }
    default:
      return { variant: 'neutral' as const, label: '—' }
  }
}

function getFulfillmentBadge(fulfillmentStatus: string) {
  switch (fulfillmentStatus) {
    case 'shipped':
      return { variant: 'info' as const, label: 'Shipped' }
    case 'delivered':
      return { variant: 'success' as const, label: 'Delivered' }
    case 'not_shipped':
    case 'not_fulfilled':
      return { variant: 'warning' as const, label: 'Not Shipped' }
    case 'cancelled':
      return { variant: 'error' as const, label: 'Cancelled' }
    default:
      return { variant: 'neutral' as const, label: fulfillmentStatus || '—' }
  }
}

function OrderTableRow({
  order,
  encodedBackUrl,
}: {
  order: AdminOrderListItem
  encodedBackUrl: string
}) {
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
      href={`/admin/orders/${order.id}?from=${encodedBackUrl}`}
      className='hover:bg-gray-50 transition-colors cursor-pointer group'
    >
      <td className='px-6 py-4 whitespace-nowrap'>
        <span className='text-sm font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors tracking-tight'>
          #{order.display_id}
        </span>
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>
        {formatIST(order.created_at)}
      </td>
      <td className='px-6 py-4 whitespace-nowrap'>
        <div className='flex items-center gap-2'>
          <div className='flex min-w-0 flex-col'>
            <span className='text-sm text-gray-600'>
              {order.customer_name || 'No name'}
            </span>
            <span className='text-xs text-gray-400'>
              {order.customer_phone || 'No phone'}
            </span>
          </div>
          {order.is_repeat_customer ? (
            <AdminBadge variant='info'>Repeat</AdminBadge>
          ) : null}
        </div>
      </td>
      <td className='px-6 py-4 whitespace-nowrap'>
        {order.is_club_member ? (
          <AdminBadge variant='success'>Club Member</AdminBadge>
        ) : (
          <span className='text-sm text-gray-400'>-</span>
        )}
      </td>
      <td className='px-6 py-4 whitespace-nowrap'>
        <AdminBadge variant={acceptanceBadge.variant}>
          {acceptanceBadge.label}
        </AdminBadge>
      </td>
      <td className='px-6 py-4 whitespace-nowrap'>
        <AdminBadge variant={paymentBadge.tone}>{paymentBadge.label}</AdminBadge>
      </td>
      <td className='px-6 py-4 whitespace-nowrap'>
        <span className='text-sm text-gray-600 font-medium'>
          {paymentMethodDisplay}
        </span>
      </td>
      <td className='px-6 py-4 whitespace-nowrap'>
        <AdminBadge variant={fulfillmentBadge.variant}>
          {fulfillmentBadge.label}
        </AdminBadge>
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium'>
        {convertToLocale({
          amount: order.total_amount,
          currency_code: order.currency_code,
        })}
      </td>
    </ClickableTableRow>
  )
}

export default function AdminOrdersTable({
  initialOrders,
  initialCounts,
  activeTab,
  search,
  currentPage,
  totalPages,
  encodedBackUrl,
  clearSearchHref,
  tabHrefs,
}: AdminOrdersTableProps) {
  const [orders, setOrders] = useState(initialOrders)
  const [counts, setCounts] = useState(initialCounts)
  const countsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const orderRequestVersionsRef = useRef(new Map<string, number>())

  useEffect(() => {
    setOrders(initialOrders)
    setCounts(initialCounts)
  }, [initialOrders, initialCounts])

  const pendingFetchesRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  )
  const refreshOrderCounts = useCallback(() => {
    if (countsRefreshTimerRef.current) {
      clearTimeout(countsRefreshTimerRef.current)
    }

    countsRefreshTimerRef.current = setTimeout(() => {
      countsRefreshTimerRef.current = null

      void (async () => {
        try {
          const searchQuery = search.trim()
            ? `?search=${encodeURIComponent(search.trim())}`
            : ''
          const response = await fetch(
            `/api/admin/orders/counts${searchQuery}`,
            { cache: 'no-store' }
          )

          if (!response.ok) {
            return
          }

          const payload: unknown = await response.json()
          if (isAdminOrderCountsResponse(payload)) {
            setCounts(payload.counts)
          }
        } catch {
          // The next realtime event or navigation will retry the count refresh.
        }
      })()
    }, 1000)
  }, [search])

  const applyOrderChange = useCallback(
    async (change: RealtimeOrderChange, requestVersion: number) => {
      if (change.type === 'DELETE') {
        setOrders((currentOrders) =>
          currentOrders.filter((order) => order.id !== change.orderId)
        )
        return
      }

      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(change.orderId)}`,
        { cache: 'no-store' }
      )

      if (
        orderRequestVersionsRef.current.get(change.orderId) !== requestVersion
      ) {
        return
      }

      if (response.status === 404) {
        setOrders((currentOrders) =>
          currentOrders.filter((order) => order.id !== change.orderId)
        )
        return
      }

      if (!response.ok) {
        return
      }

      const payload: unknown = await response.json()

      if (!isAdminOrderResponse(payload)) {
        return
      }

      if (
        orderRequestVersionsRef.current.get(change.orderId) !== requestVersion
      ) {
        return
      }

      const freshOrder = payload.order
      const shouldDisplay =
        matchesOrderTab(freshOrder, activeTab) &&
        matchesOrderSearch(freshOrder, search)

      setOrders((currentOrders) => {
        const hasExistingOrder = currentOrders.some(
          (order) => order.id === freshOrder.id
        )
        const ordersWithoutFreshOrder = currentOrders.filter(
          (order) => order.id !== freshOrder.id
        )

        if (!hasExistingOrder) {
          if (
            currentPage !== 1 ||
            search.trim() ||
            !shouldDisplay
          ) {
            return currentOrders
          }
        }

        if (!shouldDisplay) {
          return ordersWithoutFreshOrder
        }

        return [...ordersWithoutFreshOrder, freshOrder]
          .sort(compareAdminOrders)
          .slice(0, 20)
      })
    },
    [activeTab, currentPage, search]
  )

  const handleOrderChange = useCallback(
    (change: RealtimeOrderChange) => {
      refreshOrderCounts()
      const requestVersion =
        (orderRequestVersionsRef.current.get(change.orderId) || 0) + 1
      orderRequestVersionsRef.current.set(change.orderId, requestVersion)
      const existingTimer = pendingFetchesRef.current.get(change.orderId)

      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      if (change.type === 'DELETE') {
        pendingFetchesRef.current.delete(change.orderId)
        void applyOrderChange(change, requestVersion)
        return
      }

      const timer = setTimeout(() => {
        pendingFetchesRef.current.delete(change.orderId)
        void applyOrderChange(change, requestVersion).catch(() => undefined)
      }, 300)

      pendingFetchesRef.current.set(change.orderId, timer)
    },
    [applyOrderChange, refreshOrderCounts]
  )

  useEffect(() => {
    const pendingTimers = pendingFetchesRef.current
    const orderRequestVersions = orderRequestVersionsRef.current

    return () => {
      if (countsRefreshTimerRef.current) {
        clearTimeout(countsRefreshTimerRef.current)
        countsRefreshTimerRef.current = null
      }

      for (const timer of Array.from(pendingTimers.values())) {
        clearTimeout(timer)
      }
      pendingTimers.clear()
      orderRequestVersions.clear()
    }
  }, [])

  return (
    <>
      <RealtimeOrdersListener onOrderChange={handleOrderChange} />
      <div className='px-4 pt-4 pb-2 text-sm text-gray-500'>
        Showing {counts[activeTab] > 0 ? (currentPage - 1) * 20 + 1 : 0} to{' '}
        {Math.min(currentPage * 20, counts[activeTab])} of {counts[activeTab]} orders
      </div>

      <nav
        aria-label='Order filters'
        className='border-b border-gray-200 px-4'
      >
        <div className='flex space-x-6 overflow-x-auto'>
          {ORDER_TABS.map((tab) => (
            <Link
              key={tab.value}
              href={tabHrefs[tab.value]}
              prefetch={false}
              aria-current={activeTab === tab.value ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.value
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {tab.label} ({counts[tab.value]})
            </Link>
          ))}
        </div>
      </nav>

      <table className='min-w-full divide-y divide-gray-200'>
          <thead className='bg-[#f7f8f9]'>
            <tr>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[100px]'>Order</th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Date</th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Customer</th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Club</th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Accepted</th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Payment</th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Method</th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Fulfillment</th>
              <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider'>Total</th>
            </tr>
          </thead>
          <tbody className='bg-white divide-y divide-gray-100'>
            {orders.length > 0 ? (
              orders.map((order) => (
                <OrderTableRow
                  key={order.id}
                  order={order}
                  encodedBackUrl={encodedBackUrl}
                />
              ))
            ) : (
              <tr>
                <td colSpan={9} className='px-6 py-20 text-center text-gray-500 text-sm'>
                  <div className='flex flex-col items-center'>
                    <ShoppingBagIcon className='w-12 h-12 text-gray-200 mb-3' />
                    <p className='text-sm font-bold text-gray-900'>No orders found</p>
                    <p className='text-xs text-gray-400 mt-1'>
                      {search.trim() ? (
                        <>
                          Try adjusting your search or{' '}
                          <Link
                            href={clearSearchHref}
                            prefetch={false}
                            className='text-indigo-600 hover:underline'
                          >
                            clear the search
                          </Link>
                        </>
                      ) : (
                        'No orders yet.'
                      )}
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
      </table>

      <AdminPagination currentPage={currentPage} totalPages={totalPages} />
    </>
  )
}
