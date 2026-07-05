import { inngest } from '../client'
import { updateSyncSchedule } from '@/lib/utils/logger'
import { getIncentiveSettings } from '@/lib/incentive/settings'
import {
  freezeIncentiveMonth,
  getPayoutSnapshots,
  getRefreshState,
  triggerIncentiveRefreshRpc,
  triggerIncentiveWorklistRefreshRpc,
  triggerRevenueCohortRefreshRpc,
} from '@/lib/incentive/queries'
import { autoFreezeTargetMonth } from '@/lib/incentive/dates'
import { findUnrungEnrollments, ringBell } from '@/lib/incentive/bell'

// P8: Q3 incentive classification recompute.
//
// The classification tables (customer_first_order / order_incentive_class,
// migration 026) are a full deterministic rebuild — required because the P7
// backfill retroactively shifts sales_order_metric_at as date_issued
// hydrates. Statement-level triggers set incentive_refresh_state.dirty_at
// on any change to orders, the merge map, or rep aliases; this cron
// (offset 5 minutes after each P7 tick at 5,20,35,50) refreshes only when
// dirty, then rings the new-account bell for any unrung enrollments.
// Bell dedupe lives in the DB primary key, so overlapping runs are safe.

type RecomputeSummary = {
  skipped: boolean
  refreshResult: Record<string, unknown> | null
  cohortResult: Record<string, unknown> | null
  bellsRung: number
  bellErrors: number
}

async function runRecompute(force: boolean): Promise<RecomputeSummary> {
  if (!force) {
    const state = await getRefreshState()
    const dirtyAt = state?.dirty_at ? new Date(state.dirty_at).getTime() : null
    const lastRefreshAt = state?.last_refresh_at ? new Date(state.last_refresh_at).getTime() : null
    if (dirtyAt !== null && lastRefreshAt !== null && dirtyAt <= lastRefreshAt) {
      return { skipped: true, refreshResult: null, cohortResult: null, bellsRung: 0, bellErrors: 0 }
    }
  }

  const refreshResult = await triggerIncentiveRefreshRpc()
  // Revenue cohorts (NEW / WINBACK / RECURRING, migration 028) share the
  // same inputs and dirty flag — rebuild them in the same pass.
  const cohortResult = await triggerRevenueCohortRefreshRpc()
  // Admin worklist snapshots (migration 031): the merge-candidate and
  // reconciliation views are too expensive to compute per request.
  await triggerIncentiveWorklistRefreshRpc()

  const settings = await getIncentiveSettings()
  const candidates = await findUnrungEnrollments(settings)
  let bellsRung = 0
  let bellErrors = 0
  for (const candidate of candidates) {
    try {
      const result = await ringBell(candidate)
      if (result.rung) bellsRung++
      if (result.webhook && !result.webhook.sent) bellErrors++
    } catch {
      bellErrors++
    }
  }

  return { skipped: false, refreshResult, cohortResult, bellsRung, bellErrors }
}

export const incentiveRecompute = inngest.createFunction(
  {
    id: 'incentive-recompute',
    name: 'P8: Incentive Recompute',
    retries: 2,
    triggers: [{ cron: '10,25,40,55 * * * *' }],
  },
  async ({ step }) => {
    const startTime = Date.now()

    const summary = await step.run('refresh-and-ring', () => runRecompute(false))

    await step.run('update-schedule', () =>
      updateSyncSchedule('P8_INCENTIVE_RECOMPUTE', {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: summary.skipped ? 'success' : summary.bellErrors > 0 ? 'partial' : 'success',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: summary.bellsRung,
      })
    )

    return summary
  }
)

// Auto-freeze: 7 days after a promo month ends (America/Chicago), freeze
// its payout snapshot so finance pays immutable figures (Steven,
// 2026-07-04). The RPC fail-louds if any rep row is still payout-blocked
// by unmapped salespersons — in that case this cron retries daily and the
// admin page shows the blocker until aliases are resolved.
const FREEZE_GRACE_DAYS = 7

export const incentivePayoutFreeze = inngest.createFunction(
  {
    id: 'incentive-payout-freeze',
    name: 'P8: Incentive Payout Freeze',
    retries: 1,
    triggers: [{ cron: '0 15 * * *' }], // daily 15:00 UTC = 9/10am Chicago
  },
  async ({ step }) => {
    const target = autoFreezeTargetMonth(new Date(), FREEZE_GRACE_DAYS)
    if (!target) return { skipped: true, reason: 'inside grace period' }

    // Only promo months are payable — never auto-freeze pre/post-promo
    // months (June would otherwise freeze on July 8 as a dry-run artifact).
    const settings = await getIncentiveSettings()
    const promoFirstMonth = `${settings.promoStart.slice(0, 7)}-01`
    const promoLastMonth = `${settings.promoEnd.slice(0, 7)}-01`
    if (target < promoFirstMonth || target > promoLastMonth) {
      return { skipped: true, reason: `month ${target} is outside the promo period` }
    }

    const alreadyFrozen = await step.run('check-existing', async () => {
      const snapshots = await getPayoutSnapshots()
      return snapshots.some((row) => row.month === target)
    })
    if (alreadyFrozen) return { skipped: true, reason: `month ${target} already frozen` }

    const result = await step.run('freeze', () => freezeIncentiveMonth(target, 'auto-freeze cron'))
    return { skipped: false, target, result }
  }
)

export const incentiveRecomputeManual = inngest.createFunction(
  {
    id: 'incentive-recompute-manual',
    name: 'P8: Incentive Recompute (Manual)',
    retries: 1,
    triggers: [{ event: 'incentive/recompute' }],
  },
  async ({ event, step }) => {
    const startTime = Date.now()
    const triggeredBy = (event.data as { triggeredBy?: string } | undefined)?.triggeredBy ?? 'manual'

    // Manual triggers always recompute (no dirty check): admin edits expect
    // an immediate, visible refresh.
    const summary = await step.run('refresh-and-ring', () => runRecompute(true))

    await step.run('update-schedule', () =>
      updateSyncSchedule('P8_INCENTIVE_RECOMPUTE', {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: summary.bellErrors > 0 ? 'partial' : 'success',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: summary.bellsRung,
      })
    )

    return { ...summary, triggeredBy }
  }
)
