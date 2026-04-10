import { inngest } from '../client'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncIncremental } from '@/lib/salesforce/sync'
import { getDataSourceMode } from '@/lib/utils/app-settings'

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
    // Only run if data source mode is 'live'
    const mode = await step.run('check-mode', async () => {
      return getDataSourceMode()
    })

    if (mode !== 'live') {
      return { skipped: true, reason: 'Data source mode is not live' }
    }

    const sfClient = createSalesforceClient()
    const supabase = createAdminClient()

    await step.run('connect-sf', () => sfClient.connect())

    const totalRecords = await step.run('sync-incremental', async () => {
      return syncIncremental(sfClient, supabase)
    })

    await step.run('disconnect-sf', () => sfClient.disconnect())

    return { totalRecords }
  }
)
