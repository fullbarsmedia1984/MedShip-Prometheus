import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getOrders, getSalesReps } from '@/lib/data'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    const [result, salesReps] = await Promise.all([
      getOrders({
        status: params.get('status') ?? 'all',
        salesRepId: params.get('salesRepId') ?? 'all',
        search: params.get('search') ?? '',
        page: Number(params.get('page') ?? 1),
        pageSize: Number(params.get('pageSize') ?? 20),
      }),
      getSalesReps(),
    ])

    return NextResponse.json({ result, salesReps })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
