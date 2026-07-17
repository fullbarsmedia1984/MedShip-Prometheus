import { inngest } from '../client'
import {
  FishbowlPriorityYieldError,
  FishbowlSessionLockError,
  withFishbowlSession,
} from '@/lib/fishbowl/session'
import { syncProductParts } from '@/lib/inventory/product-parts-sync'

// One Fishbowl session per run, logged out in the session helper's finally.
// Skips quietly when another automation holds the session lock; the catalog
// moves slowly, so the next daily tick catches up.
async function runProductPartsSync() {
  try {
    return await withFishbowlSession(
      { automation: 'P15_PRODUCT_PARTS_SYNC', sourceSystem: 'fishbowl', targetSystem: 'prometheus' },
      async (client) => ({ products: await syncProductParts(client), skipped: false })
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

/**
 * P15: Fishbowl product -> part mapping (FB -> Supabase)
 *
 * Bridges the two SKU namespaces: sales-order lines carry PRODUCT numbers,
 * inventory and purchase orders carry PART numbers. The inventory analytics
 * (and any demand-vs-stock join) depend on this. ~44k rows, daily refresh
 * before the first P2/P11 runs of the day.
 */
export const productPartsSync = inngest.createFunction(
  {
    id: 'product-parts-sync',
    name: 'P15: Product-Part Mapping (FB -> Supabase)',
    retries: 2,
    triggers: [{ cron: 'TZ=America/Chicago 30 6 * * 1-5' }],
  },
  async ({ step }) => {
    return step.run('run-product-parts-sync', () => runProductPartsSync())
  }
)

/**
 * Manual trigger for the product-part mapping sync.
 */
export const productPartsSyncManual = inngest.createFunction(
  {
    id: 'product-parts-sync-manual',
    name: 'P15: Product-Part Mapping (Manual)',
    retries: 2,
    triggers: [{ event: 'fishbowl/product-parts.sync' }],
  },
  async ({ step }) => {
    return step.run('run-product-parts-sync-manual', () => runProductPartsSync())
  }
)
