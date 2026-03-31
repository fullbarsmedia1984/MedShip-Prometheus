import { inngest } from '../client'
import { logger } from '@/lib/utils/logger'

/**
 * P1: Salesforce Opportunity Closed → Fishbowl Sales Order
 *
 * Triggered when a Salesforce Opportunity is closed-won.
 * Creates a corresponding Sales Order in Fishbowl Inventory.
 *
 * Flow:
 * 1. Receive SF Platform Event with Opportunity ID
 * 2. Query SF for Opportunity details, line items, and Account
 * 3. Map SF fields to Fishbowl SO format
 * 4. Create SO in Fishbowl
 * 5. Update SF Opportunity with Fishbowl SO number
 * 6. Log success/failure to sync_events
 *
 * TODO: Implement in Phase 1
 */
export const sfOpportunityClosed = inngest.createFunction(
  {
    id: 'sf-opportunity-closed',
    name: 'P1: SF Opportunity → Fishbowl SO',
    retries: 3,
    triggers: [{ event: 'salesforce/opportunity.closed' }],
  },
  async ({ event, step }) => {
    const { opportunityId, accountId } = event.data

    logger.log('info', 'P1_OPP_TO_SO', 'Starting opportunity sync', {
      opportunityId,
      accountId,
    })

    // Create sync event log entry
    const eventId = await step.run('create-sync-event', async () => {
      return logger.createEvent({
        automation: 'P1_OPP_TO_SO',
        source_system: 'salesforce',
        target_system: 'fishbowl',
        source_record_id: opportunityId,
        status: 'pending',
        payload: event.data as Record<string, unknown>,
        idempotency_key: `P1_${opportunityId}`,
      })
    })

    // TODO: Implement in Phase 1
    // Step 1: Get Opportunity from Salesforce
    // Step 2: Get Opportunity Line Items
    // Step 3: Get Account shipping/billing details
    // Step 4: Apply field mappings
    // Step 5: Create Sales Order in Fishbowl
    // Step 6: Update Opportunity with SO number

    await step.run('log-not-implemented', async () => {
      logger.log('warn', 'P1_OPP_TO_SO', 'Function not yet implemented', {
        eventId,
        opportunityId,
      })

      await logger.fail(eventId, 'Not yet implemented - Phase 1')
    })

    return {
      success: false,
      message: 'P1 not yet implemented',
      opportunityId,
      eventId,
    }
  }
)
