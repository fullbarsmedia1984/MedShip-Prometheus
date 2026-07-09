import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { SALES_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getIncentiveSettings } from '@/lib/incentive/settings'
import { chicagoMonthStart } from '@/lib/incentive/dates'
import { computeCommission, computeCounterfactual, isPayoutBlocked } from '@/lib/incentive/calculator'
import {
  INCENTIVE_CACHE_TAG,
  buildCohortBreakdown,
  getRepIncentiveMonthly,
  getRepKeyForUser,
  getRepNewAccounts,
} from '@/lib/incentive/queries'
import type { IncentiveSettings } from '@/lib/incentive/types'

const MONTH_PATTERN = /^\d{4}-\d{2}-01$/

/**
 * Selectable months: January of the current Chicago year (or the month
 * before the promo, if that's earlier) through the current month. The
 * engine classifies all history, so every listed month has real data.
 */
function buildMonthOptions(settings: IncentiveSettings): string[] {
  const currentKey = chicagoMonthStart()
  const promoPrev = new Date(`${settings.promoStart.slice(0, 7)}-01T00:00:00Z`)
  promoPrev.setUTCMonth(promoPrev.getUTCMonth() - 1)
  const promoPrevKey = promoPrev.toISOString().slice(0, 10)
  const yearStartKey = `${currentKey.slice(0, 4)}-01-01`
  const startKey = promoPrevKey < yearStartKey ? promoPrevKey : yearStartKey

  const options: string[] = []
  for (let cursor = new Date(`${startKey}T00:00:00Z`); ; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const key = cursor.toISOString().slice(0, 10)
    options.push(key)
    if (key >= currentKey) break
  }
  return options
}

const getScorecardPayload = unstable_cache(
  async (repKey: string, month: string) => {
    const settings = await getIncentiveSettings()
    const monthRows = await getRepIncentiveMonthly(month)

    const reps = monthRows
      .map((row) => ({ key: row.rep_key, name: row.rep_display_name ?? row.rep_key }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const row = monthRows.find((candidate) => candidate.rep_key === repKey) ?? null
    const blocked = isPayoutBlocked(monthRows)
    const monthOptions = buildMonthOptions(settings)
    const inPromoPeriod =
      month >= `${settings.promoStart.slice(0, 7)}-01` && month <= `${settings.promoEnd.slice(0, 7)}-01`

    if (!row) {
      return {
        rep: repKey,
        month,
        monthOptions,
        inPromoPeriod,
        reps,
        found: false,
        payoutBlocked: blocked.blocked,
        blockingUnmappedCount: blocked.count,
      }
    }

    const commission = computeCommission(row, settings)
    const accounts = await getRepNewAccounts(repKey, settings)
    const breakdown = buildCohortBreakdown(row)

    // Legacy comparison: the deprecated model paid a flat baseRate on all
    // territory revenue — same attribution basis as attributed_revenue.
    // Under the tiered model the delta CAN be negative (quota penalty).
    const oldModelTotal =
      commission.legacyFlat ?? Math.round(settings.baseRate * row.attributed_revenue * 100) / 100
    const modelComparison = {
      oldModelTotal,
      newModelTotal: commission.projected,
      delta: commission.projected === null
        ? null
        : Math.round((commission.projected - oldModelTotal) * 100) / 100,
    }

    return {
      rep: repKey,
      repDisplayName: row.rep_display_name,
      month,
      monthOptions,
      inPromoPeriod,
      reps,
      found: true,
      gate: {
        enrollments: row.enrollments,
        threshold: row.enrollment_gate,
        qualifies: commission.qualifies,
        recurringRate: commission.recurringRate,
      },
      newCustomerRevenueMTD: row.new_revenue,
      commission: {
        new: commission.newCommission,
        winback: commission.winbackCommission,
        recurring: commission.recurringCommission,
        projected: commission.projected,
      },
      counterfactual: computeCounterfactual(row, settings),
      accounts,
      breakdown,
      modelComparison,
      rates: {
        new: settings.newRate,
        winback: settings.winbackRate,
        recurringFull: settings.recurringRateFull,
        recurringPartial: settings.recurringRatePartial,
        recurringZero: settings.recurringRateZero,
        legacyFlat: settings.baseRate,
      },
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
    const auth = await requireApiAuth(SALES_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    let repKey = request.nextUrl.searchParams.get('rep')?.trim() ?? ''
    const monthParam = request.nextUrl.searchParams.get('month')?.trim()
    const month = monthParam && MONTH_PATTERN.test(monthParam) ? monthParam : chicagoMonthStart()

    // Row scope: a sales_rep only ever sees their own scorecard, regardless
    // of what the query string asks for.
    const isRep = auth.role === 'sales_rep'
    if (isRep) {
      const ownKey = auth.user ? await getRepKeyForUser(auth.user.id) : null
      if (!ownKey) {
        return NextResponse.json(
          { error: 'Your login is not linked to a sales rep. Ask an admin to set your Salesforce user on your profile.' },
          { status: 403 }
        )
      }
      repKey = ownKey
    }

    // Rep-view preview for admins: ?viewAs=<repKey> returns the exact
    // payload shape a sales_rep login receives (locked, rep list trimmed),
    // so the rep experience can be validated before reps are invited.
    const viewAs = request.nextUrl.searchParams.get('viewAs')?.trim() ?? ''
    const isAdmin = auth.role === 'superadmin' || auth.role === 'admin'
    const previewing = !isRep && isAdmin && viewAs !== ''
    if (previewing) repKey = viewAs

    const payload = await getScorecardPayload(repKey, month)
    return NextResponse.json(
      isRep || previewing
        ? {
            ...payload,
            locked: true,
            previewing,
            reps: payload.reps.filter((rep) => rep.key === repKey),
          }
        : { ...payload, locked: false, previewing: false }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
