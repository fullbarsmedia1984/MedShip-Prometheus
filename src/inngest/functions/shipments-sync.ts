import { inngest } from '../client'
import { syncRecentShipments } from '@/lib/warehouse-board/shipments-sync'

/**
 * P12: Fishbowl Shipments -> Supabase (rolling 10-day cache)
 *
 * Drives the warehouse wallboard's "Shipped" lane. Shipments are the
 * ground truth for "went out the door today" — SO status flips lag and
 * partial shipments never flip the SO at all. Small payload (~dozens of
 * rows), so it runs every 15 minutes alongside the SO list sync.
 */
export const shipmentsCacheSync = inngest.createFunction(
  {
    id: 'shipments-cache-sync',
    name: 'P12: Recent Shipments Cache (FB -> Supabase)',
    retries: 2,
    triggers: [{ cron: '7,22,37,52 * * * *' }],
  },
  async ({ step }) => {
    return step.run('run-shipments-sync', async () => ({
      shipments: await syncRecentShipments(),
    }))
  }
)

/**
 * Manual trigger for the shipments cache sync.
 */
export const shipmentsCacheSyncManual = inngest.createFunction(
  {
    id: 'shipments-cache-sync-manual',
    name: 'P12: Recent Shipments Cache (Manual)',
    retries: 2,
    triggers: [{ event: 'fishbowl/shipments.sync' }],
  },
  async ({ step }) => {
    return step.run('run-shipments-sync-manual', async () => ({
      shipments: await syncRecentShipments(),
    }))
  }
)
