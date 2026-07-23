import { revalidateTag } from 'next/cache'
import { inngest } from '../client'
import { CACHE_TAGS } from '@/lib/cache-tags'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  FishbowlPriorityYieldError,
  FishbowlSessionLockError,
  withFishbowlSession,
} from '@/lib/fishbowl/session'
import {
  logSyncEvent,
  updateSyncEvent,
  updateSyncSchedule,
} from '@/lib/utils/logger'
import { syncReceiptEvents } from '@/lib/warehouse-board/receipts-sync'

const AUTOMATION = 'P14_RECEIPTS_SYNC' as const
const CRON = 'TZ=America/Chicago 11,26,41,56 6-18 * * 1-5'

async function isScheduleActive(): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('sync_schedules')
    .select('is_active')
    .eq('automation', AUTOMATION)
    .maybeSingle()
  if (error) throw error
  return data?.is_active === true
}

async function runReceiptsSync(respectSchedule: boolean) {
  if (respectSchedule && !(await isScheduleActive())) {
    return { skipped: true, reason: `${AUTOMATION} is disabled in sync_schedules` }
  }

  const startedAt = Date.now()
  const eventId = await logSyncEvent({
    automation: AUTOMATION,
    sourceSystem: 'fishbowl',
    targetSystem: 'prometheus',
    status: 'running',
  })
  try {
    // One Fishbowl session per run, logged out in the helper's finally — an
    // unclosed session holds a license seat until the server-side timeout.
    const result = await withFishbowlSession(
      { automation: AUTOMATION, sourceSystem: 'fishbowl', targetSystem: 'prometheus' },
      (client) => syncReceiptEvents(client)
    )
    const completedAt = new Date().toISOString()
    await updateSyncEvent(eventId, {
      status: 'success',
      response: { ...result },
      completedAt,
    })
    await updateSyncSchedule(AUTOMATION, {
      lastRunAt: completedAt,
      lastRunStatus: 'success',
      lastRunDurationMs: Date.now() - startedAt,
      recordsProcessed: result.receiptItems,
    })

    // Fresh receipt events feed the wallboard's Receiving view — bust its
    // cache. Best-effort: a revalidation hiccup must never fail the sync.
    try {
      revalidateTag(CACHE_TAGS.wallboard, { expire: 0 })
    } catch (revalidateError) {
      console.warn(`${AUTOMATION}: cache revalidation failed (non-fatal)`, revalidateError)
    }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const completedAt = new Date().toISOString()

    // Another automation holds the Fishbowl session — skip; the next
    // 15-minute tick catches up.
    if (
      error instanceof FishbowlSessionLockError ||
      error instanceof FishbowlPriorityYieldError
    ) {
      await updateSyncEvent(eventId, {
        status: 'dismissed',
        errorMessage: message,
        completedAt,
      })
      await updateSyncSchedule(AUTOMATION, {
        lastRunAt: completedAt,
        lastRunStatus: 'skipped',
        lastRunDurationMs: Date.now() - startedAt,
        recordsProcessed: 0,
      })
      return { skipped: true, reason: message }
    }

    await updateSyncEvent(eventId, {
      status: 'failed',
      errorMessage: message,
      completedAt,
    })
    await updateSyncSchedule(AUTOMATION, {
      lastRunAt: completedAt,
      lastRunStatus: 'failed',
      lastRunDurationMs: Date.now() - startedAt,
      recordsProcessed: 0,
    })
    throw error
  }
}

/** P14: immutable Fishbowl receipt-item events for Receiving Ops. */
export const receiptsSync = inngest.createFunction(
  {
    id: 'receipts-sync',
    name: 'P14: Receipt Events Sync (FB -> Supabase)',
    retries: 2,
    concurrency: [{ limit: 1 }],
    triggers: [{ cron: CRON }],
  },
  async ({ step }) =>
    step.run('run-receipts-sync', () => runReceiptsSync(true))
)

/** Manual P14 trigger used for initial backfill and reconciliation. */
export const receiptsSyncManual = inngest.createFunction(
  {
    id: 'receipts-sync-manual',
    name: 'P14: Receipt Events Sync (Manual)',
    retries: 2,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: 'fishbowl/receipts.sync' }],
  },
  async ({ step }) =>
    step.run('run-receipts-sync-manual', () => runReceiptsSync(false))
)
