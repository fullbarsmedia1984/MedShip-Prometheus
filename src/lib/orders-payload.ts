import 'server-only'
import { unstable_cache } from 'next/cache'
import { CACHE_TAGS, CACHE_TTL } from '@/lib/cache-tags'
import { getOrderById, getOrdersWorkingSet, getSalesReps } from '@/lib/data'
import type { OrderFilters, PaginatedResult } from '@/lib/data'
import type { Order, SalesRep } from '@/lib/seed-data'
import {
  getSalesOrderCoverage,
  type SalesOrderCoverage,
} from '@/lib/fishbowl/sales-order-completeness'

export type OrderSummary = {
  total: number
  totalRevenue: number
  avgOrderValue: number
}

export type OrdersDataQualitySummary = {
  totalCached: number
  visibleRows: number
  hiddenByScope: number
  likelyTest: number
  incompleteLines: number
}

export type OrdersDashboardPayload = {
  result: PaginatedResult<Order>
  summary: OrderSummary
  dataQuality: OrdersDataQualitySummary
  salesReps: SalesRep[]
  salesOrderCoverage: SalesOrderCoverage | null
}

export const ORDERS_DEFAULT_PAGE_SIZE = 20

export type OrderFilterParams = {
  status?: string | null
  salesRepId?: string | null
  search?: string | null
  scope?: string | null
}

/**
 * Single source of truth for turning request params plus the caller-resolved
 * rep row-scope into OrderFilters. Used by both the API route and the server
 * page so their filter/scoping semantics cannot drift.
 */
export function buildOrderFilters(
  params: OrderFilterParams,
  repScope: string[] | undefined
): OrderFilters {
  return {
    status: params.status ?? 'all',
    salesRepId: params.salesRepId ?? 'all',
    // Reps only ever see their own orders, regardless of requested filters.
    salespersonIn: repScope,
    search: params.search ?? '',
    scope: params.scope === 'all' ? 'all' : 'business',
  }
}

function buildSummary(orders: Order[], total: number): OrderSummary {
  const totalRevenue = orders.reduce((sum, order) => sum + order.subtotal, 0)

  return {
    total,
    totalRevenue,
    avgOrderValue: total > 0 ? Math.round(totalRevenue / total) : 0,
  }
}

function buildDataQualitySummary(
  visibleOrders: Order[],
  allOrders: Order[]
): OrdersDataQualitySummary {
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

// The filters (including any rep row-scope aliases) are cache-key arguments,
// so per-request auth state never leaks between cache entries. Auth itself
// stays with the caller (route handler / server page), outside the cached
// callback.
const getCachedOrdersPayload = unstable_cache(
  async (filters: OrderFilters, page: number, pageSize: number) => {
    const [{ result, filtered, allScope }, salesReps] = await Promise.all([
      getOrdersWorkingSet({ ...filters, page, pageSize }),
      getSalesReps(),
    ])

    return {
      result,
      summary: buildSummary(filtered, filtered.length),
      dataQuality: buildDataQualitySummary(filtered, allScope),
      salesReps,
    }
  },
  ['orders-dashboard-payload'],
  { revalidate: CACHE_TTL.salesOrders, tags: [CACHE_TAGS.orders] }
)

/**
 * Full orders dashboard payload (cached working set + live coverage stats).
 * Callers must resolve auth and the rep row-scope BEFORE calling this — the
 * scope aliases travel inside `filters` as cache-key arguments.
 */
export async function getOrdersDashboardPayload(
  filters: OrderFilters,
  page: number,
  pageSize: number
): Promise<OrdersDashboardPayload> {
  const [payload, salesOrderCoverage] = await Promise.all([
    getCachedOrdersPayload(filters, page, pageSize),
    getSalesOrderCoverage().catch(() => null as SalesOrderCoverage | null),
  ])

  return { ...payload, salesOrderCoverage }
}

/**
 * Detail lookup with the rep row-scope applied. Out-of-scope orders resolve
 * to null (not an auth error) so callers surface 404, never 403 — a rep must
 * not be able to confirm that another rep's order number exists. Shared by
 * the detail API route and the server-rendered detail page.
 */
export async function getScopedOrderById(
  id: string,
  repScope: string[] | undefined
): Promise<Order | null> {
  const order = await getOrderById(id)
  if (!order) return null
  if (repScope && !repScope.includes(order.salesRepId)) return null
  return order
}
