import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { ADMIN_API_AUTH_OPTIONS, STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import {
  INCENTIVE_CACHE_TAG,
  freezeIncentiveMonth,
  getPayoutSnapshots,
  getPayoutVariance,
} from '@/lib/incentive/queries'

export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const [snapshots, variance] = await Promise.all([getPayoutSnapshots(), getPayoutVariance()])
    return NextResponse.json({ snapshots, variance })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = (await request.json()) as { month?: string }
    if (!body.month || !/^\d{4}-\d{2}-01$/.test(body.month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM-01' }, { status: 400 })
    }

    // Deliberately no force passthrough: overwriting a frozen (paid) month
    // is a break-glass operation done in SQL, not a button.
    const result = await freezeIncentiveMonth(body.month, auth.user?.email ?? 'admin')
    revalidateTag(INCENTIVE_CACHE_TAG, { expire: 0 })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    // Surface the RPC's fail-loud messages (month not over, already frozen,
    // payout blocked) verbatim — they are the UX.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
