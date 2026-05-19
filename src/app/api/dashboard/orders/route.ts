import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getOrders, getSalesReps } from '@/lib/data'
import type { Order } from '@/lib/seed-data'

type OrderSummary = {
  total: number
  totalRevenue: number
  avgOrderValue: number
}

function buildSummary(orders: Order[], total: number): OrderSummary {
  const totalRevenue = orders.reduce((sum, order) => sum + order.subtotal, 0)

  return {
    total,
    totalRevenue,
    avgOrderValue: total > 0 ? Math.round(totalRevenue / total) : 0,
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    const filters = {
      status: params.get('status') ?? 'all',
      salesRepId: params.get('salesRepId') ?? 'all',
      search: params.get('search') ?? '',
    }
    const [result, allFilteredOrders, salesReps] = await Promise.all([
      getOrders({
        ...filters,
        page: Number(params.get('page') ?? 1),
        pageSize: Number(params.get('pageSize') ?? 20),
      }),
      getOrders({ ...filters, page: 1, pageSize: 100000 }),
      getSalesReps(),
    ])

    return NextResponse.json({
      result,
      summary: buildSummary(allFilteredOrders.data, allFilteredOrders.total),
      salesReps,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
