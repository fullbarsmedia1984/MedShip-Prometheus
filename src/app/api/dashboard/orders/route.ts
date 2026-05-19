import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getOrders, getSalesReps } from '@/lib/data'
import type { OrderFilters } from '@/lib/data'
import type { Order } from '@/lib/seed-data'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSalesOrderCoverage, type SalesOrderCoverage } from '@/lib/fishbowl/sales-order-completeness'

type OrderSummary = {
  total: number
  totalRevenue: number
  avgOrderValue: number
}

type DataQualitySummary = {
  totalCached: number
  visibleRows: number
  hiddenByScope: number
  likelyTest: number
  incompleteLines: number
}

function buildSummary(orders: Order[], total: number): OrderSummary {
  const totalRevenue = orders.reduce((sum, order) => sum + order.subtotal, 0)

  return {
    total,
    totalRevenue,
    avgOrderValue: total > 0 ? Math.round(totalRevenue / total) : 0,
  }
}

function buildDataQualitySummary(visibleOrders: Order[], allOrders: Order[]): DataQualitySummary {
  const countFlag = (flag: string) =>
    allOrders.filter((order) => order.dataQualityFlags?.includes(flag)).length

  return {
    totalCached: allOrders.length,
    visibleRows: visibleOrders.length,
    hiddenByScope: Math.max(0, allOrders.length - visibleOrders.length),
    likelyTest: countFlag('likely_test'),
    incompleteLines: countFlag('missing_line_items'),
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    const filters: OrderFilters = {
      status: params.get('status') ?? 'all',
      salesRepId: params.get('salesRepId') ?? 'all',
      search: params.get('search') ?? '',
      scope: params.get('scope') === 'all' ? 'all' : 'business',
    }
    const allScopeFilters = { ...filters, scope: 'all' as const }
    const supabase = createAdminClient()
    const [result, allFilteredOrders, allScopeOrders, salesReps, salesOrderCoverage] = await Promise.all([
      getOrders({
        ...filters,
        page: Number(params.get('page') ?? 1),
        pageSize: Number(params.get('pageSize') ?? 20),
      }),
      getOrders({ ...filters, page: 1, pageSize: 100000 }),
      getOrders({ ...allScopeFilters, page: 1, pageSize: 100000 }),
      getSalesReps(),
      getSalesOrderCoverage(supabase).catch(() => null as SalesOrderCoverage | null),
    ])

    return NextResponse.json({
      result,
      summary: buildSummary(allFilteredOrders.data, allFilteredOrders.total),
      dataQuality: buildDataQualitySummary(allFilteredOrders.data, allScopeOrders.data),
      salesReps,
      salesOrderCoverage,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
