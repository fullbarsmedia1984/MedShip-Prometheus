import { revalidateTag } from 'next/cache'
import { inngest } from '../client'
import { CACHE_TAGS } from '@/lib/cache-tags'
import {
  FishbowlPriorityYieldError,
  FishbowlSessionLockError,
  withFishbowlSession,
} from '@/lib/fishbowl/session'
import { syncRecentShipments } from '@/lib/warehouse-board/shipments-sync'

// One Fishbowl session per run, logged out in the session helper's finally —
// an unclosed session holds a license seat until Fishbowl's server-side
// timeout. Skips quietly when another automation holds the session lock;
// the next 15-minute tick catches up.
async function runShipmentsSync() {
  try {
    const result = await withFishbowlSession(
      { automation: 'P12_SHIPMENTS_SYNC', sourceSystem: 'fishbowl', targetSystem: 'prometheus' },
      async (client) => ({ shipments: await syncRecentShipments(client), skipped: false })
    )

    // Fresh shipments flip orders to Shipped on the wallboard and mark kits
    // shipped on the workbench — bust both caches. Best-effort: a
    // revalidation hiccup must never fail an otherwise successful sync.
    try {
      revalidateTag(CACHE_TAGS.wallboard, { expire: 0 })
      revalidateTag(CACHE_TAGS.kits, { expire: 0 })
    } catch (revalidateError) {
      console.warn('P12_SHIPMENTS_SYNC: cache revalidation failed (non-fatal)', revalidateError)
    }

    return result
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
    return step.run('run-shipments-sync', () => runShipmentsSync())
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
    return step.run('run-shipments-sync-manual', () => runShipmentsSync())
  }
)
