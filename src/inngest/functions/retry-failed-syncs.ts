import { inngest } from '../client'
import { logger } from '@/lib/utils/logger'
import { getRetryableEvents, updateSyncEvent } from '@/lib/utils/logger'
import { calculateNextRetry } from '@/lib/utils/retry'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { getOpportunityById } from '@/lib/salesforce/queries'
import { updateOpportunityFulfillment } from '@/lib/salesforce/mutations'
import { createFishbowlClient } from '@/lib/fishbowl/client'
import { createSalesOrder, findCustomerByName, createCustomer } from '@/lib/fishbowl/sales-orders'
import type { FBSalesOrderPayload } from '@/types'

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
        })

        // P1: Re-process the specific opportunity
        if (event.automation === 'P1_OPP_TO_SO' && event.source_record_id) {
          try {
            const sfClient = createSalesforceClient()
            const fbClient = createFishbowlClient()
            await sfClient.connect()
            await fbClient.authenticate()

            const opp = await getOpportunityById(sfClient, event.source_record_id)
            if (!opp) {
              await updateSyncEvent(event.id!, {
                status: 'failed',
                errorMessage: 'Opportunity not found in Salesforce',
                completedAt: new Date().toISOString(),
              })
              return
            }

            const lineItems = opp.OpportunityLineItems?.records || []
            const accountName = opp.Account?.Name || 'Unknown Customer'

            // Ensure customer exists
            let customer = await findCustomerByName(fbClient, accountName)
            if (!customer) {
              customer = await createCustomer(fbClient, {
                name: accountName,
                address: opp.Account?.ShippingStreet || undefined,
                city: opp.Account?.ShippingCity || undefined,
                state: opp.Account?.ShippingState || undefined,
                zip: opp.Account?.ShippingPostalCode || undefined,
                country: opp.Account?.ShippingCountry || undefined,
              })
            }

            const soPayload: FBSalesOrderPayload = {
              customer: { name: accountName },
              status: 'Issued',
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
              notes: `Retry sync from Salesforce Opportunity ${opp.Id}`,
            }

            const result = await createSalesOrder(fbClient, soPayload)

            // Write SO number back to Salesforce
            await updateOpportunityFulfillment(sfClient, opp.Id, {
              fishbowlSONumber: result.number,
              fulfillmentStatus: 'Pending',
            })

            await updateSyncEvent(event.id!, {
              status: 'success',
              targetRecordId: result.number,
              response: result as unknown as Record<string, unknown>,
              completedAt: new Date().toISOString(),
            })

            retriedCount++
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            const newRetryCount = currentRetryCount + 1
            const nextRetry = calculateNextRetry(newRetryCount)

            await updateSyncEvent(event.id!, {
              status: 'failed',
              errorMessage,
              retryCount: newRetryCount,
              nextRetryAt: nextRetry?.toISOString() || null,
              completedAt: nextRetry ? undefined : new Date().toISOString(),
            })

            if (!nextRetry) {
              logger.log('error', 'P1_OPP_TO_SO', `Max retries exhausted for event ${event.id}`, {
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
