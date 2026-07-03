import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getIncentiveSettings } from '@/lib/incentive/settings'
import { chicagoMonthStart } from '@/lib/incentive/dates'
import { isPayoutBlocked } from '@/lib/incentive/calculator'
import {
  INCENTIVE_CACHE_TAG,
  getBellFeed,
  getExceptions,
  getGateFeasibilityTrend,
  getRepIncentiveMonthly,
  getWinBackSummary,
} from '@/lib/incentive/queries'

const getIncentiveDashboardPayload = unstable_cache(
  async () => {
    const settings = await getIncentiveSettings()
    const month = chicagoMonthStart()

    const [monthRows, gateTrend, winBacks, exceptions, feed] = await Promise.all([
      getRepIncentiveMonthly(month),
      getGateFeasibilityTrend(),
      getWinBackSummary(settings),
      getExceptions(),
      getBellFeed(),
    ])

    const leaderboard = [...monthRows].sort(
      (a, b) => (b.projected_total ?? 0) - (a.projected_total ?? 0) || b.enrollments - a.enrollments
    )

    // Fail-loudly: the rollup carries the blocking count on every row, but a
    // month with zero classified orders has no rows — the unmapped worklist
    // (in-period order counts) covers that gap.
    const rollupBlocked = isPayoutBlocked(monthRows)
    const inPeriodUnmapped = exceptions.unmappedReps.filter((rep) => rep.order_count_in_period > 0).length
    const blockingUnmappedCount = Math.max(rollupBlocked.count, inPeriodUnmapped)

    return {
      month,
      settings,
      leaderboard,
      gateTrend,
      winBacks,
      exceptions,
      feed,
      payoutBlocked: blockingUnmappedCount > 0,
      blockingUnmappedCount,
    }
  },
  ['incentive-dashboard-payload'],
  {
    revalidate: 60,
    tags: [INCENTIVE_CACHE_TAG],
  }
)

export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    return NextResponse.json(await getIncentiveDashboardPayload())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
