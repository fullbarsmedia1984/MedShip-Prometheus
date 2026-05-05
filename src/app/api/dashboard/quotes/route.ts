import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getQuotes } from '@/lib/data'
import type { SeedQuote } from '@/lib/seed-data'

type QuoteSummary = {
  total: number
  totalAmount: number
  accepted: number
  avgDaysOpen: number
  statusCounts: Record<SeedQuote['status'], number>
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

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    const [result, allQuotes] = await Promise.all([
      getQuotes({
        status: params.get('status') ?? 'all',
        search: params.get('search') ?? '',
        page: Number(params.get('page') ?? 1),
        pageSize: Number(params.get('pageSize') ?? 20),
      }),
      getQuotes({ pageSize: 100000 }),
    ])

    return NextResponse.json({
      result,
      summary: buildSummary(allQuotes.data, allQuotes.total),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
