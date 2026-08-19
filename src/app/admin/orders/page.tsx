import {
  getAdminOrders,
  type AdminOrderTab,
} from '@/lib/data/admin'
import { expireStaleEasebuzzPendingPayments } from '@/lib/actions/cancel-pending-payment'
import AdminOrdersTable from '@modules/admin/components/admin-orders-table'
import AdminPageHeader from '@modules/admin/components/admin-page-header'
import { AdminSearchInput } from '@modules/admin/components/admin-search-input'
import { AdminTableWrapper } from '@modules/admin/components/admin-table-wrapper'


function parseOrderTab(value?: string): AdminOrderTab {
  if (
    value === 'confirmed' ||
    value === 'pending' ||
    value === 'cancelled'
  ) {
    return value
  }

  return 'all'
}

export default async function AdminOrders({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; tab?: string }>
}) {
  const { page = '1', search = '', tab: tabParam } = await searchParams
  const pageNumber = parseInt(page, 10) || 1
  const activeTab = parseOrderTab(tabParam)

  await expireStaleEasebuzzPendingPayments()

  const { orders, totalPages, currentPage, counts } =
    await getAdminOrders({
      page: pageNumber,
      limit: 20,
      search: search || undefined,
      tab: activeTab,
    })

  const hasSearch = search.trim().length > 0
  const buildUrl = (
    newTab: AdminOrderTab = activeTab,
    newPage?: number,
    clearSearch = false
  ) => {
    const params = new URLSearchParams()

    if (newTab !== 'all') {
      params.set('tab', newTab)
    }

    if (newPage && newPage > 1) {
      params.set('page', newPage.toString())
    }

    if (!clearSearch && hasSearch) {
      params.set('search', search)
    }

    const queryString = params.toString()
    return queryString ? `/admin/orders?${queryString}` : '/admin/orders'
  }

  const currentBackUrl = buildUrl(activeTab, currentPage)
  const encodedBackUrl = encodeURIComponent(currentBackUrl)
  const tabHrefs: Record<AdminOrderTab, string> = {
    all: buildUrl('all'),
    confirmed: buildUrl('confirmed'),
    pending: buildUrl('pending'),
    cancelled: buildUrl('cancelled'),
  }

  return (
    <div className='space-y-8'>
      <AdminPageHeader title='Orders' />

      <AdminSearchInput
        defaultValue={search}
        basePath='/admin/orders'
        placeholder='Search by order ID, customer name, or phone...'
      />


      <div className='p-0 border-none shadow-none bg-transparent'>
        <AdminTableWrapper className='bg-white rounded-xl border border-admin-border shadow-sm'>

          <AdminOrdersTable
            initialOrders={orders}
            initialCounts={counts}
            activeTab={activeTab}
            search={search}
            currentPage={currentPage}
            totalPages={totalPages}
            encodedBackUrl={encodedBackUrl}
            clearSearchHref={buildUrl(activeTab, undefined, true)}
            tabHrefs={tabHrefs}
          />
        </AdminTableWrapper>
      </div>
    </div>
  )
}
