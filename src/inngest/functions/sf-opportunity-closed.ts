import { inngest } from '../client'
import { logger } from '@/lib/utils/logger'
import {
  logSyncEvent,
  updateSyncEvent,
  hasSuccessfulSync,
  updateSyncSchedule,
} from '@/lib/utils/logger'
import { calculateNextRetry } from '@/lib/utils/retry'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { getUnsyncedClosedOpportunities } from '@/lib/salesforce/queries'
import { updateOpportunityFulfillment } from '@/lib/salesforce/mutations'
import { createFishbowlClient } from '@/lib/fishbowl/client'
import { createSalesOrder, findCustomerByName, createCustomer } from '@/lib/fishbowl/sales-orders'
import { validatePartNumbers } from '@/lib/fishbowl/inventory'
import type { FBSalesOrderPayload } from '@/types'

/**
 * P1: Salesforce Opportunity Closed → Fishbowl Sales Order
 *
 * Polls Salesforce every 2 minutes for newly closed-won opportunities
 * and creates Sales Orders in Fishbowl.
 */
export const sfOpportunityClosed = inngest.createFunction(
  {
    id: 'sf-opportunity-closed',
    name: 'P1: SF Opportunity → Fishbowl SO',
    retries: 3,
    triggers: [{ cron: '*/2 * * * *' }],
  },
  async ({ step }) => {
    const startTime = Date.now()
    let processedCount = 0
    let failedCount = 0

    // Step 1: Connect to both systems
    const sfClient = createSalesforceClient()
    const fbClient = createFishbowlClient()

    await step.run('connect-systems', async () => {
      await sfClient.connect()
      await fbClient.authenticate()
    })

    // Step 2: Get unsynced closed-won opportunities
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

    logger.log('info', 'P1_OPP_TO_SO', `Found ${opportunities.length} unsynced opportunities`)

    // Step 3: Process each opportunity
    for (const opp of opportunities) {
      await step.run(`process-opp-${opp.Id}`, async () => {
        // 3a: Check idempotency — skip if already synced successfully
        const alreadySynced = await hasSuccessfulSync(opp.Id)
        if (alreadySynced) {
          logger.log('info', 'P1_OPP_TO_SO', `Skipping ${opp.Id} — already synced`)
          return
        }

        // 3b: Create sync event log entry
        const eventId = await logSyncEvent({
          automation: 'P1_OPP_TO_SO',
          sourceSystem: 'salesforce',
          targetSystem: 'fishbowl',
          sourceRecordId: opp.Id,
          status: 'pending',
          payload: { opportunityName: opp.Name, amount: opp.Amount },
          idempotencyKey: opp.Id,
        })

        try {
          // 3c: Validate all SKUs exist in Fishbowl
          const lineItems = opp.OpportunityLineItems?.records || []
          const skus = lineItems.map((li) => li.Product2.ProductCode)
          const validation = await validatePartNumbers(fbClient, skus)

          if (validation.invalid.length > 0) {
            await updateOpportunityFulfillment(sfClient, opp.Id, {
              fulfillmentStatus: 'SKU Mismatch - Manual Review',
              fulfillmentError: `Invalid SKUs: ${validation.invalid.join(', ')}`,
            })
            await updateSyncEvent(eventId, {
              status: 'failed',
              errorMessage: `SKU mismatch: ${validation.invalid.join(', ')}`,
              completedAt: new Date().toISOString(),
            })
            failedCount++
            return
          }

          // 3d: Check if customer exists in Fishbowl, create if not
          const accountName = opp.Account?.Name || 'Unknown Customer'
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
            logger.log('info', 'P1_OPP_TO_SO', `Created new Fishbowl customer: ${accountName}`)
          }

          // 3e: Build and create the Sales Order
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
            notes: `Synced from Salesforce Opportunity ${opp.Id}`,
          }

          const result = await createSalesOrder(fbClient, soPayload)

          // 3f: Write SO number back to Salesforce
          await updateOpportunityFulfillment(sfClient, opp.Id, {
            fishbowlSONumber: result.number,
            fulfillmentStatus: 'Pending',
          })

          // 3g: Log success
          await updateSyncEvent(eventId, {
            status: 'success',
            targetRecordId: result.number,
            response: result as unknown as Record<string, unknown>,
            completedAt: new Date().toISOString(),
          })

          logger.log('info', 'P1_OPP_TO_SO', `Created SO ${result.number} for Opp ${opp.Id}`)
          processedCount++
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'

          // Calculate retry schedule
          const nextRetry = calculateNextRetry(0)
          await updateSyncEvent(eventId, {
            status: 'failed',
            errorMessage,
            retryCount: 0,
            nextRetryAt: nextRetry?.toISOString() || null,
            completedAt: new Date().toISOString(),
          })

          // Update SF with error status (don't let SF update failure mask original error)
          await updateOpportunityFulfillment(sfClient, opp.Id, {
            fulfillmentStatus: 'Failed',
            fulfillmentError: errorMessage.substring(0, 255),
          }).catch(() => {})

          logger.log('error', 'P1_OPP_TO_SO', `Failed to process Opp ${opp.Id}: ${errorMessage}`)
          failedCount++
        }
      })
    }

    // Step 4: Update schedule
    await updateSyncSchedule('P1_OPP_TO_SO', {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: failedCount > 0 ? 'partial' : 'success',
      lastRunDurationMs: Date.now() - startTime,
      recordsProcessed: processedCount,
    })

    return { processed: processedCount, failed: failedCount }
  }
)
