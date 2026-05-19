import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getIntegrationStatus, getConnectionConfigs } from '@/lib/data'
import { createAdminClient } from '@/lib/supabase/admin'

type RelationshipHealth = {
  salesOrders: number
  lineItems: number
  linkedSalesOrders: number
  unlinkedSalesOrders: number
  opportunityLinks: number
  opportunitiesWithSoNumber: number
}

type SupabaseCountQuery = PromiseLike<{
  count: number | null
  error: Error | null
}>

function isMissingRelationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('42p01') || message.includes('could not find the table') || message.includes('does not exist')
}

async function safeCount(
  table: string,
  build?: (query: unknown) => SupabaseCountQuery
): Promise<number> {
  const supabase = createAdminClient()
  const baseQuery = supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
  const query = build ? build(baseQuery) : baseQuery
  const { count, error } = await query

  if (error) {
    if (isMissingRelationError(error)) return 0
    throw error
  }

  return count ?? 0
}

async function getRelationshipHealth(): Promise<RelationshipHealth> {
  const [
    salesOrders,
    lineItems,
    linkedSalesOrders,
    opportunityLinks,
    opportunitiesWithSoNumber,
  ] = await Promise.all([
    safeCount('fb_sales_orders'),
    safeCount('fb_sales_order_items'),
    safeCount('fb_sales_orders', (query) =>
      (query as { not(column: string, operator: string, value: unknown): SupabaseCountQuery })
        .not('sf_opportunity_id', 'is', null)
    ),
    safeCount('opportunity_sales_order_links'),
    safeCount('sf_opportunities', (query) =>
      (query as { not(column: string, operator: string, value: unknown): SupabaseCountQuery })
        .not('fishbowl_so_number', 'is', null)
    ),
  ])

  return {
    salesOrders,
    lineItems,
    linkedSalesOrders,
    unlinkedSalesOrders: Math.max(salesOrders - linkedSalesOrders, 0),
    opportunityLinks,
    opportunitiesWithSoNumber,
  }
}

export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const [integrations, connections, relationshipHealth] = await Promise.all([
      getIntegrationStatus(),
      getConnectionConfigs(),
      getRelationshipHealth(),
    ])

    return NextResponse.json({ integrations, connections, relationshipHealth })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
