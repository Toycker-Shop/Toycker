import { getRecentAdminOrders } from "@/lib/data/admin"
import { getTopProducts, getDashboardStats } from "@/lib/data/analytics"
import { getChartData } from "@/lib/data/chart"
import { convertToLocale } from "@lib/util/money"
import AdminCard from "@modules/admin/components/admin-card"
import AdminPageHeader from "@modules/admin/components/admin-page-header"
import { ShoppingBagIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon } from "@heroicons/react/24/outline"
import Link from "next/link"
import { formatIST } from "@/lib/util/date"
import ReportsChartLoader from "@modules/admin/components/charts/reports-chart-loader"
import TopProducts from "@modules/admin/components/dashboard/top-products"
import { cn } from "@lib/util/cn"

const formatRecentOrderDate = (date: string | Date) =>
  formatIST(date).replace(/\b(am|pm)\b/i, (period) => period.toUpperCase())

export default async function AdminDashboard() {
  const stats = await getDashboardStats()
  const latestOrders = await getRecentAdminOrders(5)

  // Fetch analytics
  const initialChartData = await getChartData("1m") // Default to monthly view
  const topProducts = await getTopProducts(5)

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Overview" subtitle="Here's what's happening with your store today." />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Sales"
          value={convertToLocale({ amount: stats.revenue.value, currency_code: "inr" })}
          trend={stats.revenue.trend}
          percentage={stats.revenue.change}
          subtitle="vs last month"
        />
        <StatCard
          title="Total Orders"
          value={stats.orders.value.toString()}
          trend={stats.orders.trend}
          percentage={stats.orders.change}
          subtitle="vs last month"
        />
        <StatCard
          title="Active Products"
          value={stats.products.value.toString()}
          subtitle="Inventory status"
          trend="neutral"
          percentage={0} // No trend for now, just static status
        />
        <StatCard
          title="Customers"
          value={stats.customers.value.toString()}
          trend={stats.customers.newThisMonth > 0 ? "up" : "neutral"}
          textOverride={stats.customers.newThisMonth > 0 ? `+${stats.customers.newThisMonth} new` : "No change"}
          subtitle="this month"
        />
      </div>

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
        <AdminCard title="Sales & Orders Report" className="flex flex-col lg:col-span-2" contentClassName="flex flex-1 flex-col">
          <ReportsChartLoader initialData={initialChartData} />
        </AdminCard>

        <AdminCard title="Top Selling Products">
          <TopProducts products={topProducts} />
        </AdminCard>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <AdminCard title="Recent Orders" className="p-0 lg:col-span-2">
          <div className="divide-y divide-gray-100">
            {latestOrders.map(order => (
              <Link key={order.id} href={`/admin/orders/${order.id}`} prefetch={false} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors group">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-[#f1f2f4] flex items-center justify-center text-gray-500 border border-[#e1e3e5]">
                    <ShoppingBagIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 group-hover:underline decoration-gray-400 underline-offset-2">Order #{order.display_id}</p>
                    <p className="text-xs text-gray-500">{order.customer_email}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{formatRecentOrderDate(order.created_at)}</p>
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-900">{convertToLocale({ amount: order.total_amount, currency_code: order.currency_code })}</p>
              </Link>
            ))}
          </div>
          <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-center">
            <Link href="/admin/orders" className="text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors">View all orders</Link>
          </div>
        </AdminCard>

        <AdminCard
          title="Inventory Health"
          footer={
            <Link href="/admin/inventory" className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors">Manage inventory</Link>
          }
        >
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Out of Stock</span>
              <span className={cn(
                "text-xs font-bold px-2 py-1 rounded-lg",
                stats.products.outOfStock > 0 ? "text-red-600 bg-red-50" : "text-gray-900 bg-gray-100"
              )}>
                {stats.products.outOfStock} items
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Low Stock</span>
              <span className={cn(
                "text-xs font-bold px-2 py-1 rounded-lg",
                stats.products.lowStock > 0 ? "text-amber-600 bg-amber-50" : "text-gray-900 bg-gray-100"
              )}>
                {stats.products.lowStock} items
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Active Products</span>
              <span className="text-xs font-bold text-gray-900 bg-gray-100 px-2 py-1 rounded-lg">{stats.products.value} items</span>
            </div>
          </div>
        </AdminCard>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  subtitle,
  trend = "neutral",
  percentage = 0,
  textOverride
}: {
  title: string,
  value: string,
  subtitle: string,
  trend?: 'up' | 'down' | 'neutral',
  percentage?: number,
  textOverride?: string
}) {

  const isPositive = trend === 'up';
  const isNeutral = trend === 'neutral';

  let trendColor = "text-gray-500";
  let TrendIcon = null;

  if (trend === 'up') {
    trendColor = "text-green-600";
    TrendIcon = ArrowTrendingUpIcon;
  } else if (trend === 'down') {
    trendColor = "text-red-500";
    TrendIcon = ArrowTrendingDownIcon;
  }

  return (
    <div className="bg-white rounded-xl border border-admin-border p-4 shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]">
      <h3 className="text-xs font-medium text-gray-600">{title}</h3>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-semibold text-gray-900 tracking-tight">{value}</p>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {TrendIcon && !isNeutral && (
          <TrendIcon className={`h-3.5 w-3.5 ${trendColor}`} />
        )}
        <p className={`text-xs font-medium ${trendColor}`}>
          {textOverride ? textOverride : (
            <>
              {isPositive ? "+" : ""}{percentage.toFixed(1)}%
            </>
          )}
        </p>
        <span className="text-xs text-gray-400">{subtitle}</span>
      </div>
    </div>
  )
}
