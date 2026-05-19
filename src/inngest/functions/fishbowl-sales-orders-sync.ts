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
  resolveSalesOrderOpportunityLinks,
  type SalesOrderLinkResolverResult,
} from '@/lib/fishbowl/sales-order-links'
import {
  mirrorCanonicalSalesOrdersToSalesforce,
  type MirrorResult,
} from '@/lib/salesforce/quote-order-mirror'
import { logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'

async function runFishbowlSalesOrderSync(triggeredBy: string) {
  const startTime = Date.now()
  const connection = getFishbowlConnectionProfile()
  const fbClient = createFishbowlClient()

  try {
    await runWithAuthCircuitBreaker(
      {
        system: 'fishbowl',
        automation: 'P7_FB_SO_SYNC',
        sourceSystem: 'fishbowl',
        targetSystem: 'prometheus',
      },
      () => fbClient.authenticate()
    )

    const rawOrders = await getAllSalesOrders(fbClient, {
      hydrateDetails: true,
      detailLimit: Number(process.env.FISHBOWL_SO_DETAIL_LIMIT ?? 500),
    })
    const supabase = createAdminClient()
    const result = await upsertSalesOrdersToCache(supabase, rawOrders)
    let salesOrderLinks: SalesOrderLinkResolverResult | null = null
    let salesOrderLinksError: string | null = null

    try {
      salesOrderLinks = await resolveSalesOrderOpportunityLinks(supabase)
    } catch (error) {
      salesOrderLinksError = error instanceof Error
        ? error.message
        : 'Unknown sales order link resolver error'
    }

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
    const partialIssues = Boolean(salesOrderLinksError || mirrorIssues)
    const errorMessages = [salesOrderLinksError, salesforceMirrorError]
      .filter((message): message is string => Boolean(message))

    await logSyncEvent({
      automation: 'P7_FB_SO_SYNC',
      sourceSystem: 'fishbowl',
      targetSystem: 'salesforce',
      status: 'success',
      payload: { triggeredBy, totalRawOrders: rawOrders.length, connection },
      response: { cache: result, salesOrderLinks, salesOrderLinksError, salesforceMirror, salesforceMirrorError },
      errorMessage: errorMessages.length > 0 ? errorMessages.join(' | ') : undefined,
    })

    await updateSyncSchedule('P7_FB_SO_SYNC', {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: partialIssues ? 'partial' : 'success',
      lastRunDurationMs: Date.now() - startTime,
      recordsProcessed: result.orders,
    })

    return {
      cache: result,
      salesOrderLinks,
      salesOrderLinksError,
      salesforceMirror,
      salesforceMirrorError,
    }
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
  } finally {
    await fbClient.logout()
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
