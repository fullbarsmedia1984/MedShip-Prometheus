import { NextRequest, NextResponse } from 'next/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getInventory, getInventoryKpis } from '@/lib/data'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    const [result, kpis] = await Promise.all([
      getInventory({
        category: params.get('category') ?? 'all',
        stockStatus: (params.get('stockStatus') ?? 'all') as 'all' | 'in_stock' | 'low' | 'out_of_stock',
        search: params.get('search') ?? '',
        page: Number(params.get('page') ?? 1),
        pageSize: Number(params.get('pageSize') ?? 20),
      }),
      getInventoryKpis(),
    ])

    return NextResponse.json({ result, kpis })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
