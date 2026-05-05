import { inngest } from '../client'
import { createAdminClient } from '@/lib/supabase/admin'
import { createFishbowlClient } from '@/lib/fishbowl/client'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { getAllSalesOrders } from '@/lib/fishbowl/sales-orders'
import { upsertSalesOrdersToCache } from '@/lib/fishbowl/sales-order-cache'
import { mirrorCanonicalSalesOrdersToSalesforce } from '@/lib/salesforce/quote-order-mirror'
import { logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'

async function runFishbowlSalesOrderSync(triggeredBy: string) {
  const startTime = Date.now()
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
  let salesforceMirror = null

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

  await logSyncEvent({
    automation: 'P7_FB_SO_SYNC',
    sourceSystem: 'fishbowl',
    targetSystem: 'salesforce',
    status: 'success',
    payload: { triggeredBy, totalRawOrders: rawOrders.length },
    response: { cache: result, salesforceMirror },
  })

  await updateSyncSchedule('P7_FB_SO_SYNC', {
    lastRunAt: new Date().toISOString(),
    lastRunStatus: 'success',
    lastRunDurationMs: Date.now() - startTime,
    recordsProcessed: result.orders,
  })

  return result
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
