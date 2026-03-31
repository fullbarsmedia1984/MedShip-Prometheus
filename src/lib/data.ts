// =============================================================================
// Data Access Layer
// Every function returns seed data now, will be replaced with Supabase queries later
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
// Helper
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

// TODO: Replace seed data with Supabase query in Phase 2
export async function getRevenueMetrics(): Promise<RevenueMetrics> {
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
  const fulfillmentRateChange = 2.3

  const avgShipDays = 2.8
  const avgShipDaysChange = -0.4

  return {
    mtdRevenue,
    mtdRevenueChange,
    openOrders,
    openOrdersChange,
    fulfillmentRate,
    fulfillmentRateChange,
    avgShipDays,
    avgShipDaysChange,
  }
}

// ---------------------------------------------------------------------------
// Monthly Revenue
// ---------------------------------------------------------------------------

// TODO: Replace seed data with Supabase query in Phase 2
export async function getMonthlyRevenue(): Promise<MonthlyRevenue[]> {
  return seedMonthlyRevenue
}

// ---------------------------------------------------------------------------
// Category Sales
// ---------------------------------------------------------------------------

// TODO: Replace seed data with Supabase query in Phase 2
export async function getCategorySales(): Promise<CategorySales[]> {
  return seedCategorySales
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

// TODO: Replace seed data with Supabase query in Phase 2
export async function getOrders(filters: OrderFilters = {}): Promise<PaginatedResult<Order>> {
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

  // Sort by date descending
  items.sort((a, b) => b.date.localeCompare(a.date))

  return paginate(items, filters.page, filters.pageSize)
}

// TODO: Replace seed data with Supabase query in Phase 2
export async function getRecentOrders(limit = 10): Promise<Order[]> {
  return [...seedOrders]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}

// TODO: Replace seed data with Supabase query in Phase 2
export async function getSalesReps(): Promise<SalesRep[]> {
  return seedSalesReps
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

// TODO: Replace seed data with Supabase query in Phase 2
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

// TODO: Replace seed data with Supabase query in Phase 2
export async function getInventoryKpis(): Promise<InventoryKpis> {
  const products = seedProducts
  return {
    totalSkus: products.length,
    inStock: products.filter((p) => p.qtyAvailable > p.reorderPoint).length,
    lowStock: products.filter((p) => p.qtyAvailable > 0 && p.qtyAvailable <= p.reorderPoint).length,
    outOfStock: products.filter((p) => p.qtyAvailable <= 0).length,
  }
}

// TODO: Replace seed data with Supabase query in Phase 2
export async function getInventoryAlerts(limit = 5): Promise<Product[]> {
  return seedProducts
    .filter((p) => p.qtyAvailable <= p.reorderPoint)
    .sort((a, b) => a.qtyAvailable - b.qtyAvailable)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Sync Events
// ---------------------------------------------------------------------------

// TODO: Replace seed data with Supabase query in Phase 2
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

// TODO: Replace seed data with Supabase query in Phase 2
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

// TODO: Replace seed data with Supabase query in Phase 2
export async function getFailedSyncs(): Promise<SyncEvent[]> {
  return seedSyncEvents.filter(
    (e) => e.status === 'failed' || e.status === 'retrying'
  )
}

// ---------------------------------------------------------------------------
// Integration Status
// ---------------------------------------------------------------------------

// TODO: Replace seed data with Supabase query in Phase 2
export async function getIntegrationStatus(): Promise<IntegrationStatusData[]> {
  return seedIntegrationStatus
}

// ---------------------------------------------------------------------------
// Field Mappings
// ---------------------------------------------------------------------------

// TODO: Replace seed data with Supabase query in Phase 2
export async function getFieldMappings(automation?: string): Promise<FieldMapping[]> {
  if (automation && automation !== 'all') {
    return seedFieldMappings.filter((m) => m.automation === automation)
  }
  return seedFieldMappings
}

// ---------------------------------------------------------------------------
// Connection Configs
// ---------------------------------------------------------------------------

// TODO: Replace seed data with Supabase query in Phase 2
export async function getConnectionConfigs(): Promise<ConnectionConfig[]> {
  return seedConnectionConfigs
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

// TODO: Replace seed data with Supabase query in Phase 2
export async function getCustomers(): Promise<Customer[]> {
  return seedCustomers
}

// ---------------------------------------------------------------------------
// Sales Analytics
// ---------------------------------------------------------------------------

export async function getSalesLeaderboard(): Promise<SeedSalesRep[]> {
  return [...seedEnhancedSalesReps].sort((a, b) => b.revenueMTD - a.revenueMTD)
}

export async function getEnhancedSalesReps(): Promise<SeedSalesRep[]> {
  return seedEnhancedSalesReps
}

export async function getPipelineSnapshot(): Promise<SeedPipelineStage[]> {
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
  search?: string
  limit?: number
  page?: number
  pageSize?: number
}

// TODO: Replace with SF query via getProfileCalls()
export async function getProfileCalls(filters: ProfileCallFilters = {}): Promise<PaginatedResult<SeedProfileCall>> {
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
    items = items.filter((c) => c.callOutcome === filters.outcome)
  }
  if (filters.convertedOnly) {
    items = items.filter((c) => c.convertedToOpp)
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    items = items.filter(
      (c) =>
        c.accountName.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q)
    )
  }

  items.sort((a, b) => b.activityDate.localeCompare(a.activityDate))
  return paginate(items, filters.page, filters.pageSize)
}

// TODO: Replace with SF query via getProfileCallMetrics()
export async function getProfileCallMetrics(): Promise<{
  totalMTD: number
  totalLastMonth: number
  conversionRate: number
  avgDuration: number
  byRep: Array<{
    repName: string
    calls: number
    converted: number
    conversionRate: number
    avgDuration: number
  }>
}> {
  const calls = seedProfileCalls
  const now = new Date('2026-03-31')
  const mtdCalls = calls.filter((c) => c.activityDate >= '2026-03-01')
  const lastMonthCalls = calls.filter((c) => c.activityDate >= '2026-02-01' && c.activityDate < '2026-03-01')
  const converted = mtdCalls.filter((c) => c.convertedToOpp)
  const withDuration = mtdCalls.filter((c) => c.callDurationMinutes > 0)

  const byRepMap = new Map<string, { calls: number; converted: number; totalDuration: number }>()
  for (const call of mtdCalls) {
    const existing = byRepMap.get(call.repName) ?? { calls: 0, converted: 0, totalDuration: 0 }
    existing.calls++
    if (call.convertedToOpp) existing.converted++
    existing.totalDuration += call.callDurationMinutes
    byRepMap.set(call.repName, existing)
  }

  return {
    totalMTD: mtdCalls.length,
    totalLastMonth: lastMonthCalls.length,
    conversionRate: mtdCalls.length > 0 ? Math.round((converted.length / mtdCalls.length) * 1000) / 10 : 0,
    avgDuration: withDuration.length > 0 ? Math.round(withDuration.reduce((s, c) => s + c.callDurationMinutes, 0) / withDuration.length) : 0,
    byRep: Array.from(byRepMap.entries()).map(([repName, data]) => ({
      repName,
      calls: data.calls,
      converted: data.converted,
      conversionRate: data.calls > 0 ? Math.round((data.converted / data.calls) * 1000) / 10 : 0,
      avgDuration: data.calls > 0 ? Math.round(data.totalDuration / data.calls) : 0,
    })),
  }
}

// TODO: Replace with SF query via getProfileCalls()
export async function getWeeklyCallVolume(): Promise<SeedWeeklyCallVolume[]> {
  return seedWeeklyCallVolume
}

// TODO: Replace with SF query via getProfileCalls()
export async function getCallOutcomeBreakdown(): Promise<Array<{
  outcome: string
  count: number
  percentage: number
  color: string
}>> {
  const calls = seedProfileCalls.filter((c) => c.activityDate >= '2026-03-01')
  const total = calls.length

  const outcomeColors: Record<string, string> = {
    'Interested - Next Steps': '#3A9B94',
    'Scheduled Demo': '#452B90',
    'Quote Requested': '#22C55E',
    'Needs Follow-Up': '#F8B940',
    'Not Interested': '#FF5E5E',
    'No Answer': '#94A3B8',
    'Left Voicemail': '#CBD5E1',
  }

  const counts = new Map<string, number>()
  for (const call of calls) {
    counts.set(call.callOutcome, (counts.get(call.callOutcome) ?? 0) + 1)
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
