import { inngest } from '../client'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncIncremental } from '@/lib/salesforce/sync'
import { getDataSourceMode } from '@/lib/utils/app-settings'
import { updateSyncSchedule } from '@/lib/utils/logger'

/**
 * Incremental Salesforce → Supabase cache sync.
 * Runs every 15 minutes. Only queries records modified since the last sync.
 * Skips if data source mode is 'seed'.
 */
export const sfIncrementalSync = inngest.createFunction(
  {
    id: 'sf-incremental-sync',
    name: 'Salesforce Incremental Sync',
    triggers: [{ cron: '*/15 * * * *' }],
  },
  async ({ step }) => {
    const startTime = Date.now()

    // Only run if data source mode is 'live'
    const mode = await step.run('check-mode', async () => {
      return getDataSourceMode()
    })

    if (mode !== 'live') {
      await step.run('update-schedule-skipped', () =>
        updateSyncSchedule('SF_INCREMENTAL_SYNC', {
          lastRunAt: new Date().toISOString(),
          lastRunStatus: 'skipped',
          lastRunDurationMs: Date.now() - startTime,
          recordsProcessed: 0,
        })
      )

      return { skipped: true, reason: 'Data source mode is not live' }
    }

    const sfClient = createSalesforceClient()
    const supabase = createAdminClient()

    await step.run('connect-sf', () => sfClient.connect())

    const totalRecords = await step.run('sync-incremental', async () => {
      return syncIncremental(sfClient, supabase)
    })

    await step.run('disconnect-sf', () => sfClient.disconnect())

    await step.run('update-schedule', () =>
      updateSyncSchedule('SF_INCREMENTAL_SYNC', {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: 'success',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: totalRecords,
      })
    )

    return { totalRecords }
  }
)
