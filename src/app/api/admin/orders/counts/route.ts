import { getAdminOrderCounts, type AdminOrderCounts } from '@/lib/data/admin'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type AdminOrderCountsResponse = {
  counts: AdminOrderCounts
}

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams.get('search') || undefined
    const counts = await getAdminOrderCounts(search)

    return NextResponse.json<AdminOrderCountsResponse>(
      { counts },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    )
  } catch (error) {
    console.error('[admin-order-counts] Failed to load counts:', error)

    return NextResponse.json(
      { error: 'Failed to load order counts' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    )
  }
}
