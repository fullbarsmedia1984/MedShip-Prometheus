import { inngest } from '../client'
import { logger } from '@/lib/utils/logger'
import {
  logSyncEvent,
  updateSyncEvent,
  hasSuccessfulSync,
  getSyncEventByIdempotencyKey,
  updateSyncSchedule,
} from '@/lib/utils/logger'
import { calculateNextRetry } from '@/lib/utils/retry'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { getOpportunityById, getUnsyncedClosedOpportunities } from '@/lib/salesforce/queries'
import { updateOpportunityFulfillment } from '@/lib/salesforce/mutations'
import type { FishbowlClient } from '@/lib/fishbowl/client'
import { createSalesOrder, findCustomerByName, createCustomer, getSalesOrderByNumber } from '@/lib/fishbowl/sales-orders'
import { upsertSalesOrdersToCache } from '@/lib/fishbowl/sales-order-cache'
import { validatePartNumbers } from '@/lib/fishbowl/inventory'
import type { FBSalesOrderPayload } from '@/types'
import type { SFOpportunity } from '@/lib/salesforce/types'
import { CircuitBreakerOpenError, runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'
import { FishbowlSessionLockError, withFishbowlSession } from '@/lib/fishbowl/session'

type SalesforceClientInstance = ReturnType<typeof createSalesforceClient>
type FishbowlClientInstance = FishbowlClient

type P1ProcessResult = {
  status: 'processed' | 'failed' | 'skipped'
  eventId?: string
  targetRecordId?: string
  errorMessage?: string
  nextRetryAt?: string | null
}

function getEventData(event: unknown): Record<string, unknown> | undefined {
  if (!event || typeof event !== 'object' || !('data' in event)) return undefined

  const data = event.data
  return data && typeof data === 'object'
    ? data as Record<string, unknown>
    : undefined
}

function getEventOpportunityId(event: unknown): string | undefined {
  const data = getEventData(event)
  return typeof data?.opportunityId === 'string'
    ? data.opportunityId
    : undefined
}

function getEventPayload(event: unknown): Record<string, unknown> | undefined {
  const data = getEventData(event)
  if (!data) return undefined

  return {
    opportunityId: data.opportunityId,
    accountId: data.accountId,
    amount: data.amount,
    closeDate: data.closeDate,
  }
}

async function isP1ScheduleActive() {
  const { data, error } = await createAdminClient()
    .from('sync_schedules')
    .select('is_active')
    .eq('automation', 'P1_OPP_TO_SO')
    .maybeSingle()

  if (error) {
    logger.log('warn', 'P1_OPP_TO_SO', 'Could not read sync schedule; allowing P1 run', {
      error: error.message,
    })
    return true
  }

  return data?.is_active !== false
}

function shouldProcessOpportunity(opp: SFOpportunity) {
  if (opp.StageName && opp.StageName !== 'Closed Won') {
    return { shouldProcess: false, reason: `Opportunity stage is ${opp.StageName}` }
  }

  if (opp.Fishbowl_SO_Number__c) {
    return { shouldProcess: false, reason: 'Opportunity already has Fishbowl SO number' }
  }

  const lineItems = opp.OpportunityLineItems?.records ?? []
  if (lineItems.length === 0) {
    return { shouldProcess: false, reason: 'Opportunity has no line items' }
  }

  return { shouldProcess: true, reason: null }
}

async function markP1Skipped(startTime: number, reason: string) {
  await updateSyncSchedule('P1_OPP_TO_SO', {
    lastRunAt: new Date().toISOString(),
    lastRunStatus: 'skipped',
    lastRunDurationMs: Date.now() - startTime,
    recordsProcessed: 0,
  })

  return { processed: 0, failed: 0, skipped: true, reason }
}

export async function processP1Opportunity({
  opp,
  sfClient,
  fbClient,
  existingEventId,
  retryCount = 0,
  maxRetries = 4,
  sourcePayload,
  notesPrefix = 'Synced from Salesforce Opportunity',
}: {
  opp: SFOpportunity
  sfClient: SalesforceClientInstance
  fbClient: FishbowlClientInstance
  existingEventId?: string
  retryCount?: number
  maxRetries?: number
  sourcePayload?: Record<string, unknown>
  notesPrefix?: string
}): Promise<P1ProcessResult> {
  const existingSyncEvent = existingEventId
    ? null
    : await getSyncEventByIdempotencyKey(opp.Id)
  const alreadySynced = existingSyncEvent?.status === 'success' ||
    (existingEventId ? await hasSuccessfulSync(opp.Id) : false)

  if (alreadySynced) {
    logger.log('info', 'P1_OPP_TO_SO', `Skipping ${opp.Id} - already synced`)

    if (existingEventId) {
      await updateSyncEvent(existingEventId, {
        status: 'dismissed',
        response: { skipped: 'already_synced' },
        nextRetryAt: null,
        completedAt: new Date().toISOString(),
      })
    }

    return { status: 'skipped', eventId: existingEventId ?? existingSyncEvent?.id }
  }

  if (
    !existingEventId &&
    (existingSyncEvent?.status === 'pending' ||
      existingSyncEvent?.status === 'running' ||
      existingSyncEvent?.status === 'retrying')
  ) {
    logger.log('info', 'P1_OPP_TO_SO', `Skipping ${opp.Id} - sync already in progress`)
    return { status: 'skipped', eventId: existingSyncEvent.id }
  }

  const eventId = existingEventId ?? existingSyncEvent?.id ?? await logSyncEvent({
    automation: 'P1_OPP_TO_SO',
    sourceSystem: 'salesforce',
    targetSystem: 'fishbowl',
    sourceRecordId: opp.Id,
    status: 'pending',
    payload: {
      opportunityName: opp.Name,
      amount: opp.Amount,
      ...sourcePayload,
    },
    idempotencyKey: opp.Id,
  })
  const effectiveRetryCount = Math.max(retryCount, existingSyncEvent?.retry_count ?? 0)
  const effectiveMaxRetries = existingSyncEvent?.max_retries ?? maxRetries

  if (!existingEventId && existingSyncEvent?.id) {
    await updateSyncEvent(existingSyncEvent.id, {
      status: 'running',
      nextRetryAt: null,
    })
  }

  try {
    const lineItems = opp.OpportunityLineItems?.records || []
    const skus = lineItems.map((li) => li.Product2.ProductCode)
    const validation = await validatePartNumbers(fbClient, skus)

    if (validation.invalid.length > 0) {
      const errorMessage = `SKU mismatch: ${validation.invalid.join(', ')}`

      await updateOpportunityFulfillment(sfClient, opp.Id, {
        fulfillmentStatus: 'SKU Mismatch - Manual Review',
        fulfillmentError: `Invalid SKUs: ${validation.invalid.join(', ')}`,
      })
      await updateSyncEvent(eventId, {
        status: 'failed',
        errorMessage,
        nextRetryAt: null,
        completedAt: new Date().toISOString(),
      })

      return { status: 'failed', eventId, errorMessage, nextRetryAt: null }
    }

    const accountName = opp.Account?.Name || 'Unknown Customer'
    const customer = await findCustomerByName(fbClient, accountName)
    if (!customer) {
      await createCustomer(fbClient, {
        name: accountName,
        address: opp.Account?.ShippingStreet || undefined,
        city: opp.Account?.ShippingCity || undefined,
        state: opp.Account?.ShippingState || undefined,
        zip: opp.Account?.ShippingPostalCode || undefined,
        country: opp.Account?.ShippingCountry || undefined,
      })
      logger.log('info', 'P1_OPP_TO_SO', `Created new Fishbowl customer: ${accountName}`)
    }

    const soPayload: FBSalesOrderPayload = {
      customer: { name: accountName },
      status: 'Estimate',
      shipTo: {
        name: accountName,
        address: opp.Account?.ShippingStreet || '',
        city: opp.Account?.ShippingCity || '',
        state: opp.Account?.ShippingState || '',
        zip: opp.Account?.ShippingPostalCode || '',
        country: opp.Account?.ShippingCountry || 'US',
      },
      items: lineItems.map((li) => ({
        number: li.Product2.ProductCode,
        quantity: li.Quantity,
        unitPrice: li.UnitPrice,
        description: li.Product2.Name,
      })),
      notes: `${notesPrefix} ${opp.Id}`,
    }

    const result = await createSalesOrder(fbClient, soPayload)

    await updateOpportunityFulfillment(sfClient, opp.Id, {
      fishbowlSONumber: result.number,
      fulfillmentStatus: 'Quote Created',
    })

    const createdOrder = await getSalesOrderByNumber(fbClient, result.number)
    if (createdOrder && typeof createdOrder === 'object') {
      await upsertSalesOrdersToCache(createAdminClient(), [
        {
          ...(createdOrder as Record<string, unknown>),
          sfOpportunityId: opp.Id,
        },
      ])
    }

    await updateSyncEvent(eventId, {
      status: 'success',
      targetRecordId: result.number,
      response: result as unknown as Record<string, unknown>,
      nextRetryAt: null,
      completedAt: new Date().toISOString(),
    })

    logger.log('info', 'P1_OPP_TO_SO', `Created SO ${result.number} for Opp ${opp.Id}`)

    return { status: 'processed', eventId, targetRecordId: result.number }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const nextRetry = calculateNextRetry(effectiveRetryCount, effectiveMaxRetries)

    await updateSyncEvent(eventId, {
      status: 'failed',
      errorMessage,
      retryCount: effectiveRetryCount,
      nextRetryAt: nextRetry?.toISOString() || null,
      completedAt: new Date().toISOString(),
    })

    await updateOpportunityFulfillment(sfClient, opp.Id, {
      fulfillmentStatus: 'Failed',
      fulfillmentError: errorMessage.substring(0, 255),
    }).catch(() => {})

    logger.log('error', 'P1_OPP_TO_SO', `Failed to process Opp ${opp.Id}: ${errorMessage}`)

    return {
      status: 'failed',
      eventId,
      errorMessage,
      nextRetryAt: nextRetry?.toISOString() || null,
    }
  }
}

/**
 * P1: Salesforce Opportunity Closed -> Fishbowl Sales Order
 *
 * Cron trigger polls Salesforce for newly closed-won
 * opportunities. Event trigger processes a specific opportunity from manual
 * requests or Salesforce webhooks.
 */
export const sfOpportunityClosed = inngest.createFunction(
  {
    id: 'sf-opportunity-closed',
    name: 'P1: SF Opportunity -> Fishbowl SO',
    retries: 0,
    triggers: [
      { cron: '*/15 * * * *' },
      { event: 'salesforce/opportunity.closed' },
    ],
  },
  async ({ event, step }) => {
    const startTime = Date.now()
    let processedCount = 0
    let failedCount = 0
    const isOpportunityEvent = event.name === 'salesforce/opportunity.closed'
    const opportunityId = getEventOpportunityId(event)

    const scheduleActive = await step.run('check-p1-schedule-active', isP1ScheduleActive)
    if (!scheduleActive) {
      return markP1Skipped(startTime, 'P1_OPP_TO_SO is disabled in sync_schedules')
    }

    const sfClient = createSalesforceClient()
    try {
      await step.run('connect-salesforce', async () => {
        await runWithAuthCircuitBreaker(
          {
            system: 'salesforce',
            automation: 'P1_OPP_TO_SO',
            sourceSystem: 'salesforce',
            targetSystem: 'fishbowl',
          },
          () => sfClient.connect()
        )
      })

      if (isOpportunityEvent) {
        if (!opportunityId) {
          logger.log('error', 'P1_OPP_TO_SO', 'Opportunity event missing opportunityId')
          return { processed: 0, failed: 1, message: 'Missing opportunityId' }
        }

        const opportunity = await step.run(`fetch-opp-${opportunityId}`, async () => {
          return getOpportunityById(sfClient, opportunityId)
        })

        if (!opportunity) {
          await step.run(`log-missing-opp-${opportunityId}`, async () => {
            await logSyncEvent({
              automation: 'P1_OPP_TO_SO',
              sourceSystem: 'salesforce',
              targetSystem: 'fishbowl',
              sourceRecordId: opportunityId,
              status: 'failed',
              payload: getEventPayload(event),
              errorMessage: 'Opportunity not found in Salesforce',
              idempotencyKey: opportunityId,
            })
          })

          return {
            processed: 0,
            failed: 1,
            message: 'Opportunity not found in Salesforce',
          }
        }

        const readiness = shouldProcessOpportunity(opportunity)
        if (!readiness.shouldProcess) {
          logger.log('info', 'P1_OPP_TO_SO', `Skipping ${opportunity.Id} - ${readiness.reason}`)
          return {
            processed: 0,
            failed: 0,
            skipped: 1,
            sourceRecordId: opportunity.Id,
            message: readiness.reason,
          }
        }

        const result = await withFishbowlSession(
          {
            automation: 'P1_OPP_TO_SO',
            sourceSystem: 'salesforce',
            targetSystem: 'fishbowl',
          },
          async (fbClient) => {
            return step.run(`process-opp-${opportunity.Id}`, async () => {
              return processP1Opportunity({
                opp: opportunity,
                sfClient,
                fbClient,
                sourcePayload: getEventPayload(event),
              })
            })
          }
        )

        return {
          processed: result.status === 'processed' ? 1 : 0,
          failed: result.status === 'failed' ? 1 : 0,
          skipped: result.status === 'skipped' ? 1 : 0,
          eventId: result.eventId,
          targetRecordId: result.targetRecordId,
          errorMessage: result.errorMessage,
        }
      }

      const opportunities = await step.run('fetch-unsynced-opps', async () => {
        return getUnsyncedClosedOpportunities(sfClient)
      })

      if (opportunities.length === 0) {
        await updateSyncSchedule('P1_OPP_TO_SO', {
          lastRunAt: new Date().toISOString(),
          lastRunStatus: 'success',
          lastRunDurationMs: Date.now() - startTime,
          recordsProcessed: 0,
        })
        return { processed: 0, failed: 0, message: 'No unsynced opportunities found' }
      }

      const actionableOpportunities = opportunities.filter((opp) => {
        const readiness = shouldProcessOpportunity(opp)
        if (!readiness.shouldProcess) {
          logger.log('info', 'P1_OPP_TO_SO', `Skipping ${opp.Id} - ${readiness.reason}`)
        }
        return readiness.shouldProcess
      })

      if (actionableOpportunities.length === 0) {
        await updateSyncSchedule('P1_OPP_TO_SO', {
          lastRunAt: new Date().toISOString(),
          lastRunStatus: 'success',
          lastRunDurationMs: Date.now() - startTime,
          recordsProcessed: 0,
        })
        return {
          processed: 0,
          failed: 0,
          skipped: opportunities.length,
          message: 'No actionable unsynced opportunities found',
        }
      }

      logger.log('info', 'P1_OPP_TO_SO', `Found ${actionableOpportunities.length} actionable unsynced opportunities`)

      const result = await withFishbowlSession(
        {
          automation: 'P1_OPP_TO_SO',
          sourceSystem: 'salesforce',
          targetSystem: 'fishbowl',
        },
        async (fbClient) => {
          for (const opp of actionableOpportunities) {
            await step.run(`process-opp-${opp.Id}`, async () => {
              const result = await processP1Opportunity({
                opp,
                sfClient,
                fbClient,
              })

              if (result.status === 'processed') {
                processedCount++
              } else if (result.status === 'failed') {
                failedCount++
              }
            })
          }

          return { processed: processedCount, failed: failedCount }
        }
      )

      await updateSyncSchedule('P1_OPP_TO_SO', {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: failedCount > 0 ? 'partial' : 'success',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: processedCount,
      })

      return result
    } catch (error) {
      if (error instanceof FishbowlSessionLockError || error instanceof CircuitBreakerOpenError) {
        logger.log('warn', 'P1_OPP_TO_SO', `Skipping P1 external sync work: ${error.message}`, {
          triggeredBy: isOpportunityEvent ? 'event' : 'schedule',
          opportunityId,
        })
        return markP1Skipped(startTime, error.message)
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown P1 failure'
      const triggeredBy = isOpportunityEvent ? 'event' : 'schedule'

      logger.log('error', 'P1_OPP_TO_SO', `Top-level P1 failure: ${errorMessage}`, {
        triggeredBy,
        opportunityId,
      })

      await logSyncEvent({
        automation: 'P1_OPP_TO_SO',
        sourceSystem: 'salesforce',
        targetSystem: 'fishbowl',
        sourceRecordId: opportunityId,
        status: 'failed',
        payload: {
          triggeredBy,
          opportunityId,
          phase: 'top_level',
        },
        errorMessage,
        idempotencyKey: opportunityId
          ? `p1-top-level:${opportunityId}:${new Date().toISOString().slice(0, 13)}`
          : `p1-top-level:${triggeredBy}:${new Date().toISOString().slice(0, 13)}`,
      })

      await updateSyncSchedule('P1_OPP_TO_SO', {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: 'failed',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: 0,
      })

      return { processed: 0, failed: 1, errorMessage }
    } finally {
      await sfClient.disconnect().catch(() => {})
    }
  }
)
