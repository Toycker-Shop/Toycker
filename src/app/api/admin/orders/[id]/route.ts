import { getAdminOrderListItemById } from '@/lib/data/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type AdminOrderRouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(
  _request: Request,
  { params }: AdminOrderRouteContext
) {
  try {
    const { id } = await params
    const orderId = id.trim()
    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) {
      throw profileError
    }

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const order = await getAdminOrderListItemById(orderId)

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    return NextResponse.json(
      { order },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    )
  } catch (error) {
    console.error('[admin-order] Failed to load order:', error)

    return NextResponse.json(
      { error: 'Failed to load order' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }
}
