import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { requireApiAuth } from '@/lib/auth'
import { getIncentiveSettings } from '@/lib/incentive/settings'
import { chicagoMonthStart } from '@/lib/incentive/dates'
import { computeCommission, computeCounterfactual, isPayoutBlocked } from '@/lib/incentive/calculator'
import {
  INCENTIVE_CACHE_TAG,
  getRepIncentiveMonthly,
  getRepNewAccounts,
} from '@/lib/incentive/queries'

const MONTH_PATTERN = /^\d{4}-\d{2}-01$/

const getScorecardPayload = unstable_cache(
  async (repKey: string, month: string) => {
    const settings = await getIncentiveSettings()
    const monthRows = await getRepIncentiveMonthly(month)

    const reps = monthRows
      .map((row) => ({ key: row.rep_key, name: row.rep_display_name ?? row.rep_key }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const row = monthRows.find((candidate) => candidate.rep_key === repKey) ?? null
    const blocked = isPayoutBlocked(monthRows)

    if (!row) {
      return {
        rep: repKey,
        month,
        reps,
        found: false,
        payoutBlocked: blocked.blocked,
        blockingUnmappedCount: blocked.count,
      }
    }

    const commission = computeCommission(row, settings)
    const accounts = await getRepNewAccounts(repKey, settings)

    return {
      rep: repKey,
      repDisplayName: row.rep_display_name,
      month,
      reps,
      found: true,
      gate: {
        enrollments: row.enrollments,
        threshold: row.enrollment_gate,
        qualifies: commission.qualifies,
      },
      newCustomerRevenueMTD: row.net_new_customer_revenue,
      commission: {
        base: commission.base,
        bonus: commission.bonus,
        projected: commission.projected,
      },
      counterfactual: computeCounterfactual(row, settings),
      accounts,
      payoutBlocked: blocked.blocked,
      blockingUnmappedCount: blocked.count,
    }
  },
  ['incentive-scorecard-payload'],
  {
    revalidate: 60,
    tags: [INCENTIVE_CACHE_TAG],
  }
)

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const repKey = request.nextUrl.searchParams.get('rep')?.trim() ?? ''
    const monthParam = request.nextUrl.searchParams.get('month')?.trim()
    const month = monthParam && MONTH_PATTERN.test(monthParam) ? monthParam : chicagoMonthStart()

    return NextResponse.json(await getScorecardPayload(repKey, month))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
