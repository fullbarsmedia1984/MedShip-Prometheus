// =============================================================================
// Data Access Layer
// Routes queries to seed data or Supabase cache based on app_settings mode.
// =============================================================================

import {
  seedProducts,
  seedCustomers,
  seedOrders,
  seedMonthlyRevenue,
  seedCategorySales,
  seedSyncEvents,
  seedIntegrationStatus,
  seedFieldMappings,
  seedConnectionConfigs,
  seedSalesReps,
  seedEnhancedSalesReps,
  seedPipelineStages,
  seedSalesActivities,
  seedQuotes,
  seedMonthlyRepRevenue,
  seedPipelineByRep,
  seedRegionSummaries,
  seedProfileCalls,
  seedWeeklyCallVolume,
} from '@/lib/seed-data'
import type {
  Product,
  Customer,
  Order,
  MonthlyRevenue,
  CategorySales,
  IntegrationStatusData,
  SalesRep,
  SeedSalesRep,
  SeedPipelineStage,
  SeedSalesActivity,
  SeedQuote,
  SeedMonthlyRepRevenue,
  SeedPipelineByRep,
  SeedRegionSummary,
  SeedProfileCall,
  SeedWeeklyCallVolume,
} from '@/lib/seed-data'
import type { SyncEvent, FieldMapping, ConnectionConfig, AutomationType } from '@/types'
import { getDataSourceMode } from '@/lib/utils/app-settings'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Filter / pagination types
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface OrderFilters {
  status?: string
  salesRepId?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

export interface InventoryFilters {
  category?: string
  stockStatus?: 'all' | 'in_stock' | 'low' | 'out_of_stock'
  search?: string
  page?: number
  pageSize?: number
}

export interface EventFilters {
  automation?: string
  status?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function paginate<T>(items: T[], page = 1, pageSize = 20): PaginatedResult<T> {
  const total = items.length
  const totalPages = Math.ceil(total / pageSize)
  const start = (page - 1) * pageSize
  return {
    data: items.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  }
}

/**
 * Try live data first; if it returns empty, fall back to seed.
 * Protects against toggling to live mode before any sync has run.
 */
async function liveOrSeed<T>(
  liveFn: () => Promise<T[]>,
  seedFn: () => T[]
): Promise<T[]> {
  try {
    const result = await liveFn()
    if (result.length === 0) {
      console.warn('Live data returned empty, falling back to seed')
      return seedFn()
    }
    return result
  } catch (error) {
    console.error('Live data query failed, falling back to seed:', error)
    return seedFn()
  }
}

// ---------------------------------------------------------------------------
// Revenue & KPIs
// ---------------------------------------------------------------------------

export interface RevenueMetrics {
  mtdRevenue: number
  mtdRevenueChange: number
  openOrders: number
  openOrdersChange: number
  fulfillmentRate: number
  fulfillmentRateChange: number
  avgShipDays: number
  avgShipDaysChange: number
}

export async function getRevenueMetrics(): Promise<RevenueMetrics> {
  const mode = await getDataSourceMode()
  if (mode === 'live') return getLiveRevenueMetrics()
  return getSeedRevenueMetrics()
}

function getSeedRevenueMetrics(): RevenueMetrics {
  const currentMonth = seedMonthlyRevenue[seedMonthlyRevenue.length - 1]
  const prevMonth = seedMonthlyRevenue[seedMonthlyRevenue.length - 2]

  const mtdRevenue = currentMonth.revenue
  const mtdRevenueChange = prevMonth.revenue > 0
    ? Math.round(((mtdRevenue - prevMonth.revenue) / prevMonth.revenue) * 1000) / 10
    : 0

  const openOrders = seedOrders.filter(
    (o) => o.status === 'Pending' || o.status === 'Closed Won'
  ).length
  const prevMonthOpenOrders = 18
  const openOrdersChange = Math.round(((openOrders - prevMonthOpenOrders) / prevMonthOpenOrders) * 1000) / 10

  const shippedOrDelivered = seedOrders.filter(
    (o) => o.status === 'Shipped' || o.status === 'Delivered'
  )
  const total = seedOrders.filter((o) => o.status !== 'Cancelled').length
  const fulfillmentRate = Math.round((shippedOrDelivered.length / total) * 1000) / 10

  return {
    mtdRevenue,
    mtdRevenueChange,
    openOrders,
    openOrdersChange,
    fulfillmentRate,
    fulfillmentRateChange: 2.3,
    avgShipDays: 2.8,
    avgShipDaysChange: -0.4,
  }
}

async function getLiveRevenueMetrics(): Promise<RevenueMetrics> {
  const supabase = createAdminClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]

  // MTD revenue: sum of closed-won amounts this month
  const { data: mtdOpps } = await supabase
    .from('sf_opportunities')
    .select('amount')
    .eq('is_won', true)
    .gte('close_date', monthStart)

  const mtdRevenue = (mtdOpps ?? []).reduce((s, o) => s + (Number(o.amount) || 0), 0)

  // Last month revenue
  const { data: lastMonthOpps } = await supabase
    .from('sf_opportunities')
    .select('amount')
    .eq('is_won', true)
    .gte('close_date', lastMonthStart)
    .lt('close_date', monthStart)

  const lastMonthRevenue = (lastMonthOpps ?? []).reduce((s, o) => s + (Number(o.amount) || 0), 0)

  const mtdRevenueChange = lastMonthRevenue > 0
    ? Math.round(((mtdRevenue - lastMonthRevenue) / lastMonthRevenue) * 1000) / 10
    : 0

  // Open orders
  const { count: openOrders } = await supabase
    .from('sf_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('is_closed', false)

  // Fulfillment
  const { count: totalOrders } = await supabase
    .from('sf_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('is_won', true)

  const { count: fulfilled } = await supabase
    .from('sf_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('is_won', true)
    .not('fishbowl_so_number', 'is', null)

  const fulfillmentRate = (totalOrders ?? 0) > 0
    ? Math.round(((fulfilled ?? 0) / (totalOrders ?? 1)) * 1000) / 10
    : 0

  return {
    mtdRevenue,
    mtdRevenueChange,
    openOrders: openOrders ?? 0,
    openOrdersChange: 0,
    fulfillmentRate,
    fulfillmentRateChange: 0,
    avgShipDays: 0,
    avgShipDaysChange: 0,
  }
}

// ---------------------------------------------------------------------------
// Monthly Revenue
// ---------------------------------------------------------------------------

export async function getMonthlyRevenue(): Promise<MonthlyRevenue[]> {
  // Live data: would need to aggregate sf_opportunities by month
  // For now, seed data is sufficient — real monthly aggregation is a Phase 2 RPC function
  return seedMonthlyRevenue
}

// ---------------------------------------------------------------------------
// Category Sales
// ---------------------------------------------------------------------------

export async function getCategorySales(): Promise<CategorySales[]> {
  return seedCategorySales
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function getOrders(filters: OrderFilters = {}): Promise<PaginatedResult<Order>> {
  // Live data: sf_opportunities joined with sf_accounts
  // For now, route to seed (order data shape is different from sf_opportunities)
  let items = [...seedOrders]

  if (filters.status && filters.status !== 'all') {
    items = items.filter((o) => o.status === filters.status)
  }
  if (filters.salesRepId && filters.salesRepId !== 'all') {
    items = items.filter((o) => o.salesRepId === filters.salesRepId)
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    items = items.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q)
    )
  }
  if (filters.dateFrom) {
    items = items.filter((o) => o.date >= filters.dateFrom!)
  }
  if (filters.dateTo) {
    items = items.filter((o) => o.date <= filters.dateTo!)
  }

  items.sort((a, b) => b.date.localeCompare(a.date))
  return paginate(items, filters.page, filters.pageSize)
}

export async function getRecentOrders(limit = 10): Promise<Order[]> {
  return [...seedOrders]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}

export async function getSalesReps(): Promise<SalesRep[]> {
  return seedSalesReps
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export async function getInventory(filters: InventoryFilters = {}): Promise<PaginatedResult<Product>> {
  let items = [...seedProducts]

  if (filters.category && filters.category !== 'all') {
    items = items.filter((p) => p.category === filters.category)
  }
  if (filters.stockStatus && filters.stockStatus !== 'all') {
    if (filters.stockStatus === 'out_of_stock') {
      items = items.filter((p) => p.qtyAvailable <= 0)
    } else if (filters.stockStatus === 'low') {
      items = items.filter((p) => p.qtyAvailable > 0 && p.qtyAvailable <= p.reorderPoint)
    } else if (filters.stockStatus === 'in_stock') {
      items = items.filter((p) => p.qtyAvailable > p.reorderPoint)
    }
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    items = items.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    )
  }

  return paginate(items, filters.page, filters.pageSize)
}

export interface InventoryKpis {
  totalSkus: number
  inStock: number
  lowStock: number
  outOfStock: number
}

export async function getInventoryKpis(): Promise<InventoryKpis> {
  const products = seedProducts
  return {
    totalSkus: products.length,
    inStock: products.filter((p) => p.qtyAvailable > p.reorderPoint).length,
    lowStock: products.filter((p) => p.qtyAvailable > 0 && p.qtyAvailable <= p.reorderPoint).length,
    outOfStock: products.filter((p) => p.qtyAvailable <= 0).length,
  }
}

export async function getInventoryAlerts(limit = 5): Promise<Product[]> {
  return seedProducts
    .filter((p) => p.qtyAvailable <= p.reorderPoint)
    .sort((a, b) => a.qtyAvailable - b.qtyAvailable)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Sync Events
// ---------------------------------------------------------------------------

export async function getSyncEvents(filters: EventFilters = {}): Promise<PaginatedResult<SyncEvent>> {
  let items = [...seedSyncEvents]

  if (filters.automation && filters.automation !== 'all') {
    items = items.filter((e) => e.automation === filters.automation)
  }
  if (filters.status && filters.status !== 'all') {
    items = items.filter((e) => e.status === filters.status)
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    items = items.filter(
      (e) =>
        e.source_record_id?.toLowerCase().includes(q) ||
        e.target_record_id?.toLowerCase().includes(q) ||
        e.error_message?.toLowerCase().includes(q)
    )
  }

  return paginate(items, filters.page, filters.pageSize || 25)
}

export interface EventKpis {
  total: number
  successRate: number
  avgDurationMs: number
  failuresToday: number
}

export async function getEventKpis(): Promise<EventKpis> {
  const events = seedSyncEvents
  const total = events.length
  const successes = events.filter((e) => e.status === 'success').length
  const successRate = total > 0 ? Math.round((successes / total) * 1000) / 10 : 0

  const completed = events.filter((e) => e.completed_at)
  const totalDuration = completed.reduce((sum, e) => {
    const dur = new Date(e.completed_at!).getTime() - new Date(e.created_at).getTime()
    return sum + dur
  }, 0)
  const avgDurationMs = completed.length > 0 ? Math.round(totalDuration / completed.length) : 0

  const today = '2026-03-31'
  const failuresToday = events.filter(
    (e) => e.status === 'failed' && e.created_at.startsWith(today)
  ).length

  return { total, successRate, avgDurationMs, failuresToday }
}

// ---------------------------------------------------------------------------
// Failed Syncs
// ---------------------------------------------------------------------------

export async function getFailedSyncs(): Promise<SyncEvent[]> {
  return seedSyncEvents.filter(
    (e) => e.status === 'failed' || e.status === 'retrying'
  )
}

// ---------------------------------------------------------------------------
// Integration Status
// ---------------------------------------------------------------------------

export async function getIntegrationStatus(): Promise<IntegrationStatusData[]> {
  return seedIntegrationStatus
}

// ---------------------------------------------------------------------------
// Field Mappings
// ---------------------------------------------------------------------------

export async function getFieldMappings(automation?: string): Promise<FieldMapping[]> {
  if (automation && automation !== 'all') {
    return seedFieldMappings.filter((m) => m.automation === automation)
  }
  return seedFieldMappings
}

// ---------------------------------------------------------------------------
// Connection Configs
// ---------------------------------------------------------------------------

export async function getConnectionConfigs(): Promise<ConnectionConfig[]> {
  return seedConnectionConfigs
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function getCustomers(): Promise<Customer[]> {
  return seedCustomers
}

// ---------------------------------------------------------------------------
// Sales Analytics
// ---------------------------------------------------------------------------

export async function getSalesLeaderboard(): Promise<SeedSalesRep[]> {
  const mode = await getDataSourceMode()
  if (mode === 'live') {
    const liveReps = await getLiveSalesReps()
    if (liveReps.length > 0) return liveReps.sort((a, b) => b.revenueMTD - a.revenueMTD)
  }
  return [...seedEnhancedSalesReps].sort((a, b) => b.revenueMTD - a.revenueMTD)
}

export async function getEnhancedSalesReps(): Promise<SeedSalesRep[]> {
  const mode = await getDataSourceMode()
  if (mode === 'live') {
    const liveReps = await getLiveSalesReps()
    if (liveReps.length > 0) return liveReps
  }
  return seedEnhancedSalesReps
}

/**
 * Build SeedSalesRep-shaped objects from live Supabase data.
 * Known limitation: rep colors are generated deterministically from sf_id.
 */
async function getLiveSalesReps(): Promise<SeedSalesRep[]> {
  const supabase = createAdminClient()
  const { data: users } = await supabase
    .from('sf_users')
    .select('*')
    .eq('is_active', true)

  if (!users || users.length === 0) return []

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const qtrStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().split('T')[0]
  const yearStart = `${now.getFullYear()}-01-01`
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]

  // Deterministic color from sf_id hash
  const COLORS = ['#1E98D5', '#0FA62C', '#1C3C6E', '#A0007E', '#E89C0C', '#D93025', '#B5C8CD', '#3AACE3']
  function colorFromId(sfId: string): string {
    let hash = 0
    for (let i = 0; i < sfId.length; i++) hash = ((hash << 5) - hash + sfId.charCodeAt(i)) | 0
    return COLORS[Math.abs(hash) % COLORS.length]
  }

  const reps: SeedSalesRep[] = await Promise.all(users.map(async (user) => {
    const sfId = user.sf_id

    // Revenue by period
    const [mtdRes, qtdRes, ytdRes, lastMRes] = await Promise.all([
      supabase.from('sf_opportunities').select('amount').eq('owner_sf_id', sfId).eq('is_won', true).gte('close_date', monthStart),
      supabase.from('sf_opportunities').select('amount').eq('owner_sf_id', sfId).eq('is_won', true).gte('close_date', qtrStart),
      supabase.from('sf_opportunities').select('amount').eq('owner_sf_id', sfId).eq('is_won', true).gte('close_date', yearStart),
      supabase.from('sf_opportunities').select('amount').eq('owner_sf_id', sfId).eq('is_won', true).gte('close_date', lastMonthStart).lt('close_date', monthStart),
    ])

    const sum = (rows: any[] | null) => (rows ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0)
    const revenueMTD = sum(mtdRes.data)
    const revenueQTD = sum(qtdRes.data)
    const revenueYTD = sum(ytdRes.data)

    const dealsClosed = mtdRes.data?.length ?? 0

    // Deals lost this month
    const { count: dealsLost } = await supabase
      .from('sf_opportunities')
      .select('*', { count: 'exact', head: true })
      .eq('owner_sf_id', sfId)
      .eq('is_closed', true)
      .eq('is_won', false)
      .gte('close_date', monthStart)

    // Pipeline
    const { data: pipelineOpps } = await supabase
      .from('sf_opportunities')
      .select('amount')
      .eq('owner_sf_id', sfId)
      .eq('is_closed', false)
    const pipelineValue = sum(pipelineOpps)

    // Win rate
    const { count: totalClosed } = await supabase
      .from('sf_opportunities')
      .select('*', { count: 'exact', head: true })
      .eq('owner_sf_id', sfId)
      .eq('is_closed', true)
      .gte('close_date', monthStart)
    const winRate = (totalClosed ?? 0) > 0 ? Math.round((dealsClosed / (totalClosed ?? 1)) * 1000) / 10 : 0

    // Profile calls this month
    const { count: profileCallsMTD } = await supabase
      .from('sf_profile_calls')
      .select('*', { count: 'exact', head: true })
      .eq('owner_sf_id', sfId)
      .gte('activity_date', monthStart)

    const { count: profileCallsLastMonth } = await supabase
      .from('sf_profile_calls')
      .select('*', { count: 'exact', head: true })
      .eq('owner_sf_id', sfId)
      .gte('activity_date', lastMonthStart)
      .lt('activity_date', monthStart)

    const profileCalls = profileCallsMTD ?? 0
    const lastMonthCalls = profileCallsLastMonth ?? 0
    const profileCallsChange = lastMonthCalls > 0
      ? Math.round(((profileCalls - lastMonthCalls) / lastMonthCalls) * 1000) / 10
      : 0

    // Connect rate
    const { count: connectedCalls } = await supabase
      .from('sf_profile_calls')
      .select('*', { count: 'exact', head: true })
      .eq('owner_sf_id', sfId)
      .eq('ringdna_connected', true)
      .gte('activity_date', monthStart)
    const connectRate = profileCalls > 0 ? Math.round(((connectedCalls ?? 0) / profileCalls) * 1000) / 10 : 0

    // Avg deal size
    const avgDealSize = dealsClosed > 0 ? Math.round(revenueMTD / dealsClosed) : 0

    // Activity score
    let activityScore: SeedSalesRep['activityScore'] = 'cold'
    if (profileCalls >= 20 || dealsClosed >= 10) activityScore = 'hot'
    else if (profileCalls >= 10 || dealsClosed >= 5) activityScore = 'active'
    else if (profileCalls >= 5 || dealsClosed >= 2) activityScore = 'slow'

    return {
      id: sfId,
      name: user.name,
      email: user.email ?? '',
      region: '', // SF users don't have region — would need a custom field
      color: colorFromId(sfId),
      revenueMTD,
      revenueQTD,
      revenueYTD,
      dealsClosed,
      dealsLost: dealsLost ?? 0,
      quotesSent: 0, // Quotes not tracked in SF cache yet
      profileCalls,
      profileCallsChange,
      connectRate,
      avgDealSize,
      avgDaysToClose: 0, // Would need to compute from CreatedDate to CloseDate
      pipelineValue,
      winRate,
      activityScore,
    }
  }))

  return reps.sort((a, b) => b.revenueMTD - a.revenueMTD)
}

export async function getPipelineSnapshot(): Promise<SeedPipelineStage[]> {
  const mode = await getDataSourceMode()
  if (mode === 'live') {
    const supabase = createAdminClient()
    const { data: opps } = await supabase
      .from('sf_opportunities')
      .select('stage_name, amount')
      .eq('is_closed', false)

    if (opps && opps.length > 0) {
      const stageColors: Record<string, string> = {
        'Prospecting': '#93C5FD', 'Qualification': '#60A5FA', 'Proposal': '#3B82F6',
        'Negotiation': '#1E98D5', 'Closed Won': '#0FA62C', 'Closed Lost': '#D93025',
      }
      const byStage = new Map<string, { count: number; value: number }>()
      for (const o of opps) {
        const s = o.stage_name ?? 'Unknown'
        const existing = byStage.get(s) ?? { count: 0, value: 0 }
        existing.count++
        existing.value += Number(o.amount) || 0
        byStage.set(s, existing)
      }
      return Array.from(byStage.entries()).map(([stage, data]) => ({
        stage,
        count: data.count,
        value: Math.round(data.value),
        color: stageColors[stage] ?? '#94A3B8',
      }))
    }
  }
  return seedPipelineStages
}

export async function getSalesActivity(limit = 10): Promise<SeedSalesActivity[]> {
  return [...seedSalesActivities]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
}

export interface QuoteFilters {
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export async function getQuotes(filters: QuoteFilters = {}): Promise<PaginatedResult<SeedQuote>> {
  let items = [...seedQuotes]

  if (filters.status && filters.status !== 'all') {
    items = items.filter((q) => q.status === filters.status)
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    items = items.filter(
      (quote) =>
        quote.repName.toLowerCase().includes(q) ||
        quote.customerName.toLowerCase().includes(q)
    )
  }

  items.sort((a, b) => b.date.localeCompare(a.date))
  return paginate(items, filters.page, filters.pageSize)
}

export async function getMonthlyRepRevenue(): Promise<SeedMonthlyRepRevenue[]> {
  return seedMonthlyRepRevenue
}

export async function getPipelineByRep(): Promise<SeedPipelineByRep[]> {
  return seedPipelineByRep
}

export interface SalesKpis {
  revenueMTD: number
  revenueQTD: number
  revenueYTD: number
  quotesSentMTD: number
  dealsClosedMTD: number
  avgDaysToClose: number
  pipelineValue: number
}

export async function getSalesKpis(): Promise<SalesKpis> {
  const mode = await getDataSourceMode()
  if (mode === 'live') {
    const reps = await getLiveSalesReps()
    if (reps.length > 0) {
      return {
        revenueMTD: reps.reduce((s, r) => s + r.revenueMTD, 0),
        revenueQTD: reps.reduce((s, r) => s + r.revenueQTD, 0),
        revenueYTD: reps.reduce((s, r) => s + r.revenueYTD, 0),
        quotesSentMTD: reps.reduce((s, r) => s + r.quotesSent, 0),
        dealsClosedMTD: reps.reduce((s, r) => s + r.dealsClosed, 0),
        avgDaysToClose: reps.length > 0 ? Math.round(reps.reduce((s, r) => s + r.avgDaysToClose, 0) / reps.length) : 0,
        pipelineValue: reps.reduce((s, r) => s + r.pipelineValue, 0),
      }
    }
  }
  const reps = seedEnhancedSalesReps
  return {
    revenueMTD: reps.reduce((s, r) => s + r.revenueMTD, 0),
    revenueQTD: reps.reduce((s, r) => s + r.revenueQTD, 0),
    revenueYTD: reps.reduce((s, r) => s + r.revenueYTD, 0),
    quotesSentMTD: reps.reduce((s, r) => s + r.quotesSent, 0),
    dealsClosedMTD: reps.reduce((s, r) => s + r.dealsClosed, 0),
    avgDaysToClose: Math.round(reps.reduce((s, r) => s + r.avgDaysToClose, 0) / reps.length),
    pipelineValue: reps.reduce((s, r) => s + r.pipelineValue, 0),
  }
}

// ---------------------------------------------------------------------------
// Territory / Geographic
// ---------------------------------------------------------------------------

export async function getCustomersWithLocations(): Promise<Customer[]> {
  // Known limitation: live SF accounts don't have lat/lng.
  // Geocoding is a Phase 2 enhancement.
  return seedCustomers
}

export async function getRegionSummaries(): Promise<SeedRegionSummary[]> {
  return seedRegionSummaries
}

export async function getCustomersByRegion(region: string): Promise<Customer[]> {
  return seedCustomers.filter((c) => c.region === region)
}

export interface ClientMapStats {
  totalClients: number
  activeClients: number
  statesCovered: number
  avgRevenuePerClient: number
}

export async function getClientMapStats(): Promise<ClientMapStats> {
  const customers = seedCustomers
  const active = customers.filter((c) => c.customerStatus === 'active')
  const states = new Set(customers.map((c) => c.state))
  const totalRevenue = active.reduce((s, c) => s + c.totalRevenue, 0)
  return {
    totalClients: customers.length,
    activeClients: active.length,
    statesCovered: states.size,
    avgRevenuePerClient: active.length > 0 ? Math.round(totalRevenue / active.length) : 0,
  }
}

// ---------------------------------------------------------------------------
// Profile Calls
// ---------------------------------------------------------------------------

export interface ProfileCallFilters {
  repId?: string
  startDate?: string
  endDate?: string
  outcome?: string
  convertedOnly?: boolean
  activityType?: 'Task' | 'Event' | 'all'
  keyword?: string
  search?: string
  limit?: number
  page?: number
  pageSize?: number
}

export async function getProfileCalls(filters: ProfileCallFilters = {}): Promise<PaginatedResult<SeedProfileCall>> {
  const mode = await getDataSourceMode()
  if (mode === 'live') {
    const liveCalls = await getLiveProfileCalls(filters)
    if (liveCalls.total > 0) return liveCalls
  }
  return getSeedProfileCalls(filters)
}

function getSeedProfileCalls(filters: ProfileCallFilters): PaginatedResult<SeedProfileCall> {
  let items = [...seedProfileCalls]

  if (filters.repId && filters.repId !== 'all') {
    items = items.filter((c) => c.repId === filters.repId)
  }
  if (filters.startDate) {
    items = items.filter((c) => c.activityDate >= filters.startDate!)
  }
  if (filters.endDate) {
    items = items.filter((c) => c.activityDate <= filters.endDate!)
  }
  if (filters.outcome && filters.outcome !== 'all') {
    items = items.filter((c) => c.profileCallOutcome === filters.outcome)
  }
  if (filters.convertedOnly) {
    items = items.filter((c) => c.convertedToOpp)
  }
  if (filters.activityType && filters.activityType !== 'all') {
    items = items.filter((c) => c.activityType === filters.activityType)
  }
  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase()
    items = items.filter(
      (c) =>
        c.ringdnaKeywords?.toLowerCase().includes(kw) ||
        c.subject.toLowerCase().includes(kw) ||
        c.callNotesSummary.toLowerCase().includes(kw) ||
        c.competitorIntel?.toLowerCase().includes(kw)
    )
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    items = items.filter(
      (c) =>
        c.accountName.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        c.callNotesSummary.toLowerCase().includes(q) ||
        c.competitorIntel?.toLowerCase().includes(q) ||
        c.ringdnaKeywords?.toLowerCase().includes(q)
    )
  }

  items.sort((a, b) => b.activityDate.localeCompare(a.activityDate))
  return paginate(items, filters.page, filters.pageSize)
}

async function getLiveProfileCalls(filters: ProfileCallFilters): Promise<PaginatedResult<SeedProfileCall>> {
  const supabase = createAdminClient()
  let query = supabase
    .from('sf_profile_calls')
    .select('*, sf_accounts!sf_profile_calls_account_sf_id_fkey(name), sf_users!sf_profile_calls_owner_sf_id_fkey(name)')
    .order('activity_date', { ascending: false })

  // Note: Supabase joins may not work without foreign keys defined.
  // Fallback: just query sf_profile_calls and resolve names separately.
  // For robustness, use a simpler query.
  const { data: calls } = await supabase
    .from('sf_profile_calls')
    .select('*')
    .order('activity_date', { ascending: false })
    .limit(filters.pageSize ?? 50)

  if (!calls || calls.length === 0) return { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }

  // Resolve owner and account names
  const ownerIds = [...new Set(calls.map((c) => c.owner_sf_id).filter(Boolean))]
  const accountIds = [...new Set(calls.map((c) => c.account_sf_id).filter(Boolean))]

  const [usersRes, accountsRes] = await Promise.all([
    ownerIds.length > 0 ? supabase.from('sf_users').select('sf_id, name').in('sf_id', ownerIds) : { data: [] },
    accountIds.length > 0 ? supabase.from('sf_accounts').select('sf_id, name').in('sf_id', accountIds) : { data: [] },
  ])

  const userNames = new Map((usersRes.data ?? []).map((u: any) => [u.sf_id, u.name]))
  const accountNames = new Map((accountsRes.data ?? []).map((a: any) => [a.sf_id, a.name]))

  const mapped: SeedProfileCall[] = calls.map((c) => ({
    id: c.sf_id,
    subject: c.subject ?? '',
    repId: c.owner_sf_id ?? '',
    repName: userNames.get(c.owner_sf_id) ?? c.owner_sf_id ?? '',
    accountName: accountNames.get(c.account_sf_id) ?? '',
    contactName: c.who_name ?? '',
    activityDate: c.activity_date,
    activityType: c.activity_type as 'Task' | 'Event',
    profileCallType: c.profile_call_type ?? 'Follow-Up',
    profileCallOutcome: c.profile_call_outcome ?? 'Needs Follow-Up',
    productsDiscussed: c.products_discussed ? c.products_discussed.split(';').map((s: string) => s.trim()) : [],
    programSize: c.program_size ?? '',
    currentSupplier: c.current_supplier,
    budgetAvailable: c.budget_available ? Number(c.budget_available) : null,
    budgetTimeframe: c.budget_timeframe,
    followUpDate: c.follow_up_date,
    convertedToOpp: c.converted_to_opp ?? false,
    relatedOpportunityName: null, // Would need to join sf_opportunities
    callNotesSummary: c.call_notes_summary ?? '',
    competitorIntel: c.competitor_intel,
    ringdnaDirection: c.ringdna_direction ?? 'Outbound',
    ringdnaDurationMin: c.ringdna_duration_min ? Number(c.ringdna_duration_min) : 0,
    ringdnaConnected: c.ringdna_connected ?? false,
    ringdnaRating: c.ringdna_rating,
    ringdnaRecordingUrl: c.ringdna_recording_url,
    ringdnaVoicemail: c.ringdna_voicemail ?? false,
    ringdnaKeywords: c.ringdna_keywords,
    ringdnaStartTime: c.ringdna_start_time ?? c.activity_date,
    calendlyNoShow: c.calendly_no_show ?? false,
    calendlyRescheduled: c.calendly_rescheduled ?? false,
  }))

  return paginate(mapped, filters.page, filters.pageSize)
}

export interface ProfileCallMetricsResult {
  totalMTD: number
  totalLastMonth: number
  conversionRate: number
  connectRate: number
  avgDuration: number
  byRep: Array<{
    repName: string
    calls: number
    converted: number
    conversionRate: number
    connectedCalls: number
    connectRate: number
    avgDuration: number
    avgRating: number | null
  }>
}

export async function getProfileCallMetrics(): Promise<ProfileCallMetricsResult> {
  const mode = await getDataSourceMode()
  if (mode === 'live') {
    const result = await getLiveProfileCallMetrics()
    if (result.totalMTD > 0) return result
  }
  return getSeedProfileCallMetrics()
}

function getSeedProfileCallMetrics(): ProfileCallMetricsResult {
  const calls = seedProfileCalls
  const mtdCalls = calls.filter((c) => c.activityDate >= '2026-03-01')
  const lastMonthCalls = calls.filter((c) => c.activityDate >= '2026-02-01' && c.activityDate < '2026-03-01')
  const converted = mtdCalls.filter((c) => c.convertedToOpp)
  const connected = mtdCalls.filter((c) => c.ringdnaConnected)
  const withDuration = mtdCalls.filter((c) => c.ringdnaDurationMin > 0)

  const byRepMap = new Map<string, {
    calls: number; converted: number; connected: number;
    totalDuration: number; totalRating: number; ratingCount: number
  }>()
  for (const call of mtdCalls) {
    const existing = byRepMap.get(call.repName) ?? { calls: 0, converted: 0, connected: 0, totalDuration: 0, totalRating: 0, ratingCount: 0 }
    existing.calls++
    if (call.convertedToOpp) existing.converted++
    if (call.ringdnaConnected) existing.connected++
    existing.totalDuration += call.ringdnaDurationMin
    if (call.ringdnaRating !== null) {
      existing.totalRating += call.ringdnaRating
      existing.ratingCount++
    }
    byRepMap.set(call.repName, existing)
  }

  return {
    totalMTD: mtdCalls.length,
    totalLastMonth: lastMonthCalls.length,
    conversionRate: mtdCalls.length > 0 ? Math.round((converted.length / mtdCalls.length) * 1000) / 10 : 0,
    connectRate: mtdCalls.length > 0 ? Math.round((connected.length / mtdCalls.length) * 1000) / 10 : 0,
    avgDuration: withDuration.length > 0 ? Math.round(withDuration.reduce((s, c) => s + c.ringdnaDurationMin, 0) / withDuration.length) : 0,
    byRep: Array.from(byRepMap.entries()).map(([repName, data]) => ({
      repName,
      calls: data.calls,
      converted: data.converted,
      conversionRate: data.calls > 0 ? Math.round((data.converted / data.calls) * 1000) / 10 : 0,
      connectedCalls: data.connected,
      connectRate: data.calls > 0 ? Math.round((data.connected / data.calls) * 1000) / 10 : 0,
      avgDuration: data.calls > 0 ? Math.round(data.totalDuration / data.calls) : 0,
      avgRating: data.ratingCount > 0 ? Math.round((data.totalRating / data.ratingCount) * 10) / 10 : null,
    })),
  }
}

async function getLiveProfileCallMetrics(): Promise<ProfileCallMetricsResult> {
  const supabase = createAdminClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]

  const { data: mtdCalls } = await supabase
    .from('sf_profile_calls')
    .select('owner_sf_id, converted_to_opp, ringdna_connected, ringdna_duration_min, ringdna_rating')
    .gte('activity_date', monthStart)

  const { count: lastMonthCount } = await supabase
    .from('sf_profile_calls')
    .select('*', { count: 'exact', head: true })
    .gte('activity_date', lastMonthStart)
    .lt('activity_date', monthStart)

  if (!mtdCalls || mtdCalls.length === 0) {
    return { totalMTD: 0, totalLastMonth: lastMonthCount ?? 0, conversionRate: 0, connectRate: 0, avgDuration: 0, byRep: [] }
  }

  // Resolve owner names
  const ownerIds = [...new Set(mtdCalls.map((c) => c.owner_sf_id).filter(Boolean))]
  const { data: users } = await supabase.from('sf_users').select('sf_id, name').in('sf_id', ownerIds)
  const nameMap = new Map((users ?? []).map((u: any) => [u.sf_id, u.name]))

  const totalMTD = mtdCalls.length
  const converted = mtdCalls.filter((c) => c.converted_to_opp).length
  const connected = mtdCalls.filter((c) => c.ringdna_connected).length
  const durations = mtdCalls.map((c) => Number(c.ringdna_duration_min) || 0).filter((d) => d > 0)

  // Group by rep
  const byRepMap = new Map<string, {
    calls: number; converted: number; connected: number;
    totalDuration: number; totalRating: number; ratingCount: number
  }>()
  for (const call of mtdCalls) {
    const repId = call.owner_sf_id ?? 'unknown'
    const existing = byRepMap.get(repId) ?? { calls: 0, converted: 0, connected: 0, totalDuration: 0, totalRating: 0, ratingCount: 0 }
    existing.calls++
    if (call.converted_to_opp) existing.converted++
    if (call.ringdna_connected) existing.connected++
    existing.totalDuration += Number(call.ringdna_duration_min) || 0
    if (call.ringdna_rating != null) {
      existing.totalRating += call.ringdna_rating
      existing.ratingCount++
    }
    byRepMap.set(repId, existing)
  }

  return {
    totalMTD,
    totalLastMonth: lastMonthCount ?? 0,
    conversionRate: totalMTD > 0 ? Math.round((converted / totalMTD) * 1000) / 10 : 0,
    connectRate: totalMTD > 0 ? Math.round((connected / totalMTD) * 1000) / 10 : 0,
    avgDuration: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    byRep: Array.from(byRepMap.entries()).map(([repId, data]) => ({
      repName: nameMap.get(repId) ?? repId,
      calls: data.calls,
      converted: data.converted,
      conversionRate: data.calls > 0 ? Math.round((data.converted / data.calls) * 1000) / 10 : 0,
      connectedCalls: data.connected,
      connectRate: data.calls > 0 ? Math.round((data.connected / data.calls) * 1000) / 10 : 0,
      avgDuration: data.calls > 0 ? Math.round(data.totalDuration / data.calls) : 0,
      avgRating: data.ratingCount > 0 ? Math.round((data.totalRating / data.ratingCount) * 10) / 10 : null,
    })),
  }
}

export async function getWeeklyCallVolume(): Promise<SeedWeeklyCallVolume[]> {
  return seedWeeklyCallVolume
}

export async function getCallOutcomeBreakdown(): Promise<Array<{
  outcome: string
  count: number
  percentage: number
  color: string
}>> {
  const mode = await getDataSourceMode()
  if (mode === 'live') {
    const supabase = createAdminClient()
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const { data: calls } = await supabase
      .from('sf_profile_calls')
      .select('profile_call_outcome')
      .gte('activity_date', monthStart)

    if (calls && calls.length > 0) {
      const total = calls.length
      const outcomeColors: Record<string, string> = {
        'Interested - Next Steps': '#0FA62C',
        'Scheduled Demo': '#1E98D5',
        'Quote Requested': '#B5C8CD',
        'Needs Follow-Up': '#1C3C6E',
        'Not Interested': '#D93025',
      }
      const counts = new Map<string, number>()
      for (const c of calls) {
        const o = c.profile_call_outcome ?? 'Unknown'
        counts.set(o, (counts.get(o) ?? 0) + 1)
      }
      return Array.from(counts.entries())
        .map(([outcome, count]) => ({
          outcome,
          count,
          percentage: Math.round((count / total) * 1000) / 10,
          color: outcomeColors[outcome] ?? '#94A3B8',
        }))
        .sort((a, b) => b.count - a.count)
    }
  }

  // Seed fallback
  const calls = seedProfileCalls.filter((c) => c.activityDate >= '2026-03-01')
  const total = calls.length
  const outcomeColors: Record<string, string> = {
    'Interested - Next Steps': '#0FA62C',
    'Scheduled Demo': '#1E98D5',
    'Quote Requested': '#B5C8CD',
    'Needs Follow-Up': '#1C3C6E',
    'Not Interested': '#D93025',
  }
  const counts = new Map<string, number>()
  for (const call of calls) {
    counts.set(call.profileCallOutcome, (counts.get(call.profileCallOutcome) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([outcome, count]) => ({
      outcome,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      color: outcomeColors[outcome] ?? '#94A3B8',
    }))
    .sort((a, b) => b.count - a.count)
}

export interface KeywordResult {
  keyword: string
  mentions: number
  calls: number
  type: 'competitor' | 'budget' | 'objection' | 'product'
}

export async function getTopCompetitorKeywords(limit: number = 10): Promise<KeywordResult[]> {
  const mode = await getDataSourceMode()
  if (mode === 'live') {
    const result = await getLiveTopKeywords(limit)
    if (result.length > 0) return result
  }
  return getSeedTopKeywords(limit)
}

function getSeedTopKeywords(limit: number): KeywordResult[] {
  const calls = seedProfileCalls.filter((c) => c.activityDate >= '2026-01-01')

  const keywordMentions = new Map<string, number>()
  const keywordCalls = new Map<string, Set<string>>()

  for (const call of calls) {
    if (!call.ringdnaKeywords) continue
    const words = call.ringdnaKeywords.split(/[,;]/).map((w) => w.trim()).filter(Boolean)
    for (const word of words) {
      keywordMentions.set(word, (keywordMentions.get(word) ?? 0) + 1)
      const callSet = keywordCalls.get(word) ?? new Set()
      callSet.add(call.id)
      keywordCalls.set(word, callSet)
    }
  }

  return Array.from(keywordMentions.entries())
    .map(([keyword, mentions]) => ({
      keyword,
      mentions,
      calls: keywordCalls.get(keyword)?.size ?? 0,
      type: classifyKeyword(keyword),
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, limit)
}

async function getLiveTopKeywords(limit: number): Promise<KeywordResult[]> {
  const supabase = createAdminClient()
  const { data: calls } = await supabase
    .from('sf_profile_calls')
    .select('sf_id, ringdna_keywords')
    .not('ringdna_keywords', 'is', null)

  if (!calls || calls.length === 0) return []

  const keywordMentions = new Map<string, number>()
  const keywordCalls = new Map<string, Set<string>>()

  for (const call of calls) {
    if (!call.ringdna_keywords) continue
    const words = call.ringdna_keywords.split(/[,;]/).map((w: string) => w.trim()).filter(Boolean)
    for (const word of words) {
      keywordMentions.set(word, (keywordMentions.get(word) ?? 0) + 1)
      const callSet = keywordCalls.get(word) ?? new Set()
      callSet.add(call.sf_id)
      keywordCalls.set(word, callSet)
    }
  }

  return Array.from(keywordMentions.entries())
    .map(([keyword, mentions]) => ({
      keyword,
      mentions,
      calls: keywordCalls.get(keyword)?.size ?? 0,
      type: classifyKeyword(keyword),
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, limit)
}

// Shared keyword classifier
const competitorNames = ['Pocket Nurse', 'Laerdal', 'Cardinal Health', 'McKesson']
const budgetSignals = ['budget', 'grant funding', 'capital request', 'lease option', 'pricing', 'ROI']
const productTerms = ['Pyxis', 'simulation lab', 'NCLEX', 'clinical rotation']

function classifyKeyword(kw: string): KeywordResult['type'] {
  if (competitorNames.some((c) => kw.toLowerCase().includes(c.toLowerCase()))) return 'competitor'
  if (budgetSignals.some((b) => kw.toLowerCase().includes(b.toLowerCase()))) return 'budget'
  if (productTerms.some((p) => kw.toLowerCase().includes(p.toLowerCase()))) return 'product'
  return 'objection'
}
