import { inngest } from '../client'
import { logger } from '@/lib/utils/logger'
import { logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { bulkUpdateProductInventory } from '@/lib/salesforce/mutations'
import { createFishbowlClient } from '@/lib/fishbowl/client'
import { getAllInventory } from '@/lib/fishbowl/inventory'
import type { SFProductUpdate } from '@/lib/salesforce/types'
import { runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'

async function runInventorySync(triggeredBy: 'schedule' | 'manual', fullSync = false) {
  const startTime = Date.now()

  logger.log('info', 'P2_INVENTORY_SYNC', 'Starting inventory sync', {
    triggeredBy,
    fullSync,
  })

  const fbClient = createFishbowlClient()
  try {
    await runWithAuthCircuitBreaker(
      {
        system: 'fishbowl',
        automation: 'P2_INVENTORY_SYNC',
        sourceSystem: 'fishbowl',
        targetSystem: 'prometheus',
      },
      () => fbClient.authenticate()
    )

    const inventory = await getAllInventory(fbClient)
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

    const sfClient = createSalesforceClient()
    let updateResult: Awaited<ReturnType<typeof bulkUpdateProductInventory>>

    await runWithAuthCircuitBreaker(
      {
        system: 'salesforce',
        automation: 'P2_INVENTORY_SYNC',
        sourceSystem: 'prometheus',
        targetSystem: 'salesforce',
      },
      () => sfClient.connect()
    )

    try {
      const products: SFProductUpdate[] = inventory.map((item) => ({
        productCode: item.partNumber,
        qtyOnHand: parseFloat(item.quantity) || 0,
        qtyAvailable: parseFloat(item.quantity) || 0,
      }))

      updateResult = await bulkUpdateProductInventory(sfClient, products)
    } finally {
      await sfClient.disconnect()
    }

    await logSyncEvent({
      automation: 'P2_INVENTORY_SYNC',
      sourceSystem: 'fishbowl',
      targetSystem: 'salesforce',
      status: 'success',
      payload: { totalParts: inventory.length, triggeredBy, fullSync },
      response: updateResult as unknown as Record<string, unknown>,
    })

    await updateSyncSchedule('P2_INVENTORY_SYNC', {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'success',
      lastRunDurationMs: Date.now() - startTime,
      recordsProcessed: inventory.length,
    })

    await inngest.send({
      name: 'inventory/low-stock.check',
      data: { triggeredBy: 'P2_INVENTORY_SYNC' },
    })

    logger.log('info', 'P2_INVENTORY_SYNC', `Synced ${inventory.length} items`, {
      triggeredBy,
      sfUpdates: updateResult,
    })

    return { synced: inventory.length, sfUpdates: updateResult }
  } finally {
    await fbClient.logout()
  }
}

/**
 * P2: Fishbowl Inventory -> Salesforce Products
 *
 * Scheduled job that syncs inventory levels from Fishbowl to Salesforce.
 * Runs every 15 minutes.
 */
export const inventorySync = inngest.createFunction(
  {
    id: 'inventory-sync',
    name: 'P2: Inventory Sync (FB -> SF)',
    retries: 2,
    triggers: [{ cron: '*/15 * * * *' }],
  },
  async ({ step }) => {
    return step.run('run-inventory-sync', () => runInventorySync('schedule'))
  }
)

/**
 * Manual trigger for inventory sync.
 */
export const inventorySyncManual = inngest.createFunction(
  {
    id: 'inventory-sync-manual',
    name: 'P2: Inventory Sync (Manual)',
    retries: 2,
    triggers: [{ event: 'fishbowl/inventory.sync' }],
  },
  async ({ event, step }) => {
    return step.run('run-inventory-sync-manual', () =>
      runInventorySync('manual', Boolean(event.data.fullSync))
    )
  }
)
