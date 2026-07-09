import { inngest } from '../client'
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
async function runPurchaseOrdersSync() {
  const result = await syncPurchaseOrders()
  const openLines = await syncOpenPoLines()
  return { ...result, openLines }
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
