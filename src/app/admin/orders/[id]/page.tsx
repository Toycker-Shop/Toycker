import { getAdminOrder, getAdminOrderNavigation, getTrivaraFulfillmentPartner, getOrderTimeline, getCustomerDisplayId } from "@/lib/data/admin"
import { getRegion } from "@/lib/data/regions"
import { formatCustomerDisplayId } from "@/lib/util/customer"
import { canAcceptOrderForPayment } from "@/lib/util/customer-order-state"
import {
  canEditOrderShippingAddress,
  ORDER_SHIPPING_ADDRESS_LOCK_MESSAGE,
} from "@/lib/util/order-shipping-address-edit"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon, EnvelopeIcon, PhoneIcon, MapPinIcon, CheckIcon, TruckIcon, CreditCardIcon, GiftIcon } from "@heroicons/react/24/outline"
import AdminCard from "@modules/admin/components/admin-card"
import AdminBadge from "@modules/admin/components/admin-badge"
import { convertToLocale } from "@lib/util/money"
import { getPartialPaymentDisplayData } from "@/lib/util/order-pricing"
import {
  getPaymentMethodDisplay,
  getPaymentStatusDisplay,
} from "@/lib/util/payment-status"
import Image from "next/image"
import FulfillmentModal from "./fulfillment-modal"
import { MarkAsPaidButton } from "./mark-as-paid-button"
import {
  AcceptOrderButton,
  CancelOrderButton,
  MarkAsDeliveredButton,
  MarkBalancePaidButton,
} from "./order-action-buttons"
import EditOrderShippingAddressModal from "./edit-order-shipping-address-modal"
import { formatIST } from "@/lib/util/date"
import { fixUrl } from "@/lib/util/images"
import { RealtimeOrderManager } from "@modules/common/components/realtime-order-manager"
import { ProtectedAction } from "@/lib/permissions/components/protected-action"
import { PERMISSIONS } from "@/lib/permissions"
import { expireStaleEasebuzzPendingPayments } from "@/lib/actions/cancel-pending-payment"
import {
  getTrivaraFulfillmentMetadata,
  getTrivaraTrackingUrl,
} from "@/lib/util/trivara-fulfillment"

