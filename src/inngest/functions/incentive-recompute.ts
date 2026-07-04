import { inngest } from '../client'
import { updateSyncSchedule } from '@/lib/utils/logger'
import { getIncentiveSettings } from '@/lib/incentive/settings'
import {
  getRefreshState,
  triggerIncentiveRefreshRpc,
  triggerIncentiveWorklistRefreshRpc,
  triggerRevenueCohortRefreshRpc,
} from '@/lib/incentive/queries'
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
