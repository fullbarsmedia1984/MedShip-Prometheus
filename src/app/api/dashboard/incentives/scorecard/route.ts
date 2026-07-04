import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { SALES_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getIncentiveSettings } from '@/lib/incentive/settings'
import { chicagoMonthStart } from '@/lib/incentive/dates'
import { computeCommission, computeCounterfactual, isPayoutBlocked } from '@/lib/incentive/calculator'
import {
  INCENTIVE_CACHE_TAG,
  getRepIncentiveMonthly,
  getRepKeyForUser,
  getRepNewAccounts,
} from '@/lib/incentive/queries'
import type { IncentiveSettings } from '@/lib/incentive/types'

const MONTH_PATTERN = /^\d{4}-\d{2}-01$/

/** Selectable months: one month before the promo through the current month. */
function buildMonthOptions(settings: IncentiveSettings): string[] {
  const start = new Date(`${settings.promoStart.slice(0, 7)}-01T00:00:00Z`)
  start.setUTCMonth(start.getUTCMonth() - 1)
  const currentKey = chicagoMonthStart()
  const end = new Date(`${settings.promoEnd.slice(0, 7)}-01T00:00:00Z`)
  const options: string[] = []
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const key = cursor.toISOString().slice(0, 10)
    options.push(key)
    if (key === currentKey) break
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

    if (!row) {
      return {
        rep: repKey,
        month,
        monthOptions,
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
      monthOptions,
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
