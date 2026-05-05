import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getSyncEvents, getEventKpis } from '@/lib/data'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    const [result, kpis] = await Promise.all([
      getSyncEvents({
        automation: params.get('automation') ?? 'all',
        status: params.get('status') ?? 'all',
        search: params.get('search') ?? '',
        dateFrom: params.get('dateFrom') ?? undefined,
        dateTo: params.get('dateTo') ?? undefined,
        page: Number(params.get('page') ?? 1),
        pageSize: Number(params.get('pageSize') ?? 20),
      }),
      getEventKpis(),
    ])

    return NextResponse.json({ result, kpis })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
