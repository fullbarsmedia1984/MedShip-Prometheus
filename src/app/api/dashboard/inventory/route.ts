import { NextRequest, NextResponse } from 'next/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getInventory, getInventoryKpis } from '@/lib/data'
import type { InboundBucketKey } from '@/lib/inventory/analytics'

const INBOUND_BUCKETS: readonly InboundBucketKey[] = [
  'overdue', 'this_week', 'next_week', 'two_to_four', 'later', 'no_date',
]

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    const bucketParam = params.get('inboundBucket')
    const [result, kpis] = await Promise.all([
      getInventory({
        category: params.get('category') ?? 'all',
        stockStatus: (params.get('stockStatus') ?? 'all') as 'all' | 'in_stock' | 'low' | 'out_of_stock',
        search: params.get('search') ?? '',
        sort: params.get('sort') ?? undefined,
        inboundBucket: (INBOUND_BUCKETS as readonly string[]).includes(bucketParam ?? '')
          ? (bucketParam as InboundBucketKey)
          : undefined,
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
