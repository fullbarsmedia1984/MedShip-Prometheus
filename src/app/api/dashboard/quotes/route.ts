import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getQuotes } from '@/lib/data'
import type { QuoteFilters } from '@/lib/data'
import type { SeedQuote } from '@/lib/seed-data'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSalesOrderCoverage, type SalesOrderCoverage } from '@/lib/fishbowl/sales-order-completeness'

type QuoteSummary = {
  total: number
  totalAmount: number
  accepted: number
  avgDaysOpen: number
  statusCounts: Record<SeedQuote['status'], number>
}

type DataQualitySummary = {
  totalCached: number
  visibleRows: number
  hiddenByScope: number
  likelyTest: number
  historical: number
  incompleteLines: number
  zeroValue: number
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

function buildDataQualitySummary(visibleQuotes: SeedQuote[], allQuotes: SeedQuote[]): DataQualitySummary {
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

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    const scope = params.get('scope')
    const filters: QuoteFilters = {
      status: params.get('status') ?? 'all',
      search: params.get('search') ?? '',
      scope: scope === 'all' || scope === 'business' ? scope : 'active',
    }
    const allScopeFilters = { ...filters, scope: 'all' as const }
    const supabase = createAdminClient()
    const [result, allFilteredQuotes, allScopeQuotes, salesOrderCoverage] = await Promise.all([
      getQuotes({
        ...filters,
        page: Number(params.get('page') ?? 1),
        pageSize: Number(params.get('pageSize') ?? 20),
      }),
      getQuotes({ ...filters, pageSize: 100000 }),
      getQuotes({ ...allScopeFilters, pageSize: 100000 }),
      getSalesOrderCoverage(supabase).catch(() => null as SalesOrderCoverage | null),
    ])

    return NextResponse.json({
      result,
      summary: buildSummary(allFilteredQuotes.data, allFilteredQuotes.total),
      dataQuality: buildDataQualitySummary(allFilteredQuotes.data, allScopeQuotes.data),
      salesOrderCoverage,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
