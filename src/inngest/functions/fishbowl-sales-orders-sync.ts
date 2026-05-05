import { inngest } from '../client'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createFishbowlClient,
  getFishbowlConnectionProfile,
} from '@/lib/fishbowl/client'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { getAllSalesOrders } from '@/lib/fishbowl/sales-orders'
import { upsertSalesOrdersToCache } from '@/lib/fishbowl/sales-order-cache'
import {
  mirrorCanonicalSalesOrdersToSalesforce,
  type MirrorResult,
} from '@/lib/salesforce/quote-order-mirror'
import { logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'

async function runFishbowlSalesOrderSync(triggeredBy: string) {
  const startTime = Date.now()
  const connection = getFishbowlConnectionProfile()

  try {
    const fbClient = createFishbowlClient()

    await runWithAuthCircuitBreaker(
      {
        system: 'fishbowl',
        automation: 'P7_FB_SO_SYNC',
        sourceSystem: 'fishbowl',
        targetSystem: 'prometheus',
      },
      () => fbClient.authenticate()
    )

    const rawOrders = await getAllSalesOrders(fbClient)
    const supabase = createAdminClient()
    const result = await upsertSalesOrdersToCache(supabase, rawOrders)
    const sfClient = createSalesforceClient()
    let salesforceMirror: MirrorResult | null = null
    let salesforceMirrorError: string | null = null

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
        salesforceMirror = await mirrorCanonicalSalesOrdersToSalesforce(sfClient, supabase)
      } finally {
        await sfClient.disconnect()
      }
    } catch (error) {
      salesforceMirrorError = error instanceof Error ? error.message : 'Unknown Salesforce mirror error'
    }

    const mirrorIssues =
      salesforceMirrorError ||
      (salesforceMirror && (salesforceMirror.skipped > 0 || salesforceMirror.errors.length > 0))

    await logSyncEvent({
      automation: 'P7_FB_SO_SYNC',
      sourceSystem: 'fishbowl',
      targetSystem: 'salesforce',
      status: 'success',
      payload: { triggeredBy, totalRawOrders: rawOrders.length, connection },
      response: { cache: result, salesforceMirror, salesforceMirrorError },
      errorMessage: salesforceMirrorError ?? undefined,
    })

    await updateSyncSchedule('P7_FB_SO_SYNC', {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: mirrorIssues ? 'partial' : 'success',
      lastRunDurationMs: Date.now() - startTime,
      recordsProcessed: result.orders,
    })

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await logSyncEvent({
      automation: 'P7_FB_SO_SYNC',
      sourceSystem: 'fishbowl',
      targetSystem: 'salesforce',
      status: 'failed',
      payload: { triggeredBy, connection },
      errorMessage,
    })

    await updateSyncSchedule('P7_FB_SO_SYNC', {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'failed',
      lastRunDurationMs: Date.now() - startTime,
      recordsProcessed: 0,
    })

    throw error
  }
}

export const fishbowlSalesOrdersSync = inngest.createFunction(
  {
    id: 'fishbowl-sales-orders-sync',
    name: 'P7: Fishbowl Sales Orders Sync',
    retries: 2,
    triggers: [{ cron: '*/15 * * * *' }],
  },
  async ({ step }) => {
    return step.run('sync-fishbowl-sales-orders', () =>
      runFishbowlSalesOrderSync('schedule')
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
      runFishbowlSalesOrderSync(event.data.triggeredBy ?? 'manual')
    )
  }
)
