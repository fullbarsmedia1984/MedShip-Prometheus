import { revalidateTag } from 'next/cache'
import { inngest } from '../client'
import { CACHE_TAGS } from '@/lib/cache-tags'
import { logger } from '@/lib/utils/logger'
import { logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { bulkUpdateProductInventory } from '@/lib/salesforce/mutations'
import { getAllInventory } from '@/lib/fishbowl/inventory'
import type { SFProductUpdate } from '@/lib/salesforce/types'
import { runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'
import {
  FishbowlPriorityYieldError,
  FishbowlSessionLockError,
  withFishbowlSession,
} from '@/lib/fishbowl/session'

async function isP2ScheduleActive() {
  const { data, error } = await createAdminClient()
    .from('sync_schedules')
    .select('is_active')
    .eq('automation', 'P2_INVENTORY_SYNC')
    .maybeSingle()

  if (error) {
    logger.log('warn', 'P2_INVENTORY_SYNC', 'Could not read sync schedule; allowing P2 run', {
      error: error.message,
    })
    return true
  }

  return data?.is_active !== false
}

async function runInventorySync(triggeredBy: 'schedule' | 'manual', fullSync = false) {
  const startTime = Date.now()

  logger.log('info', 'P2_INVENTORY_SYNC', 'Starting inventory sync', {
    triggeredBy,
    fullSync,
  })

  try {
    if (triggeredBy === 'schedule' && !(await isP2ScheduleActive())) {
      await logSyncEvent({
        automation: 'P2_INVENTORY_SYNC',
        sourceSystem: 'fishbowl',
        targetSystem: 'prometheus',
        status: 'dismissed',
        payload: { triggeredBy, fullSync },
        errorMessage: 'P2_INVENTORY_SYNC is disabled in sync_schedules',
      })

      await updateSyncSchedule('P2_INVENTORY_SYNC', {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: 'skipped',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: 0,
      })

      return {
        synced: 0,
        skipped: true,
        reason: 'P2_INVENTORY_SYNC is disabled in sync_schedules',
      }
    }

    const inventory = await withFishbowlSession(
      {
        automation: 'P2_INVENTORY_SYNC',
        sourceSystem: 'fishbowl',
        targetSystem: 'prometheus',
      },
      (fbClient) => getAllInventory(fbClient)
    )
    const supabase = createAdminClient()

    let upsertErrors = 0
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
        upsertErrors += 1
        console.error(`Supabase upsert error on chunk ${i}:`, error)
      }
    }

    // Fishbowl stops reporting a part once its quantity hits zero, so any row
    // this run did not touch is a stale leftover claiming phantom stock (e.g.
    // 14242-28 sat at "10 on hand" for six weeks). Remove drop-outs — but only
    // when every chunk upserted cleanly, so a partial failure can't wipe rows
    // that merely failed to refresh.
    if (upsertErrors === 0 && inventory.length > 0) {
      const { error: cleanupError, count: staleRemoved } = await supabase
        .from('inventory_snapshot')
        .delete({ count: 'exact' })
        .lt('last_synced_at', new Date(startTime).toISOString())

      if (cleanupError) {
        console.error('Stale inventory_snapshot cleanup failed:', cleanupError)
      } else if (staleRemoved) {
        logger.log('info', 'P2_INVENTORY_SYNC', `Removed ${staleRemoved} stale zero-stock rows`)
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

    // Bust every DAL cache built on inventory_snapshot so pages pick up the
    // new stock levels immediately. Best-effort: a revalidation hiccup must
    // never fail an otherwise successful sync.
    try {
      revalidateTag(CACHE_TAGS.inventory, { expire: 0 })
      revalidateTag(CACHE_TAGS.wallboard, { expire: 0 })
      revalidateTag(CACHE_TAGS.kits, { expire: 0 })
      revalidateTag(CACHE_TAGS.pricingReadiness, { expire: 0 })
    } catch (revalidateError) {
      logger.log('warn', 'P2_INVENTORY_SYNC', 'Cache revalidation failed (non-fatal)', {
        error: revalidateError instanceof Error ? revalidateError.message : String(revalidateError),
      })
    }

    await inngest.send({
      name: 'inventory/low-stock.check',
      data: { triggeredBy: 'P2_INVENTORY_SYNC' },
    })

    logger.log('info', 'P2_INVENTORY_SYNC', `Synced ${inventory.length} items`, {
      triggeredBy,
      sfUpdates: updateResult,
    })

    return { synced: inventory.length, sfUpdates: updateResult }
  } catch (error) {
    if (error instanceof FishbowlSessionLockError || error instanceof FishbowlPriorityYieldError) {
      await logSyncEvent({
        automation: 'P2_INVENTORY_SYNC',
        sourceSystem: 'fishbowl',
        targetSystem: 'prometheus',
        status: 'dismissed',
        payload: { triggeredBy, fullSync },
        errorMessage: error.message,
      })

      await updateSyncSchedule('P2_INVENTORY_SYNC', {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: 'skipped',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: 0,
      })

      return { synced: 0, skipped: true, reason: error.message }
    }

    throw error
  }
}

/**
 * P2: Fishbowl Inventory -> Salesforce Products
 *
 * Scheduled job that syncs inventory levels from Fishbowl to Salesforce.
 * Runs 8am, 12pm, and 4pm Monday-Friday (America/Chicago) per ops.
 */
export const inventorySync = inngest.createFunction(
  {
    id: 'inventory-sync',
    name: 'P2: Inventory Sync (FB -> SF)',
    retries: 2,
    triggers: [{ cron: 'TZ=America/Chicago 0 8,12,16 * * 1-5' }],
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