const normalizePaymentMethod = (method?: string | null, hasPayuTxn?: string | null, hasGatewayTxn?: string | null) => {
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

const formatPaymentMethodDisplay = (method?: string | null, hasPayuTxn?: string | null, hasGatewayTxn?: string | null) => {
  const normalized = normalizePaymentMethod(method, hasPayuTxn, hasGatewayTxn)
  if (normalized === "easebuzz") return "Easebuzz"
  if (normalized === "easebuzz_partial") return "Easebuzz Partial Payment"
  if (normalized === "payu") return "PayU"
  if (normalized === "cod" || normalized === "manual") return "Cash on Delivery (COD)"
  const label = (method || "").replace(/_/g, " ").trim()
  return label ? label.replace(/\b\w/g, c => c.toUpperCase()) : "—"
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}

type AdminOrderItem = {
  id: string
  thumbnail?: string | null
  title?: string | null
  product_title?: string | null
  variant?: {
    sku?: string | null
    title?: string | null
    product?: {
      name?: string | null
    } | null
  } | null
  unit_price?: number | string | null
  quantity?: number | string | null
  total?: number | string | null
  metadata?: Record<string, unknown> | null
}

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

const isGiftWrapOrderItem = (item: AdminOrderItem) => {
  return (
    item.metadata?.gift_wrap_line === true ||
    item.title?.toLowerCase().includes("gift wrap") === true ||
    item.product_title?.toLowerCase().includes("gift wrap") === true
  )
}

const getGiftWrapAmountFromItems = (
  items: AdminOrderItem[] | null | undefined
) => {
  if (!Array.isArray(items)) {
    return 0
  }

  return items.reduce((total, item) => {
    if (!isGiftWrapOrderItem(item)) {
      return total
    }

    const itemTotal = toNumber(item.total)
    if (itemTotal > 0) {
      return total + itemTotal
    }

    return (
      total +
      toNumber(item.unit_price) * Math.max(toNumber(item.quantity), 1)
    )
  }, 0)
}

const isDefaultVariantTitle = (title?: string | null) => {
  if (!title) {
    return true
  }

  const normalized = title.trim().toLowerCase()
  return (
    normalized === "" ||
    normalized === "default" ||
    normalized === "default title" ||
    normalized === "title: default title" ||
    normalized === "default variant" ||
    normalized === "default variant title"
  )
}

const getOrderItemProductTitle = (item: AdminOrderItem) => {
  if (isGiftWrapOrderItem(item)) {
    return "Gift Wrap"
  }

  return (
    item.product_title ||
    item.variant?.product?.name ||
    item.title ||
    "Product"
  )
}

const getOrderItemVariantTitle = (item: AdminOrderItem) => {
  if (isGiftWrapOrderItem(item)) {
    return null
  }

  const variantTitle = item.variant?.title || item.title
  const productTitle = getOrderItemProductTitle(item)

  if (
    isDefaultVariantTitle(variantTitle) ||
    variantTitle?.trim() === productTitle.trim()
  ) {
    return null
  }

  return variantTitle
}

const getSafeOrdersBackHref = (href?: string) => {
  if (!href) {
    return "/admin/orders"
  }

  if (href === "/admin/orders" || href.startsWith("/admin/orders?")) {
    return href
  }

  return "/admin/orders"
}

const getOrderDetailHref = (orderId: string, backHref: string) => {
  return `/admin/orders/${orderId}?from=${encodeURIComponent(backHref)}`
}

function OrderNavigationLink({
  order,
  direction,
  backHref,
}: {
  order: { id: string; display_id: number } | null
  direction: "older" | "newer"
  backHref: string
}) {
  const Icon = direction === "older" ? ChevronLeftIcon : ChevronRightIcon
  const label =
    direction === "older"
      ? order
        ? `Open older order #${order.display_id}`
        : "No older order"
      : order
        ? `Open newer order #${order.display_id}`
        : "No newer order"
  const className =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white hover:bg-[#1f2937] focus:outline-none "

  if (!order) {
    return (
      <span
        aria-disabled="true"
        title={label}
        className={`${className} cursor-not-allowed opacity-50 hover:opacity-50`}
      >
        <Icon className="h-5 w-5" />
      </span>
    )
  }

  return (
    <Link href={getOrderDetailHref(order.id, backHref)} aria-label={label} title={label} className={className}>
      <Icon className="h-5 w-5" />
    </Link>
  )
}

export default async function AdminOrderDetails({ params, searchParams }: Props) {
  const { id } = await params
  const { from } = await searchParams
  const backHref = getSafeOrdersBackHref(from)
  await expireStaleEasebuzzPendingPayments()
  const order = await getAdminOrder(id)

  if (!order) notFound()

  // Fetch additional data
  const [trivaraFulfillmentPartner, timeline, customerDisplayId, region, orderNavigation] = await Promise.all([
    getTrivaraFulfillmentPartner(),
    getOrderTimeline(id).catch(() => []),
    order.user_id ? getCustomerDisplayId(order.user_id).catch(() => null) : null,
    getRegion(),
    getAdminOrderNavigation(order.display_id),
  ])
  const trivaraFulfillment = getTrivaraFulfillmentMetadata(order.metadata)
  const awbNumber = order.tracking_number || trivaraFulfillment?.awb || null
  const courierName =
    trivaraFulfillment?.courierName || trivaraFulfillmentPartner?.name || null
  const trackingUrl = getTrivaraTrackingUrl(trivaraFulfillment, awbNumber)
  const canEditShippingAddress = canEditOrderShippingAddress(order.status)
  const canAcceptOrder =
    (order.status === "order_placed" || order.status === "pending") &&
    canAcceptOrderForPayment(order)

  const actions = (
    <div className="flex gap-2">
      {(order.status === 'order_placed' || order.status === 'pending') && (
        <ProtectedAction permission={PERMISSIONS.ORDERS_UPDATE} hideWhenDisabled>
          <div className="flex gap-2">
            {canAcceptOrder && <AcceptOrderButton orderId={order.id} />}
            <CancelOrderButton orderId={order.id} />
          </div>
        </ProtectedAction>
      )}
      {order.status === 'accepted' && (
        <ProtectedAction permission={PERMISSIONS.ORDERS_UPDATE} hideWhenDisabled>
          <div className="flex gap-2">
            <FulfillmentModal
              orderId={order.id}
              trivaraPartner={trivaraFulfillmentPartner}
              initialAwb={awbNumber}
            />
            <CancelOrderButton orderId={order.id} />
          </div>
        </ProtectedAction>
      )}
      {order.status === 'shipped' && (
        <ProtectedAction permission={PERMISSIONS.ORDERS_UPDATE} hideWhenDisabled>
          <MarkAsDeliveredButton orderId={order.id} />
        </ProtectedAction>
      )}
    </div>
  )

  const modeMap: Record<string, string> = {
    'CC': 'Credit Card',
    'DC': 'Debit Card',
    'NB': 'Net Banking',
    'UPI': 'UPI',
    'UP': 'UPI',
    'CASH': 'Cash Card',
    'EMI': 'EMI',
  }

  // Determine payment method display with specific sub-method for gateway payments
  let paymentMethod = formatPaymentMethodDisplay(order.payment_method, order.payu_txn_id, order.gateway_txn_id)
  if (order.gateway_txn_id && order.metadata?.easebuzz_payload) {
    const payload = order.metadata.easebuzz_payload as Record<string, string>
    const mode = payload.mode ? (modeMap[payload.mode] || payload.mode) : ""
    const bank = payload.bankcode && payload.bankcode !== 'UPI' ? ` (${payload.bankcode})` : ""
    paymentMethod = `${getPaymentMethodDisplay(order.payment_method)} - ${mode}${bank}`.trim()
  } else if (order.payu_txn_id && order.metadata?.payu_payload) {
    const payload = order.metadata.payu_payload as Record<string, string>
    const mode = payload.mode ? (modeMap[payload.mode] || payload.mode) : ""
    const bank = payload.bankcode && payload.bankcode !== 'UPI' ? ` (${payload.bankcode})` : ""
    paymentMethod = `PayU - ${mode}${bank}`.trim()
  }

  const normalizedPaymentStatus = (() => {
    const ps = (order.payment_status || "").toLowerCase()
    if ((order.status === "cancelled" || order.status === "failed") && (ps === "" || ps === "pending" || ps === "awaiting" || ps === "unpaid")) {
      return "cancelled"
    }
    return ps || (order.status === "cancelled" || order.status === "failed" ? "cancelled" : "pending")
  })()

  const normalizedMethod = normalizePaymentMethod(order.payment_method, order.payu_txn_id, order.gateway_txn_id)
  const isCodPayment = normalizedMethod === "cod" || normalizedMethod === "manual"
  const paymentStatusPending = ["pending", "awaiting", "unpaid"].includes(normalizedPaymentStatus)
  const canMarkAsPaid = !isCodPayment && paymentStatusPending && order.status === "delivered"
  const isPartialPayment = normalizedMethod === "easebuzz_partial"
  const canMarkBalancePaid =
    isPartialPayment && normalizedPaymentStatus === "partially_paid"
  const paymentStatusDisplay = getPaymentStatusDisplay({
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    orderStatus: order.status,
    metadata: order.metadata,
  })

  const rewardsUsed = Number(order.metadata?.rewards_used || 0)
  const orderMetadata = (order.metadata || {}) as Record<string, unknown>
  const giftWrapAmountFromItems = getGiftWrapAmountFromItems(
    order.items as AdminOrderItem[] | null | undefined
  )
  const giftWrapAmount = giftWrapAmountFromItems
  const clubSavingsAmount = toNumber(orderMetadata.club_savings)
  const promoDiscountAmount = toNumber(orderMetadata.promo_discount)
  const paymentDiscountAmount = toNumber(orderMetadata.payment_discount_amount)
  const paymentDiscountPercentage = toNumber(
    orderMetadata.payment_discount_percentage
  )
  const partialPaymentData = getPartialPaymentDisplayData(order.metadata)


  return (
    <div className="space-y-6">
      <RealtimeOrderManager orderId={order.id} />
      <div className="flex items-center justify-between gap-4">
        <nav className="flex items-center text-xs font-bold text-gray-400 uppercase tracking-widest">
          <Link href={backHref} className="flex items-center hover:text-black transition-colors">
            <ChevronLeftIcon className="h-3 w-3 mr-1" strokeWidth={3} />
            Back to Orders
          </Link>
        </nav>
        <div className="flex items-center gap-1.5">
          <OrderNavigationLink order={orderNavigation.olderOrder} direction="older" backHref={backHref} />
          <OrderNavigationLink order={orderNavigation.newerOrder} direction="newer" backHref={backHref} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-black text-gray-900 tracking-tighter">Order #{order.display_id}</h1>
          <AdminBadge
            variant={
              order.status === 'delivered' ? "success" :
                (order.status === 'shipped' || order.status === 'accepted') ? "info" :
                  order.status === 'cancelled' || order.status === 'failed' ? "critical" :
                    "warning"
            }
          >
            {(order.status === 'order_placed' || order.status === 'pending') ? 'New Order' :
              order.status === 'accepted' ? 'Ready to Ship' :
                order.status === 'shipped' ? 'Shipped' :
                  order.status === 'delivered' ? 'Delivered' :
                    order.status === 'cancelled' ? 'Cancelled' :
                      order.status === 'failed' ? 'Failed' :
                        (order.status as string).charAt(0).toUpperCase() + (order.status as string).slice(1)}
          </AdminBadge>
        </div>
        {actions}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Items */}
          <AdminCard title="Items" className="p-0">
            <div className="divide-y divide-gray-100">
              {order.items?.map((item: AdminOrderItem) => (
                <div key={item.id} className="p-6 flex items-center gap-5 group">
                  <div className="h-20 w-20 relative rounded-xl bg-gray-50 border border-gray-100 overflow-hidden flex-shrink-0 transition-all group-hover:border-gray-300">
                    {item.thumbnail
                      ? <Image src={fixUrl(item.thumbnail)!} alt="" fill className="object-cover" sizes="80px" />
                      : item.title?.toLowerCase().includes("gift wrap")
                        ? <Image src="/assets/images/gift-wrap.png" alt="Gift Wrap" fill className="object-cover" sizes="80px" />
                        : null
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">
                      {getOrderItemProductTitle(item)}
                    </p>
                    {getOrderItemVariantTitle(item) && (
                      <p className="text-xs text-gray-500 font-semibold mt-1">
                        Variant: {getOrderItemVariantTitle(item)}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-tighter mt-1">SKU: {item.variant?.sku || 'N/A'}</p>
                    {item.metadata?.gift_wrap === true && (
                      <div className="mt-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-pink-50 border border-pink-100 w-fit">
                        <GiftIcon className="h-3 w-3 text-pink-500" />
                        <span className="text-[10px] font-bold text-pink-600 uppercase tracking-wider">Gift Wrapped</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">
                      {convertToLocale({
                        amount: toNumber(item.unit_price),
                        currency_code: order.currency_code,
                      })} × {toNumber(item.quantity)}
                    </p>
                    <p className="text-sm font-black text-gray-900 mt-0.5">
                      {convertToLocale({
                        amount: toNumber(item.total),
                        currency_code: order.currency_code,
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-8 bg-gray-50/50 border-t border-gray-100 space-y-3">
              <div className="flex justify-between text-sm font-medium text-gray-500">
                <span>Subtotal</span>
                <span className="text-gray-900 font-bold">
                  {convertToLocale({
                    amount: (order.subtotal || 0) + clubSavingsAmount - giftWrapAmount,
                    currency_code: order.currency_code
                  })}
                </span>
              </div>
              {giftWrapAmount > 0 && (
                <div className="flex justify-between text-sm font-medium text-pink-600">
                  <span>Gift Wrap</span>
                  <span className="font-bold">+{convertToLocale({ amount: giftWrapAmount, currency_code: order.currency_code })}</span>
                </div>
              )}
              {clubSavingsAmount > 0 && (
                <div className="flex justify-between text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-600">Club Savings</span>
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold uppercase rounded-full">Member</span>
                  </div>
                  <span className="text-blue-600 font-bold">-{convertToLocale({ amount: clubSavingsAmount, currency_code: order.currency_code })}</span>
                </div>
              )}
              {rewardsUsed > 0 && (
                <div className="flex justify-between text-sm font-medium text-emerald-600">
                  <span>Reward Points</span>
                  <span className="font-bold">-{convertToLocale({ amount: rewardsUsed, currency_code: order.currency_code })}</span>
                </div>
              )}
              {promoDiscountAmount > 0 && (
                <div className="flex justify-between text-sm font-medium text-orange-600">
                  <span>Promo Discount</span>
                  <span className="font-bold">-{convertToLocale({ amount: promoDiscountAmount, currency_code: order.currency_code })}</span>
                </div>
              )}
              {paymentDiscountAmount > 0 && (
                <div className="flex justify-between text-sm font-medium text-pink-600">
                  <span>Payment Discount ({paymentDiscountPercentage}%)</span>
                  <span className="font-bold">-{convertToLocale({ amount: paymentDiscountAmount, currency_code: order.currency_code })}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-medium text-gray-500">
                <span>Shipping</span>
                <span className="text-emerald-600 font-bold uppercase tracking-tighter">
                  {order.shipping_total === 0 ? "Free Shipping" : convertToLocale({ amount: order.shipping_total || 0, currency_code: order.currency_code })}
                </span>
              </div>
              <div className="flex justify-between text-sm font-medium text-gray-500">
                <span>Taxes</span>
                <span className="text-gray-900 font-bold">{convertToLocale({ amount: order.tax_total || 0, currency_code: order.currency_code })}</span>
              </div>
              <div className="flex justify-between text-lg font-black text-gray-900 pt-4 border-t border-gray-200">
                <span>Total</span>
                <span>{convertToLocale({ amount: order.total_amount, currency_code: order.currency_code })}</span>
              </div>
            </div>
          </AdminCard>

          {/* Timeline */}
          <AdminCard title="Timeline">
            <div className="space-y-6">
              {timeline.map((event, index) => (
                <TimelineItem
                  key={event.id}
                  title={event.title}
                  description={event.description || ""}
                  timestamp={formatIST(event.created_at)}
                  actor={event.actor}
                  active={true}
                  last={index === timeline.length - 1 && timeline.some(e => e.event_type === 'order_placed')}
                />
              ))}
              {!timeline.some(e => e.event_type === 'order_placed') && (
                <TimelineItem
                  title="Order Placed"
                  description="Customer placed this order."
                  timestamp={formatIST(order.created_at)}
                  actor="customer"
                  active={true}
                  last={true}
                />
              )}
            </div>
          </AdminCard>
        </div>

        <div className="space-y-8">
          {/* Payment Info */}
          <AdminCard title="Payment">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <CreditCardIcon className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{paymentMethod}</p>
                  <p className="text-xs text-gray-500">
                    {paymentStatusDisplay.label}
                  </p>
                </div>
              </div>
              {order.gateway_txn_id && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500">Transaction ID</p>
                  <p className="text-sm font-mono text-gray-700 mt-1">{order.gateway_txn_id}</p>
                </div>
              )}
              {isPartialPayment && partialPaymentData && (
                <div className="pt-3 border-t border-gray-100 space-y-2">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-gray-500">Order Total</span>
                    <span className="font-bold text-gray-900">
                      {convertToLocale({
                        amount: Number(order.total_amount || order.total || 0),
                        currency_code: order.currency_code,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-gray-500">Partial Paid</span>
                    <span className="font-bold text-emerald-700">
                      {convertToLocale({
                        amount: partialPaymentData.advanceAmount,
                        currency_code: order.currency_code,
                      })}
                      {/* {partialPaymentData.advancePercentage
                        ? ` (${partialPaymentData.advancePercentage}%)`
                        : ""} */}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-gray-500">Balance Paid</span>
                    <span className="font-bold text-gray-900">
                      {convertToLocale({
                        amount: partialPaymentData.balancePaidAmount,
                        currency_code: order.currency_code,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-gray-500">Balance Remaining</span>
                    <span
                      className={`font-bold ${
                        partialPaymentData.balanceRemainingAmount > 0
                          ? "text-amber-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {convertToLocale({
                        amount: partialPaymentData.balanceRemainingAmount,
                        currency_code: order.currency_code,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-gray-500">Balance Status</span>
                    <span
                      className={`font-bold ${
                        partialPaymentData.balancePaymentStatus === "paid"
                          ? "text-emerald-700"
                          : "text-amber-700"
                      }`}
                    >
                      {partialPaymentData.balancePaymentStatus === "paid"
                        ? "Paid"
                        : "Pending"}
                    </span>
                  </div>
                  {partialPaymentData.balancePaymentMethod && (
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-gray-500">Balance Method</span>
                      <span className="font-bold text-gray-900 text-right">
                        {partialPaymentData.balancePaymentMethod}
                      </span>
                    </div>
                  )}
                  {partialPaymentData.balancePaidAt && (
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-gray-500">Balance Paid At</span>
                      <span className="font-bold text-gray-900 text-right">
                        {formatIST(partialPaymentData.balancePaidAt)}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {canMarkBalancePaid && (
                <div className="pt-4 border-t border-gray-100">
                  <MarkBalancePaidButton orderId={order.id} />
                </div>
              )}
              {!order.gateway_txn_id && order.payu_txn_id && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500">Transaction ID</p>
                  <p className="text-sm font-mono text-gray-700 mt-1">{order.payu_txn_id}</p>
                </div>
              )}
              {canMarkAsPaid && (
                <div className="pt-4 border-t border-gray-100 space-y-2">
                  <ProtectedAction permission={PERMISSIONS.ORDERS_UPDATE} hideWhenDisabled>
                    <MarkAsPaidButton orderId={order.id} />
                  </ProtectedAction>
                  {isCodPayment && (
                    <p className="text-xs text-gray-500">COD: collect payment after delivery, then mark it as paid.</p>
                  )}
                </div>
              )}
            </div>
          </AdminCard>

          {/* Customer */}
          <AdminCard title="Customer">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Link href={`/admin/customers/${order.user_id}`} className="block">
                  <p className="text-sm font-bold text-gray-900 hover:underline">{order.customer_email}</p>
                  <p className="text-xs text-gray-400 font-medium">Customer since {new Date(order.created_at).getFullYear()}</p>
                </Link>
                {customerDisplayId && (
                  <div className="px-2 py-1 bg-indigo-50 rounded text-xs font-bold text-indigo-700">
                    {formatCustomerDisplayId(customerDisplayId)}
                  </div>
                )}
              </div>
              <div className="pt-4 border-t border-gray-100 space-y-2">
                <div className="flex items-center text-sm text-gray-600 gap-3">
                  <EnvelopeIcon className="h-4 w-4 text-gray-400" />
                  <span className="truncate">{order.customer_email}</span>
                </div>
                <div className="flex items-center text-sm text-gray-600 gap-3">
                  <PhoneIcon className="h-4 w-4 text-gray-400" />
                  <span>{order.customer_phone || 'No phone'}</span>
                </div>
              </div>
            </div>
          </AdminCard>

          {/* Shipping Info */}
          <AdminCard title="Shipping">
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="text-xs font-medium text-gray-500">
                  {canEditShippingAddress
                    ? "You can update the delivery address until this order is shipped."
                    : ORDER_SHIPPING_ADDRESS_LOCK_MESSAGE}
                </div>
                {canEditShippingAddress && (
                  <ProtectedAction
                    permission={PERMISSIONS.ORDERS_UPDATE}
                    hideWhenDisabled
                  >
                    <EditOrderShippingAddressModal
                      orderId={order.id}
                      address={order.shipping_address}
                      region={region}
                    />
                  </ProtectedAction>
                )}
              </div>
              {awbNumber && (
                <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
                  <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                    <TruckIcon className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900">AWB Number: {awbNumber}</p>
                    <p className="text-xs text-gray-500">
                      {courierName ? `Courier: ${courierName}` : order.fulfillment_status}
                    </p>
                  </div>
                  {trackingUrl && (
                    <a
                      href={trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-indigo-600 underline underline-offset-4 hover:text-indigo-700"
                    >
                      Track
                    </a>
                  )}
                </div>
              )}
              <div className="flex gap-3 text-sm font-medium text-gray-600 leading-relaxed">
                <MapPinIcon className="h-5 w-5 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="font-bold text-gray-900 tracking-tight">
                    {order.shipping_address?.first_name} {order.shipping_address?.last_name}
                  </p>
                  {order.shipping_address?.company && (
                    <p className="text-gray-500 text-xs font-bold">{order.shipping_address.company}</p>
                  )}
                  <p>{order.shipping_address?.address_1}</p>
                  {order.shipping_address?.address_2 && (
                    <p>{order.shipping_address.address_2}</p>
                  )}
                  <p className="uppercase">
                    {order.shipping_address?.city}
                    {order.shipping_address?.province ? `, ${order.shipping_address.province}` : ""}
                    {` ${order.shipping_address?.postal_code}`}
                  </p>
                  <div className="text-sm text-gray-600">
                    <span>{order.shipping_address?.phone || "No delivery phone"}</span>
                  </div>
                  <p className="text-xs font-bold text-gray-400 mt-2">{order.shipping_address?.country_code?.toUpperCase()}</p>
                </div>
              </div>
            </div>
          </AdminCard>
        </div>
      </div>
    </div>
  )
}

function TimelineItem({ title, description, timestamp, actor, active, last }: { title: string, description: string, timestamp: string, actor: string, active: boolean, last?: boolean }) {
  return (
    <div className={`relative pl-8 ${last ? '' : 'pb-6'}`}>
      {!last && <div className={`absolute left-[11px] top-[24px] bottom-0 w-0.5 ${active ? 'bg-indigo-600' : 'bg-gray-100'}`} />}
      <div className={`absolute left-0 top-1 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors ${active ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-200 text-gray-300'}`}>
        <CheckIcon className="h-3 w-3 stroke-[4]" />
      </div>
      <div>
        <div className="flex items-center justify-between gap-1">
          <p className={`text-sm font-bold ${active ? 'text-gray-900' : 'text-gray-400'}`}>{title}</p>
          <span className="text-[10px] text-gray-400 font-medium">{timestamp}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">{description}</p>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="px-1.5 py-0.5 rounded bg-gray-50 border border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            {actor === 'system' ? '💻 System' : actor === 'customer' ? '👤 Customer' : `🛡️ Admin: ${actor}`}
          </span>
        </div>
      </div>
    </div>
  )
}
