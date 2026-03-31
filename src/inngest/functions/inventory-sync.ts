import { inngest } from '../client'
import { logger } from '@/lib/utils/logger'
import { logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { bulkUpdateProductInventory } from '@/lib/salesforce/mutations'
import { createFishbowlClient } from '@/lib/fishbowl/client'
import { getAllInventory } from '@/lib/fishbowl/inventory'
import type { SFProductUpdate } from '@/lib/salesforce/types'

/**
 * P2: Fishbowl Inventory → Salesforce Products
 *
 * Scheduled job that syncs inventory levels from Fishbowl to Salesforce.
 * Runs every 15 minutes.
 *
 * Flow:
 * 1. Fetch all inventory from Fishbowl
 * 2. Upsert to local inventory_snapshot table
 * 3. Bulk update Salesforce Product2 records with stock levels
 * 4. Trigger low-stock check event (P6)
 */
export const inventorySync = inngest.createFunction(
  {
    id: 'inventory-sync',
    name: 'P2: Inventory Sync (FB → SF)',
    retries: 2,
    triggers: [{ cron: '*/15 * * * *' }],
  },
  async ({ step }) => {
    const startTime = Date.now()

    logger.log('info', 'P2_INVENTORY_SYNC', 'Starting scheduled inventory sync')

    // Step 1: Connect to Fishbowl and fetch all inventory
    const fbClient = createFishbowlClient()
    await step.run('connect-fishbowl', () => fbClient.authenticate())

    const inventory = await step.run('fetch-all-inventory', () =>
      getAllInventory(fbClient)
    )

    // Step 2: Upsert inventory to Supabase snapshot table
    await step.run('update-snapshot', async () => {
      const supabase = createAdminClient()

      for (let i = 0; i < inventory.length; i += 100) {
        const chunk = inventory.slice(i, i + 100)
        const rows = chunk.map((item) => ({
          part_number: item.partNumber,
          part_description: item.partDescription || null,
          qty_on_hand: parseFloat(item.quantity) || 0,
          qty_allocated: 0,
          qty_available: parseFloat(item.quantity) || 0,
          uom: item.uom?.abbreviation || 'ea',
          fishbowl_part_id: item.id,
          last_synced_at: new Date().toISOString(),
        }))

        const { error } = await supabase
          .from('inventory_snapshot')
          .upsert(rows, { onConflict: 'part_number' })

        if (error) {
          console.error(`Supabase upsert error on chunk ${i}:`, error)
        }
      }
    })

    // Step 3: Update Salesforce Product2 records with stock levels
    const sfClient = createSalesforceClient()
    await step.run('connect-salesforce', () => sfClient.connect())

    const updateResult = await step.run('update-sf-products', async () => {
      const products: SFProductUpdate[] = inventory.map((item) => ({
        productCode: item.partNumber,
        qtyOnHand: parseFloat(item.quantity) || 0,
        qtyAvailable: parseFloat(item.quantity) || 0,
      }))

      return bulkUpdateProductInventory(sfClient, products)
    })

    // Step 4: Log sync event
    await step.run('log-result', async () => {
      await logSyncEvent({
        automation: 'P2_INVENTORY_SYNC',
        sourceSystem: 'fishbowl',
        targetSystem: 'salesforce',
        status: 'success',
        payload: { totalParts: inventory.length },
        response: updateResult as unknown as Record<string, unknown>,
      })

      await updateSyncSchedule('P2_INVENTORY_SYNC', {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: 'success',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: inventory.length,
      })
    })

    // Step 5: Trigger low stock check (P6)
    await inngest.send({
      name: 'inventory/low-stock.check',
      data: { triggeredBy: 'P2_INVENTORY_SYNC' },
    })

    logger.log('info', 'P2_INVENTORY_SYNC', `Synced ${inventory.length} items`, {
      sfUpdates: updateResult,
    })

    return { synced: inventory.length, sfUpdates: updateResult }
  }
)

/**
 * Manual trigger for inventory sync
 */
export const inventorySyncManual = inngest.createFunction(
  {
    id: 'inventory-sync-manual',
    name: 'P2: Inventory Sync (Manual)',
    retries: 2,
    triggers: [{ event: 'fishbowl/inventory.sync' }],
  },
  async ({ event, step }) => {
    const { fullSync } = event.data

    logger.log('info', 'P2_INVENTORY_SYNC', 'Starting manual inventory sync', {
      fullSync,
    })

    // TODO: Implement full manual sync logic (shares core logic with scheduled sync)

    return {
      success: false,
      message: 'P2 manual sync not yet implemented',
      fullSync,
    }
  }
)
