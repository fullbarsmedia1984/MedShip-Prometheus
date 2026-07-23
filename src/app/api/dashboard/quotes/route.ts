import { NextRequest, NextResponse } from 'next/server'
import { SALES_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { resolveRepScope } from '@/lib/sales-scope'
import { buildQuoteFilters, getQuotesDashboardPayload } from '@/lib/quotes-payload'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(SALES_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    // Reps only ever see their own quotes, regardless of requested filters.
    const repScope = await resolveRepScope(auth.role, auth.user)
    const filters = buildQuoteFilters(
      {
        status: params.get('status'),
        search: params.get('search'),
        scope: params.get('scope'),
      },
      repScope
    )
    const payload = await getQuotesDashboardPayload(
      filters,
      Number(params.get('page') ?? 1),
      Number(params.get('pageSize') ?? 20)
    )

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
