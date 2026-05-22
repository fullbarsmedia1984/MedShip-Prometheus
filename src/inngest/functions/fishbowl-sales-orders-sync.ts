import { inngest } from '../client'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFishbowlConnectionProfile, type FishbowlClient } from '@/lib/fishbowl/client'
import { FishbowlSessionLockError, withFishbowlSession } from '@/lib/fishbowl/session'
import { createSalesforceClient } from '@/lib/salesforce/client'
import {
  mirrorCanonicalSalesOrdersToSalesforce,
  type MirrorResult,
} from '@/lib/salesforce/quote-order-mirror'
import {
  hydrateSalesOrderDetailBatch,
  pauseSalesOrderBackfill,
  processSalesOrderPageBatch,
  retryFailedSalesOrderBackfill,
  startSalesOrderBackfill,
} from '@/lib/fishbowl/sales-order-completeness'
import { logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'

type P7Action =
  | 'backfill.start'
  | 'backfill.pages'
  | 'detail.hydrate'
  | 'incremental'
  | 'pause'
  | 'retry.failed'
  | 'salesforce.mirror'

async function withP7FishbowlSession<T>(operation: (client: FishbowlClient) => Promise<T>) {
  return withFishbowlSession(
    {
      automation: 'P7_FB_SO_SYNC',
      sourceSystem: 'fishbowl',
      targetSystem: 'prometheus',
    },
    operation
  )
}

async function mirrorHydratedRowsToSalesforce(supabase: ReturnType<typeof createAdminClient>) {
  const sfClient = createSalesforceClient()
  try {
    await runWithAuthCircuitBreaker(
      {
        system: 'salesforce',
        automation: 'P7_FB_SO_SYNC',
        sourceSystem: 'prometheus',
        targetSystem: 'salesforce',
      },
      () => sfClient.connect()
    )

    try {
      return await mirrorCanonicalSalesOrdersToSalesforce(sfClient, supabase)
    } finally {
      await sfClient.disconnect()
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown Salesforce mirror error',
    }
  }
}

async function runFishbowlSalesOrderSync(triggeredBy: string, action: P7Action = 'incremental') {
  const startTime = Date.now()
  const connection = getFishbowlConnectionProfile()
  const supabase = createAdminClient()

  try {
    let result: Record<string, unknown>
    let salesforceMirror: MirrorResult | null = null

    if (action === 'pause') {
      result = await pauseSalesOrderBackfill(supabase)
    } else if (action === 'retry.failed') {
      result = await retryFailedSalesOrderBackfill(supabase)
    } else if (action === 'backfill.start') {
      result = await withP7FishbowlSession((client) => startSalesOrderBackfill(supabase, client))
    } else if (action === 'backfill.pages') {
      result = await withP7FishbowlSession((client) => processSalesOrderPageBatch(supabase, client))
    } else if (action === 'detail.hydrate') {
      result = await withP7FishbowlSession((client) => hydrateSalesOrderDetailBatch(supabase, client))
    } else if (action === 'salesforce.mirror') {
      const mirrorResult = await mirrorHydratedRowsToSalesforce(supabase)
      salesforceMirror = 'error' in mirrorResult ? null : mirrorResult
      result = { salesforceMirror }
      if ('error' in mirrorResult) {
        result = { ...result, salesforceMirrorError: mirrorResult.error }
      }
    } else {
      result = await processIncrementalChunk(supabase)
    }

    await logSyncEvent({
      automation: 'P7_FB_SO_SYNC',
      sourceSystem: action === 'salesforce.mirror' ? 'prometheus' : 'fishbowl',
      targetSystem: action === 'salesforce.mirror' ? 'salesforce' : 'prometheus',
      status: 'success',
      payload: { triggeredBy, action, connection },
      response: { result, salesforceMirror },
    })

    await updateSyncSchedule('P7_FB_SO_SYNC', {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'success',
      lastRunDurationMs: Date.now() - startTime,
      recordsProcessed: Number(result.headersUpserted ?? result.detailsSucceeded ?? 0),
    })

    return {
      action,
      result,
      salesforceMirror,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const isLocked = error instanceof FishbowlSessionLockError

    await logSyncEvent({
      automation: 'P7_FB_SO_SYNC',
      sourceSystem: action === 'salesforce.mirror' ? 'prometheus' : 'fishbowl',
      targetSystem: action === 'salesforce.mirror' ? 'salesforce' : 'prometheus',
      status: isLocked ? 'dismissed' : 'failed',
      payload: { triggeredBy, action, connection },
      errorMessage,
    })

    await updateSyncSchedule('P7_FB_SO_SYNC', {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: isLocked ? 'skipped' : 'failed',
      lastRunDurationMs: Date.now() - startTime,
      recordsProcessed: 0,
    })

    if (isLocked) {
      return {
        action,
        skipped: true,
        reason: errorMessage,
      }
    }

    throw error
  }
}

async function startIfNeeded(supabase: ReturnType<typeof createAdminClient>) {
  const { count, error } = await supabase
    .from('fishbowl_so_page_checkpoints')
    .select('*', { count: 'exact', head: true })

  if (error) throw new Error(`Could not check Fishbowl SO checkpoints: ${error.message}`)
  if ((count ?? 0) > 0) return { skipped: true, reason: 'checkpoints_exist' }

  return withP7FishbowlSession((client) => startSalesOrderBackfill(supabase, client))
}

async function processIncrementalChunk(supabase: ReturnType<typeof createAdminClient>) {
  const started = await startIfNeeded(supabase)

  return withP7FishbowlSession(async (client) => {
    const pages = await processSalesOrderPageBatch(supabase, client)
    const details = await hydrateSalesOrderDetailBatch(supabase, client)

    return { started, pages, details }
  })
}

export const fishbowlSalesOrdersSync = inngest.createFunction(
  {
    id: 'fishbowl-sales-orders-sync',
    name: 'P7: Fishbowl Sales Orders Sync',
    retries: 2,
    triggers: [{ cron: '5,20,35,50 * * * *' }],
  },
  async ({ step }) => {
    return step.run('sync-fishbowl-sales-orders', () =>
      runFishbowlSalesOrderSync('schedule', 'incremental')
    )
  }
)

export const fishbowlSalesOrdersSyncManual = inngest.createFunction(
  {
    id: 'fishbowl-sales-orders-sync-manual',
    name: 'P7: Fishbowl Sales Orders Sync (Manual)',
    retries: 2,
    triggers: [{ event: 'fishbowl/sales-orders.sync' }],
  },
  async ({ event, step }) => {
    return step.run('sync-fishbowl-sales-orders-manual', () =>
      runFishbowlSalesOrderSync(
        event.data.triggeredBy ?? 'manual',
        event.data.action ?? (event.data.fullSync ? 'backfill.start' : 'incremental')
      )
    )
  }
)

export const fishbowlSalesOrdersBackfillPages = inngest.createFunction(
  {
    id: 'fishbowl-sales-orders-backfill-pages',
    name: 'P7: Fishbowl Sales Orders Backfill Pages',
    retries: 2,
    triggers: [{ event: 'fishbowl/sales-orders.backfill.pages' }],
  },
  async ({ event, step }) => {
    return step.run('fishbowl-sales-orders-backfill-pages', () =>
      runFishbowlSalesOrderSync(event.data.triggeredBy ?? 'manual', 'backfill.pages')
    )
  }
)

export const fishbowlSalesOrdersDetailHydrate = inngest.createFunction(
  {
    id: 'fishbowl-sales-orders-detail-hydrate',
    name: 'P7: Fishbowl Sales Orders Detail Hydrate',
    retries: 2,
    triggers: [{ event: 'fishbowl/sales-orders.detail.hydrate' }],
  },
  async ({ event, step }) => {
    return step.run('fishbowl-sales-orders-detail-hydrate', () =>
      runFishbowlSalesOrderSync(event.data.triggeredBy ?? 'manual', 'detail.hydrate')
    )
  }
)
