import 'server-only'
import { unstable_cache } from 'next/cache'
import { CACHE_TAGS, CACHE_TTL } from '@/lib/cache-tags'
import { getQuoteById, getQuotesWorkingSet } from '@/lib/data'
import type { PaginatedResult, QuoteFilters } from '@/lib/data'
import type { SeedQuote } from '@/lib/seed-data'
import {
  getSalesOrderCoverage,
  type SalesOrderCoverage,
} from '@/lib/fishbowl/sales-order-completeness'

export type QuoteSummary = {
  total: number
  totalAmount: number
  accepted: number
  avgDaysOpen: number
  statusCounts: Record<SeedQuote['status'], number>
}

export type QuotesDataQualitySummary = {
  totalCached: number
  visibleRows: number
  hiddenByScope: number
  likelyTest: number
  historical: number
  incompleteLines: number
  zeroValue: number
}

export type QuotesDashboardPayload = {
  result: PaginatedResult<SeedQuote>
  summary: QuoteSummary
  dataQuality: QuotesDataQualitySummary
  salesOrderCoverage: SalesOrderCoverage | null
}

export const QUOTES_DEFAULT_PAGE_SIZE = 20

export type QuoteFilterParams = {
  status?: string | null
  search?: string | null
  scope?: string | null
}

/**
 * Single source of truth for turning request params plus the caller-resolved
 * rep row-scope into QuoteFilters. Used by both the API route and the server
 * page so their filter/scoping semantics cannot drift.
 */
export function buildQuoteFilters(
  params: QuoteFilterParams,
  repScope: string[] | undefined
): QuoteFilters {
  const scope = params.scope

  return {
    status: params.status ?? 'all',
    // Reps only ever see their own quotes, regardless of requested filters.
    salespersonIn: repScope,
    search: params.search ?? '',
    scope: scope === 'all' || scope === 'business' ? scope : 'active',
  }
}

const EMPTY_STATUS_COUNTS: Record<SeedQuote['status'], number> = {
  sent: 0,
  viewed: 0,
  accepted: 0,
  expired: 0,
  rejected: 0,
}

function buildSummary(quotes: SeedQuote[], total: number): QuoteSummary {
  const totalAmount = quotes.reduce((sum, quote) => sum + quote.amount, 0)
  const totalDaysOpen = quotes.reduce((sum, quote) => sum + quote.daysOpen, 0)
  const statusCounts = { ...EMPTY_STATUS_COUNTS }

  for (const quote of quotes) {
    statusCounts[quote.status] += 1
  }

  return {
    total,
    totalAmount,
    accepted: statusCounts.accepted,
    avgDaysOpen: quotes.length > 0 ? Math.round(totalDaysOpen / quotes.length) : 0,
    statusCounts,
  }
}

function buildDataQualitySummary(
  visibleQuotes: SeedQuote[],
  allQuotes: SeedQuote[]
): QuotesDataQualitySummary {
  const countFlag = (flag: string) =>
    allQuotes.filter((quote) => quote.dataQualityFlags?.includes(flag)).length

  return {
    totalCached: allQuotes.length,
    visibleRows: visibleQuotes.length,
    hiddenByScope: Math.max(0, allQuotes.length - visibleQuotes.length),
    likelyTest: countFlag('likely_test'),
    historical: countFlag('historical'),
    incompleteLines: countFlag('missing_line_items'),
    zeroValue: countFlag('zero_value'),
  }
}

// The filters (including any rep row-scope aliases) are cache-key arguments,
// so per-request auth state never leaks between cache entries. Auth itself
// stays with the caller (route handler / server page), outside the cached
// callback.
const getCachedQuotesPayload = unstable_cache(
  async (filters: QuoteFilters, page: number, pageSize: number) => {
    const { result, filtered, allScope } = await getQuotesWorkingSet({
      ...filters,
      page,
      pageSize,
    })

    return {
      result,
      summary: buildSummary(filtered, filtered.length),
      dataQuality: buildDataQualitySummary(filtered, allScope),
    }
  },
  ['quotes-dashboard-payload'],
  { revalidate: CACHE_TTL.salesOrders, tags: [CACHE_TAGS.quotes] }
)

/**
 * Full quotes dashboard payload (cached working set + live coverage stats).
 * Callers must resolve auth and the rep row-scope BEFORE calling this — the
 * scope aliases travel inside `filters` as cache-key arguments.
 */
export async function getQuotesDashboardPayload(
  filters: QuoteFilters,
  page: number,
  pageSize: number
): Promise<QuotesDashboardPayload> {
  const [payload, salesOrderCoverage] = await Promise.all([
    getCachedQuotesPayload(filters, page, pageSize),
    getSalesOrderCoverage().catch(() => null as SalesOrderCoverage | null),
  ])

  return { ...payload, salesOrderCoverage }
}

/**
 * Detail lookup with the rep row-scope applied (inside getQuoteById).
 * Out-of-scope quotes resolve to null (not an auth error) so callers surface
 * 404, never 403 — a rep must not be able to confirm that another rep's
 * quote number exists. Shared by the detail API route and the
 * server-rendered detail page.
 */
export async function getScopedQuoteById(
  id: string,
  repScope: string[] | undefined
): Promise<SeedQuote | null> {
  return getQuoteById(decodeURIComponent(id), { salespersonIn: repScope })
}
