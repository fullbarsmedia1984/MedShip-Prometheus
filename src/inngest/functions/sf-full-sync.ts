import { inngest } from '../client'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  syncUsers,
  syncAccounts,
  syncProducts,
  syncOpportunities,
  syncOpportunityLineItems,
  syncProfileCalls,
} from '@/lib/salesforce/sync'

/**
 * Full Salesforce → Supabase cache sync.
 * Triggered manually via event: medship/sf.full-sync
 * Syncs in dependency order: users → accounts → products → opportunities → line items → calls
 */
export const sfFullSync = inngest.createFunction(
  {
    id: 'sf-full-sync',
    name: 'Salesforce Full Sync',
    concurrency: [{ limit: 1 }],
    triggers: [{ event: 'medship/sf.full-sync' }],
  },
  async ({ step }) => {
    const sfClient = createSalesforceClient()
    const supabase = createAdminClient()

    await step.run('connect-sf', () => sfClient.connect())

    const usersCount = await step.run('sync-users', async () => {
      return syncUsers(sfClient, supabase)
    })

    const accountsCount = await step.run('sync-accounts', async () => {
      return syncAccounts(sfClient, supabase)
    })

    const productsCount = await step.run('sync-products', async () => {
      return syncProducts(sfClient, supabase)
    })

    const oppsCount = await step.run('sync-opportunities', async () => {
      return syncOpportunities(sfClient, supabase)
    })

    const lineItemsCount = await step.run('sync-line-items', async () => {
      return syncOpportunityLineItems(sfClient, supabase)
    })

    const callsCount = await step.run('sync-profile-calls', async () => {
      return syncProfileCalls(sfClient, supabase)
    })

    await step.run('disconnect-sf', () => sfClient.disconnect())

    return {
      users: usersCount,
      accounts: accountsCount,
      products: productsCount,
      opportunities: oppsCount,
      lineItems: lineItemsCount,
      profileCalls: callsCount,
      totalRecords: usersCount + accountsCount + productsCount + oppsCount + lineItemsCount + callsCount,
    }
  }
)
