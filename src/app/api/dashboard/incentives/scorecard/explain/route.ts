import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { SALES_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getIncentiveSettings } from '@/lib/incentive/settings'
import { chicagoMonthStart } from '@/lib/incentive/dates'
import { computeCommission, computeCounterfactual } from '@/lib/incentive/calculator'
import { getCommissionExplanation } from '@/lib/incentive/explain'
import {
  INCENTIVE_CACHE_TAG,
  getRepClassBreakdown,
  getRepIncentiveMonthly,
  getRepKeyForUser,
} from '@/lib/incentive/queries'

const MONTH_PATTERN = /^\d{4}-\d{2}-01$/

// AI text is cached for an hour per (rep, month) — the figures only move on
// recompute, and INCENTIVE_CACHE_TAG invalidation covers admin edits.
const getExplanationPayload = unstable_cache(
  async (repKey: string, month: string) => {
    const settings = await getIncentiveSettings()
    const monthRows = await getRepIncentiveMonthly(month)
    const row = monthRows.find((candidate) => candidate.rep_key === repKey) ?? null
    if (!row) return { found: false as const }

    const commission = computeCommission(row, settings)
    const breakdown = await getRepClassBreakdown(repKey, month)
    const oldModelTotal = Math.round(settings.baseRate * row.attributed_revenue * 100) / 100
    const newModelTotal = commission.projected ?? oldModelTotal
    const monthLabel = new Date(`${month}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
    const inPromoPeriod =
      month >= `${settings.promoStart.slice(0, 7)}-01` && month <= `${settings.promoEnd.slice(0, 7)}-01`

    const explanation = await getCommissionExplanation({
      repName: row.rep_display_name ?? row.rep_key,
      monthLabel,
      inPromoPeriod,
      enrollments: row.enrollments,
      enrollmentGate: row.enrollment_gate,
      qualifies: commission.qualifies,
      breakdown,
      baseRate: settings.baseRate,
      bonusRate: settings.bonusRate,
      oldModelTotal,
      newModelTotal,
      delta: Math.round((newModelTotal - oldModelTotal) * 100) / 100,
      counterfactualMessage: computeCounterfactual(row, settings)?.message ?? null,
    })

    return { found: true as const, explanation }
  },
  ['incentive-scorecard-explain'],
  {
    revalidate: 3600,
    tags: [INCENTIVE_CACHE_TAG],
  }
)

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(SALES_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    let repKey = request.nextUrl.searchParams.get('rep')?.trim() ?? ''
    const monthParam = request.nextUrl.searchParams.get('month')?.trim()
    const month = monthParam && MONTH_PATTERN.test(monthParam) ? monthParam : chicagoMonthStart()

    // Same row-scoping rules as the scorecard endpoint.
    if (auth.role === 'sales_rep') {
      const ownKey = auth.user ? await getRepKeyForUser(auth.user.id) : null
      if (!ownKey) {
        return NextResponse.json({ error: 'Login not linked to a sales rep' }, { status: 403 })
      }
      repKey = ownKey
    } else {
      const viewAs = request.nextUrl.searchParams.get('viewAs')?.trim()
      const isAdmin = auth.role === 'superadmin' || auth.role === 'admin'
      if (isAdmin && viewAs) repKey = viewAs
    }

    if (!repKey) return NextResponse.json({ error: 'rep is required' }, { status: 400 })

    return NextResponse.json(await getExplanationPayload(repKey, month))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
