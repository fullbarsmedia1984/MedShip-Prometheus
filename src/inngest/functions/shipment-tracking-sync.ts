import { inngest } from '../client'
import { logger } from '@/lib/utils/logger'

/**
 * P4: Fishbowl Shipments → Salesforce Tracking
 *
 * Scheduled job that syncs shipment tracking information from
 * Fishbowl to Salesforce Opportunities.
 * Runs every 15 minutes (configurable in sync_schedules table).
 *
 * Flow:
 * 1. Fetch recent shipments from Fishbowl
 * 2. Match with SF Opportunities by SO number
 * 3. Update SF Opportunity with tracking number
 * 4. Optionally create EasyPost tracker for status updates
 *
 * TODO: Implement in Phase 4
 */
export const shipmentTrackingSync = inngest.createFunction(
  {
    id: 'shipment-tracking-sync',
    name: 'P4: Shipment Tracking Sync',
    retries: 2,
    triggers: [{ cron: '*/15 * * * *' }],
  },
  async ({ step }) => {
    logger.log('info', 'P4_SHIPMENT_TRACKING', 'Starting scheduled shipment tracking sync')

    // Create sync event log entry
    const eventId = await step.run('create-sync-event', async () => {
      return logger.createEvent({
        automation: 'P4_SHIPMENT_TRACKING',
        source_system: 'fishbowl',
        target_system: 'salesforce',
        status: 'pending',
        idempotency_key: `P4_${new Date().toISOString().split('T')[0]}_${Date.now()}`,
      })
    })

    // TODO: Implement in Phase 4
    // Step 1: Fetch recent shipments from Fishbowl
    // Step 2: Filter for shipments not yet synced to SF
    // Step 3: Match with SF Opportunities by Fishbowl_SO_Number__c
    // Step 4: Update SF Opportunities with tracking numbers
    // Step 5: Optionally create EasyPost trackers

    await step.run('log-not-implemented', async () => {
      logger.log('warn', 'P4_SHIPMENT_TRACKING', 'Function not yet implemented', {
        eventId,
      })

      await logger.fail(eventId, 'Not yet implemented - Phase 4')
    })

    return {
      success: false,
      message: 'P4 not yet implemented',
      eventId,
      shipmentsProcessed: 0,
    }
  }
)

/**
 * Manual trigger for shipment tracking sync
 */
export const shipmentTrackingSyncManual = inngest.createFunction(
  {
    id: 'shipment-tracking-sync-manual',
    name: 'P4: Shipment Tracking (Manual)',
    retries: 2,
    triggers: [{ event: 'fishbowl/shipment.sync' }],
  },
  async ({ event, step }) => {
    const { dayRange = 7 } = event.data

    logger.log('info', 'P4_SHIPMENT_TRACKING', 'Starting manual shipment tracking sync', {
      dayRange,
    })

    // TODO: Implement in Phase 4

    return {
      success: false,
      message: 'P4 manual sync not yet implemented',
      dayRange,
    }
  }
)
