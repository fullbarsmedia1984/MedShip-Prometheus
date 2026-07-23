import { inngest } from '../client'
import {
  FishbowlPriorityYieldError,
  FishbowlSessionLockError,
  withFishbowlSession,
} from '@/lib/fishbowl/session'
import {
  syncOpenPoLines,
  syncPurchaseOrders,
} from '@/lib/warehouse-board/po-sync'

/**
 * P11: Fishbowl Purchase Orders -> Supabase
 *
 * Durable PO cache (fb_purchase_orders / fb_purchase_order_items) for the
 * warehouse wallboard and upcoming Zeus purchasing features, plus the
 * wallboard's open-PO-lines fast cache.
 *
 * Schedule per ops: 8a, 10a, 12p, 2p, 4p Monday-Friday (America/Chicago).
 */
// One Fishbowl session for the whole run (both syncs), logged out in the
// session helper's finally — an unclosed session holds a license seat.
// Skips quietly when another automation holds the Fishbowl session lock;
// the next cron tick catches up.
async function runPurchaseOrdersSync() {
  try {
    return await withFishbowlSession(
      { automation: 'P11_PO_SYNC', sourceSystem: 'fishbowl', targetSystem: 'prometheus' },
      async (client) => {
        const result = await syncPurchaseOrders(client)
        const openLines = await syncOpenPoLines(client)
        return { ...result, openLines, skipped: false }
      }
    )
  } catch (error) {
    if (
      error instanceof FishbowlSessionLockError ||
      error instanceof FishbowlPriorityYieldError
    ) {
      return { skipped: true, reason: error.message }
    }
    throw error
  }
}

export const purchaseOrdersSync = inngest.createFunction(
  {
    id: 'purchase-orders-sync',
    name: 'P11: Purchase Orders Sync (FB -> Supabase)',
    retries: 2,
    triggers: [{ cron: 'TZ=America/Chicago 0 8,10,12,14,16 * * 1-5' }],
  },
  async ({ step }) => {
    return step.run('run-po-sync', () => runPurchaseOrdersSync())
  }
)

/**
 * Manual trigger for the purchase-orders sync.
 */
export const purchaseOrdersSyncManual = inngest.createFunction(
  {
    id: 'purchase-orders-sync-manual',
    name: 'P11: Purchase Orders Sync (Manual)',
    retries: 2,
    triggers: [{ event: 'fishbowl/purchase-orders.sync' }],
  },
  async ({ step }) => {
    return step.run('run-po-sync-manual', () => runPurchaseOrdersSync())
  }
)
