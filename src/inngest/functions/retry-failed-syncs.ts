import { inngest } from '../client'
import { logger } from '@/lib/utils/logger'
import { getRetryableEvents, updateSyncEvent } from '@/lib/utils/logger'
import { calculateNextRetry } from '@/lib/utils/retry'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { getOpportunityById } from '@/lib/salesforce/queries'
import { processP1Opportunity } from './sf-opportunity-closed'
import { runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'
import { FishbowlSessionLockError, withFishbowlSession } from '@/lib/fishbowl/session'

/**
 * Retry Failed Sync Events
 *
 * Runs every minute. Picks up failed sync events that are due for retry
 * and re-dispatches them to the appropriate automation logic.
 */
export const retryFailedSyncs = inngest.createFunction(
  {
    id: 'retry-failed-syncs',
    name: 'Retry Failed Sync Events',
    retries: 0,
    triggers: [{ cron: '* * * * *' }],
  },
  async ({ step }) => {
    const retryableEvents = await step.run('get-retryable', () => getRetryableEvents())

    if (retryableEvents.length === 0) return { retried: 0 }

    let retriedCount = 0

    for (const event of retryableEvents) {
      await step.run(`retry-${event.id}`, async () => {
        const currentRetryCount = event.retry_count ?? 0

        // Mark as retrying
        await updateSyncEvent(event.id!, {
          status: 'retrying',
          retryCount: currentRetryCount + 1,
          nextRetryAt: null,
        })

        // P1: Re-process the specific opportunity
        if (event.automation === 'P1_OPP_TO_SO') {
          if (!event.source_record_id) {
            await updateSyncEvent(event.id!, {
              status: 'failed',
              errorMessage: 'Cannot retry P1 event without source_record_id',
              nextRetryAt: null,
              completedAt: new Date().toISOString(),
            })
            return
          }

          try {
            const sfClient = createSalesforceClient()
            try {
              await runWithAuthCircuitBreaker(
                {
                  system: 'salesforce',
                  automation: 'P1_OPP_TO_SO',
                  sourceSystem: 'salesforce',
                  targetSystem: 'fishbowl',
                },
                () => sfClient.connect()
              )

              await withFishbowlSession(
                {
                  automation: 'P1_OPP_TO_SO',
                  sourceSystem: 'salesforce',
                  targetSystem: 'fishbowl',
                },
                async (fbClient) => {
                  const opp = await getOpportunityById(sfClient, event.source_record_id!)
                  if (!opp) {
                    await updateSyncEvent(event.id!, {
                      status: 'failed',
                      errorMessage: 'Opportunity not found in Salesforce',
                      nextRetryAt: null,
                      completedAt: new Date().toISOString(),
                    })
                    return
                  }

                  const result = await processP1Opportunity({
                    opp,
                    sfClient,
                    fbClient,
                    existingEventId: event.id!,
                    retryCount: currentRetryCount + 1,
                    maxRetries: event.max_retries ?? 4,
                    notesPrefix: 'Retry sync from Salesforce Opportunity',
                    sourcePayload: event.payload,
                  })

                  if (result.status === 'processed') {
                    retriedCount++
                  } else if (result.status === 'failed' && !result.errorMessage) {
                    await updateSyncEvent(event.id!, {
                      status: 'failed',
                      errorMessage: 'Retry failed without a reported error',
                      nextRetryAt: null,
                      completedAt: new Date().toISOString(),
                    })
                  }

                  if (
                    result.status === 'failed' &&
                    !result.nextRetryAt &&
                    currentRetryCount + 1 >= (event.max_retries ?? 4)
                  ) {
                    logger.log('error', 'P1_OPP_TO_SO', `Max retries exhausted for event ${event.id}`, {
                      sourceRecordId: event.source_record_id,
                    })
                  }

                  if (result.status === 'failed' && result.nextRetryAt) {
                    logger.log('warn', 'P1_OPP_TO_SO', `Scheduled retry for event ${event.id}`, {
                      sourceRecordId: event.source_record_id,
                      retryCount: currentRetryCount + 1,
                    })
                  }
                }
              )
            } finally {
              await sfClient.disconnect().catch(() => {})
            }
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'

            if (error instanceof FishbowlSessionLockError) {
              await updateSyncEvent(event.id!, {
                status: 'dismissed',
                errorMessage,
                retryCount: currentRetryCount + 1,
                nextRetryAt: calculateNextRetry(currentRetryCount + 1, event.max_retries ?? 4)?.toISOString() || null,
                completedAt: new Date().toISOString(),
              })
              return
            }

            const newRetryCount = currentRetryCount + 1
            const nextRetry = calculateNextRetry(newRetryCount, event.max_retries ?? 4)

            await updateSyncEvent(event.id!, {
              status: 'failed',
              errorMessage,
              retryCount: newRetryCount,
              nextRetryAt: nextRetry?.toISOString() || null,
              completedAt: new Date().toISOString(),
            })

            if (!nextRetry) {
              logger.log('error', 'P1_OPP_TO_SO', `Max retries exhausted for event ${event.id}`, {
                sourceRecordId: event.source_record_id,
              })
            } else {
              logger.log('error', 'P1_OPP_TO_SO', `Retry failed before processing event ${event.id}`, {
                sourceRecordId: event.source_record_id,
              })
            }
          }
        }

        // P2: All-or-nothing sync — dismiss and let next cron handle it
        if (event.automation === 'P2_INVENTORY_SYNC') {
          await updateSyncEvent(event.id!, { status: 'dismissed' })
        }

        // P3-P6: Not yet implemented — dismiss
        if (
          event.automation === 'P3_QB_INVOICE_SYNC' ||
          event.automation === 'P4_SHIPMENT_TRACKING' ||
          event.automation === 'P5_QUOTE_PDF' ||
          event.automation === 'P6_LOW_STOCK_CHECK'
        ) {
          await updateSyncEvent(event.id!, { status: 'dismissed' })
        }
      })
    }

    return { retried: retriedCount, total: retryableEvents.length }
  }
)
