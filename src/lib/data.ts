// =============================================================================
// Data Access Layer
// Dashboard reads live Salesforce/Fishbowl cache only. Seed data remains typed
// fixture data, but user-facing dashboard modules must not fall back to it.
// =============================================================================

import type {
  Product,
  Customer,
  Order,
  OrderItem,
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
import { AUTOMATION_INFO } from '@/types'
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

type InventorySnapshotRow = {
  id: string
  part_number: string
  part_description: string | null
  qty_on_hand: number | string | null
  qty_allocated: number | string | null
  qty_available: number | string | null
  uom: string | null
  location: string | null
  fishbowl_part_id: number | null
  last_synced_at: string | null
  sf_product_id: string | null
}

type ReorderRuleRow = {
  part_number: string
  reorder_point: number | string
  is_active: boolean | null
}

type SyncScheduleRow = {
  id: string
  automation: AutomationType
  cron_expression: string
  is_active: boolean | null
  last_run_at: string | null
  next_run_at: string | null
  last_run_status: string | null
  last_run_duration_ms: number | null
  records_processed: number | null
}

type AmountRow = {
  amount: number | string | null
}

type LookupNameRow = {
  sf_id: string
  name: string | null
}

type SfAccountRow = {
  sf_id: string
  name: string | null
  billing_state: string | null
}

type SfUserRow = {
  sf_id: string
  name: string | null
  email: string | null
}

type SfOpportunityRow = {
  sf_id: string
  name: string
  account_sf_id: string | null
  owner_sf_id: string | null
  stage_name: string | null
  amount: number | string | null
  close_date: string | null
  is_closed: boolean | null
  is_won: boolean | null
  fishbowl_so_number: string | null
  fulfillment_status: string | null
  fulfillment_error: string | null
  created_date: string | null
  last_modified_date: string | null
}

type SfOpportunityLineItemRow = {
  sf_id: string
  opportunity_sf_id: string
  product_sf_id: string | null
  product_code: string | null
  product_name: string | null
  quantity: number | string | null
  unit_price: number | string | null
  total_price: number | string | null
}

type SfProductCategoryRow = {
  sf_id: string
  family: string | null
}

function sortByCreatedDesc<T extends { created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

function applyInventoryFilters(items: Product[], filters: InventoryFilters): Product[] {
  let filtered = [...items]

  if (filters.category && filters.category !== 'all') {
    filtered = filtered.filter((p) => p.category === filters.category)
  }
  if (filters.stockStatus && filters.stockStatus !== 'all') {
    if (filters.stockStatus === 'out_of_stock') {
      filtered = filtered.filter((p) => p.qtyAvailable <= 0)
    } else if (filters.stockStatus === 'low') {
      filtered = filtered.filter((p) => p.qtyAvailable > 0 && p.qtyAvailable <= p.reorderPoint)
    } else if (filters.stockStatus === 'in_stock') {
      filtered = filtered.filter((p) => p.qtyAvailable > p.reorderPoint)
    }
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    filtered = filtered.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    )
  }

  return filtered
}

function getInventoryKpisFromProducts(products: Product[]): InventoryKpis {
  return {
    totalSkus: products.length,
    inStock: products.filter((p) => p.qtyAvailable > p.reorderPoint).length,
    lowStock: products.filter((p) => p.qtyAvailable > 0 && p.qtyAvailable <= p.reorderPoint).length,
    outOfStock: products.filter((p) => p.qtyAvailable <= 0).length,
  }
}

function applyEventFilters(items: SyncEvent[], filters: EventFilters): SyncEvent[] {
  let filtered = [...items]

  if (filters.automation && filters.automation !== 'all') {
    filtered = filtered.filter((e) => e.automation === filters.automation)
  }
  if (filters.status && filters.status !== 'all') {
    filtered = filtered.filter((e) => e.status === filters.status)
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    filtered = filtered.filter(
      (e) =>
        e.source_record_id?.toLowerCase().includes(q) ||
        e.target_record_id?.toLowerCase().includes(q) ||
        e.error_message?.toLowerCase().includes(q)
    )
  }
  if (filters.dateFrom) {
    filtered = filtered.filter((e) => e.created_at >= filters.dateFrom!)
  }
  if (filters.dateTo) {
    filtered = filtered.filter((e) => e.created_at <= filters.dateTo!)
  }

  return sortByCreatedDesc(filtered)
}

function getEventKpisFromEvents(events: SyncEvent[], today: string): EventKpis {
  const total = events.length
  const successes = events.filter((e) => e.status === 'success').length
  const successRate = total > 0 ? Math.round((successes / total) * 1000) / 10 : 0

  const completed = events.filter((e) => e.completed_at)
  const totalDuration = completed.reduce((sum, e) => {
    const dur = new Date(e.completed_at!).getTime() - new Date(e.created_at).getTime()
    return sum + Math.max(dur, 0)
  }, 0)
  const avgDurationMs = completed.length > 0 ? Math.round(totalDuration / completed.length) : 0

  const failuresToday = events.filter(
    (e) => e.status === 'failed' && e.created_at.startsWith(today)
  ).length

  return { total, successRate, avgDurationMs, failuresToday }
}

function toNumber(value: number | string | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function warnEmptyLiveTable(tableName: string, surface: string): void {
  console.warn(`${tableName} returned no live rows; ${surface} is returning an empty live result`)
}

function inferCategory(partNumber: string): Product['category'] {
  if (partNumber.startsWith('CE-')) return 'Capital Equipment'
  if (partNumber.startsWith('SIM-')) return 'Simulation'
  if (partNumber.startsWith('SUP-')) return 'Supplies'
  if (partNumber.startsWith('KIT-')) return 'Kits'
  if (partNumber.startsWith('DX-')) return 'Diagnostics'
  if (partNumber.startsWith('CON-')) return 'Consumables'
  return 'Supplies'
}

function mapInventorySnapshotToProduct(
  row: InventorySnapshotRow,
  reorderPoint: number
): Product {
  return {
    id: row.id,
    sku: row.part_number,
    name: row.part_description ?? row.part_number,
    category: inferCategory(row.part_number),
    price: 0,
    cost: 0,
    qtyOnHand: toNumber(row.qty_on_hand),
    qtyAllocated: toNumber(row.qty_allocated),
    qtyAvailable: toNumber(row.qty_available),
    reorderPoint,
    lastSyncedAt: row.last_synced_at ?? new Date().toISOString(),
  }
}

async function getLiveInventoryProducts(): Promise<Product[]> {
  const supabase = createAdminClient()

  const { data: inventory, error } = await supabase
    .from('inventory_snapshot')
    .select('id, part_number, part_description, qty_on_hand, qty_allocated, qty_available, uom, location, fishbowl_part_id, last_synced_at, sf_product_id')
    .order('part_number')

  if (error) throw error
  if (!inventory || inventory.length === 0) {
    warnEmptyLiveTable('inventory_snapshot', 'inventory')
    return []
  }

  const { data: reorderRules, error: rulesError } = await supabase
    .from('reorder_rules')
    .select('part_number, reorder_point, is_active')

  if (rulesError) {
    console.warn('Live reorder rules query failed; using product metadata defaults:', rulesError)
  }

  const rulesByPart = new Map(
    ((reorderRules as ReorderRuleRow[] | null) ?? [])
      .filter((rule) => rule.is_active !== false)
      .map((rule) => [rule.part_number, toNumber(rule.reorder_point)])
  )
  return (inventory as InventorySnapshotRow[]).map((row) => {
    const reorderPoint = rulesByPart.get(row.part_number) ?? 0
    return mapInventorySnapshotToProduct(row, reorderPoint)
  })
}

async function getLiveSyncEvents(): Promise<SyncEvent[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sync_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) throw error
  return (data ?? []) as SyncEvent[]
}

async function getLiveFieldMappings(): Promise<FieldMapping[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('field_mappings')
    .select('*')
    .order('automation')
    .order('source_field')

  if (error) throw error
  return (data ?? []) as FieldMapping[]
}

function redactConnectionConfig(row: ConnectionConfig): ConnectionConfig {
  return {
    ...row,
    config: {},
  }
}

async function getLiveConnectionConfigs(): Promise<ConnectionConfig[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('connection_configs')
    .select('*')
    .order('system_name')

  if (error) throw error
  return ((data ?? []) as ConnectionConfig[]).map(redactConnectionConfig)
}

function cronToScheduleLabel(cronExpression: string | null | undefined): string {
  if (!cronExpression) return 'On-demand'
  const map: Record<string, string> = {
    '*/2 * * * *': 'Every 2 minutes',
    '*/15 * * * *': 'Every 15 minutes',
    '0 * * * *': 'Every 1 hour',
  }
  return map[cronExpression] ?? cronExpression
}

function getEventDurationMs(event: SyncEvent | undefined): number {
  if (!event?.completed_at) return 0
  const duration = new Date(event.completed_at).getTime() - new Date(event.created_at).getTime()
  return Math.max(duration, 0)
}

function buildLast7Days(events: SyncEvent[]): { date: string; success: number; failed: number }[] {
  const now = new Date()
  const days: { date: string; success: number; failed: number }[] = []

  for (let offset = 6; offset >= 0; offset--) {
    const day = new Date(now)
    day.setDate(now.getDate() - offset)
    const date = day.toISOString().slice(0, 10)
    const dayEvents = events.filter((event) => event.created_at.startsWith(date))
    days.push({
      date,
      success: dayEvents.filter((event) => event.status === 'success').length,
      failed: dayEvents.filter((event) => event.status === 'failed').length,
    })
  }

  return days
}

function getIntegrationHealth(
  schedule: SyncScheduleRow | undefined,
  events: SyncEvent[],
  successRate: number
): IntegrationStatusData['status'] {
  if (!schedule && events.length === 0) return 'warning'
  if (schedule?.is_active === false) return 'warning'
  if (schedule?.last_run_status === 'failed') return 'error'
  if (events.some((event) => event.status === 'failed' && event.retry_count >= event.max_retries)) {
    return 'error'
  }
  if (events.some((event) => event.status === 'failed' || event.status === 'retrying')) {
    return 'warning'
  }
  if (events.length > 0 && successRate < 80) return 'error'
  if (events.length > 0 && successRate < 95) return 'warning'
  return 'healthy'
}

async function getLiveIntegrationStatus(): Promise<IntegrationStatusData[]> {
  const supabase = createAdminClient()
  const { data: schedules, error } = await supabase
    .from('sync_schedules')
    .select('*')
    .order('automation')

  if (error) throw error

  const events = await getLiveSyncEvents()
  if ((!schedules || schedules.length === 0) && events.length === 0) return []

  const scheduleRows = ((schedules ?? []) as SyncScheduleRow[])
  const schedulesByAutomation = new Map(
    scheduleRows.map((schedule) => [schedule.automation, schedule])
  )
  const automationSet = new Set<AutomationType>([
    ...(Object.keys(AUTOMATION_INFO) as AutomationType[]),
    ...scheduleRows.map((schedule) => schedule.automation),
    ...events.map((event) => event.automation),
  ])

  return Array.from(automationSet).map((automation) => {
    const schedule = schedulesByAutomation.get(automation)
    const automationEvents = sortByCreatedDesc(events.filter((event) => event.automation === automation))
    const latestEvent = automationEvents[0]
    const successful = automationEvents.filter((event) => event.status === 'success').length
    const completed = automationEvents.filter((event) => event.status === 'success' || event.status === 'failed')
    const successRate = completed.length > 0
      ? Math.round((successful / completed.length) * 1000) / 10
      : schedule?.last_run_status === 'success'
        ? 100
        : 0
    const info = AUTOMATION_INFO[automation]
    const hasObservedData = Boolean(schedule || latestEvent)

    return {
      automation,
      name: info?.name ?? automation,
      description: info?.description ?? 'Integration automation',
      status: getIntegrationHealth(schedule, automationEvents, successRate),
      lastRunAt: schedule?.last_run_at ?? latestEvent?.created_at ?? '',
      lastRunDurationMs: schedule?.last_run_duration_ms ?? getEventDurationMs(latestEvent),
      recordsProcessed: schedule?.records_processed ?? completed.length,
      successRate,
      schedule: schedule
        ? cronToScheduleLabel(schedule.cron_expression)
        : latestEvent
          ? 'Event-driven'
          : 'Not scheduled',
      isActive: schedule?.is_active ?? hasObservedData,
      last7Days: buildLast7Days(automationEvents),
    }
  })
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
  void await getDataSourceMode()
  return getLiveRevenueMetrics()
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
  void await getDataSourceMode()
  return getLiveMonthlyRevenue()
}

async function getLiveMonthlyRevenue(): Promise<MonthlyRevenue[]> {
  const supabase = createAdminClient()

  // Get last 12 months including current month
  const now = new Date()
  const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const { data: opps, error } = await supabase
    .from('sf_opportunities')
    .select('amount, close_date')
    .eq('is_won', true)
    .gte('close_date', startDate.toISOString().split('T')[0])
    .not('amount', 'is', null)

  if (error || !opps) {
    console.error('getLiveMonthlyRevenue query failed:', error)
    return []
  }
  if (opps.length === 0) {
    warnEmptyLiveTable('sf_opportunities', 'monthly revenue')
    return []
  }

  // Initialize all 12 months with 0 so gaps show as zero, not missing
  const buckets = new Map<string, { revenue: number; orderCount: number }>()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets.set(key, { revenue: 0, orderCount: 0 })
  }

  // Sum opportunity amounts into buckets
  for (const opp of opps) {
    if (!opp.close_date || !opp.amount) continue
    const key = opp.close_date.slice(0, 7) // "2026-03"
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.revenue += Number(opp.amount)
      bucket.orderCount++
    }
  }

  // Return in chronological order matching MonthlyRevenue shape
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, data]) => {
      const [year, month] = key.split('-')
      const monthDate = new Date(Number(year), Number(month) - 1, 1)
      return {
        month: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
        revenue: Math.round(data.revenue),
        orderCount: data.orderCount,
      }
    })
}

async function getLookupMaps(
  accountIds: string[],
  ownerIds: string[]
): Promise<{
  accountsById: Map<string, SfAccountRow>
  usersById: Map<string, SfUserRow>
}> {
  const supabase = createAdminClient()
  const uniqueAccountIds = [...new Set(accountIds.filter(Boolean))]
  const uniqueOwnerIds = [...new Set(ownerIds.filter(Boolean))]

  const [accountsRes, usersRes] = await Promise.all([
    uniqueAccountIds.length > 0
      ? supabase.from('sf_accounts').select('sf_id, name, billing_state').in('sf_id', uniqueAccountIds)
      : { data: [] },
    uniqueOwnerIds.length > 0
      ? supabase.from('sf_users').select('sf_id, name, email').in('sf_id', uniqueOwnerIds)
      : { data: [] },
  ])

  return {
    accountsById: new Map(((accountsRes.data ?? []) as SfAccountRow[]).map((row) => [row.sf_id, row])),
    usersById: new Map(((usersRes.data ?? []) as SfUserRow[]).map((row) => [row.sf_id, row])),
  }
}

function mapOpportunityStatus(row: SfOpportunityRow): Order['status'] {
  if (row.is_closed && row.is_won) return 'Closed Won'
  if (row.is_closed && row.is_won === false) return 'Cancelled'
  return 'Pending'
}

function mapFulfillmentStatus(row: SfOpportunityRow): Order['fulfillmentStatus'] {
  if (row.is_closed && row.is_won === false) return 'N/A'

  const status = row.fulfillment_status?.toLowerCase() ?? ''
  if (row.fulfillment_error || status.includes('fail') || status.includes('error')) return 'Failed'
  if (row.fishbowl_so_number || status.includes('sync') || status.includes('fulfilled')) return 'Synced'
  return 'Pending'
}

function mapOpportunityToOrder(
  row: SfOpportunityRow,
  items: OrderItem[],
  account?: SfAccountRow,
  owner?: SfUserRow
): Order {
  const lineTotal = items.reduce((sum, item) => sum + item.total, 0)
  const subtotal = lineTotal > 0 ? lineTotal : toNumber(row.amount)

  return {
    id: row.sf_id,
    orderNumber: row.fishbowl_so_number ?? row.sf_id,
    customerId: row.account_sf_id ?? '',
    customerName: account?.name ?? row.account_sf_id ?? 'Unknown Account',
    salesRepId: row.owner_sf_id ?? '',
    salesRepName: owner?.name ?? row.owner_sf_id ?? 'Unassigned',
    date: row.close_date ?? row.created_date?.slice(0, 10) ?? row.last_modified_date?.slice(0, 10) ?? '',
    status: mapOpportunityStatus(row),
    fulfillmentStatus: mapFulfillmentStatus(row),
    items,
    subtotal: roundCurrency(subtotal),
  }
}

function applyOrderFilters(items: Order[], filters: OrderFilters): Order[] {
  let filtered = [...items]

  if (filters.status && filters.status !== 'all') {
    filtered = filtered.filter((o) => o.status === filters.status)
  }
  if (filters.salesRepId && filters.salesRepId !== 'all') {
    filtered = filtered.filter((o) => o.salesRepId === filters.salesRepId)
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    filtered = filtered.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.salesRepName.toLowerCase().includes(q)
    )
  }
  if (filters.dateFrom) {
    filtered = filtered.filter((o) => o.date >= filters.dateFrom!)
  }
  if (filters.dateTo) {
    filtered = filtered.filter((o) => o.date <= filters.dateTo!)
  }

  return filtered.sort((a, b) => b.date.localeCompare(a.date))
}

async function getLiveOrders(): Promise<Order[]> {
  const supabase = createAdminClient()
  const { data: opportunities, error } = await supabase
    .from('sf_opportunities')
    .select('sf_id, name, account_sf_id, owner_sf_id, stage_name, amount, close_date, is_closed, is_won, fishbowl_so_number, fulfillment_status, fulfillment_error, created_date, last_modified_date')
    .order('close_date', { ascending: false })
    .limit(1000)

  if (error) throw error
  if (!opportunities || opportunities.length === 0) return []

  const opportunityRows = opportunities as SfOpportunityRow[]
  const opportunityIds = new Set(opportunityRows.map((row) => row.sf_id))

  const [{ data: lineItems, error: lineItemsError }, lookups] = await Promise.all([
    supabase
      .from('sf_opportunity_line_items')
      .select('sf_id, opportunity_sf_id, product_sf_id, product_code, product_name, quantity, unit_price, total_price')
      .limit(5000),
    getLookupMaps(
      opportunityRows.map((row) => row.account_sf_id ?? ''),
      opportunityRows.map((row) => row.owner_sf_id ?? '')
    ),
  ])

  if (lineItemsError) {
    console.warn('Live opportunity line item query failed; orders will use opportunity totals only:', lineItemsError)
  }

  const itemsByOpportunity = new Map<string, OrderItem[]>()
  for (const item of ((lineItems ?? []) as SfOpportunityLineItemRow[])) {
    if (!opportunityIds.has(item.opportunity_sf_id)) continue

    const items = itemsByOpportunity.get(item.opportunity_sf_id) ?? []
    const quantity = toNumber(item.quantity)
    const unitPrice = toNumber(item.unit_price)
    const total = toNumber(item.total_price) || quantity * unitPrice
    items.push({
      productId: item.product_sf_id ?? item.product_code ?? item.sf_id,
      productName: item.product_name ?? item.product_code ?? 'Unknown Product',
      sku: item.product_code ?? '',
      quantity,
      unitPrice: roundCurrency(unitPrice),
      total: roundCurrency(total),
    })
    itemsByOpportunity.set(item.opportunity_sf_id, items)
  }

  return opportunityRows.map((row) =>
    mapOpportunityToOrder(
      row,
      itemsByOpportunity.get(row.sf_id) ?? [],
      row.account_sf_id ? lookups.accountsById.get(row.account_sf_id) : undefined,
      row.owner_sf_id ? lookups.usersById.get(row.owner_sf_id) : undefined
    )
  )
}

// ---------------------------------------------------------------------------
// Category Sales
// ---------------------------------------------------------------------------

export async function getCategorySales(): Promise<CategorySales[]> {
  void await getDataSourceMode()
  return getLiveCategorySales()
}

async function getLiveCategorySales(): Promise<CategorySales[]> {
  const supabase = createAdminClient()
  const [{ data: wonOpps, error: wonOppsError }, { data: lineItems, error }] = await Promise.all([
    supabase
      .from('sf_opportunities')
      .select('sf_id')
      .eq('is_won', true),
    supabase
      .from('sf_opportunity_line_items')
      .select('opportunity_sf_id, product_sf_id, total_price')
      .limit(5000),
  ])

  if (wonOppsError) throw wonOppsError
  if (error) throw error
  if (!wonOpps || wonOpps.length === 0 || !lineItems || lineItems.length === 0) return []

  const wonOpportunityIds = new Set(((wonOpps ?? []) as Array<Pick<SfOpportunityRow, 'sf_id'>>).map((opp) => opp.sf_id))
  const itemRows = (lineItems as Array<Pick<SfOpportunityLineItemRow, 'opportunity_sf_id' | 'product_sf_id' | 'total_price'>>)
    .filter((item) => wonOpportunityIds.has(item.opportunity_sf_id))

  if (itemRows.length === 0) return []

  const productIds = [...new Set(itemRows.map((item) => item.product_sf_id).filter(Boolean))] as string[]
  const { data: products, error: productsError } = productIds.length > 0
    ? await supabase.from('sf_products').select('sf_id, family').in('sf_id', productIds)
    : { data: [], error: null }

  if (productsError) {
    console.warn('Live product family query failed; category sales will group uncategorized:', productsError)
  }

  const familyByProduct = new Map(
    ((products ?? []) as SfProductCategoryRow[]).map((product) => [product.sf_id, product.family])
  )
  const totals = new Map<string, number>()

  for (const item of itemRows) {
    const category = item.product_sf_id
      ? familyByProduct.get(item.product_sf_id) || 'Uncategorized'
      : 'Uncategorized'
    totals.set(category, (totals.get(category) ?? 0) + toNumber(item.total_price))
  }

  const totalRevenue = Array.from(totals.values()).reduce((sum, value) => sum + value, 0)
  if (totalRevenue <= 0) return []

  return Array.from(totals.entries())
    .map(([category, revenue]) => ({
      category,
      revenue: roundCurrency(revenue),
      percentage: Math.round((revenue / totalRevenue) * 1000) / 10,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function getOrders(filters: OrderFilters = {}): Promise<PaginatedResult<Order>> {
  void await getDataSourceMode()
  const orders = await getLiveOrders()
  const items = applyOrderFilters(orders, filters)
  return paginate(items, filters.page, filters.pageSize)
}

export async function getRecentOrders(limit = 10): Promise<Order[]> {
  void await getDataSourceMode()
  const orders = await getLiveOrders()

  return [...orders]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}

export async function getSalesReps(): Promise<SalesRep[]> {
  void await getDataSourceMode()
  return getLiveSalesRepOptions()
}

async function getLiveSalesRepOptions(): Promise<SalesRep[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sf_users')
    .select('sf_id, name, email')
    .eq('is_active', true)
    .order('name')

  if (error) throw error
  return ((data ?? []) as SfUserRow[]).map((user) => ({
    id: user.sf_id,
    name: user.name ?? user.sf_id,
    email: user.email ?? '',
    region: '',
  }))
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export async function getInventory(filters: InventoryFilters = {}): Promise<PaginatedResult<Product>> {
  void await getDataSourceMode()
  const products = await getLiveInventoryProducts()
  const items = applyInventoryFilters(products, filters)

  return paginate(items, filters.page, filters.pageSize)
}

export interface InventoryKpis {
  totalSkus: number
  inStock: number
  lowStock: number
  outOfStock: number
}

export async function getInventoryKpis(): Promise<InventoryKpis> {
  void await getDataSourceMode()
  const products = await getLiveInventoryProducts()
  return getInventoryKpisFromProducts(products)
}

export async function getInventoryAlerts(limit = 5): Promise<Product[]> {
  void await getDataSourceMode()
  const products = await getLiveInventoryProducts()

  return products
    .filter((p) => p.qtyAvailable <= p.reorderPoint)
    .sort((a, b) => a.qtyAvailable - b.qtyAvailable)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Sync Events
// ---------------------------------------------------------------------------

export async function getSyncEvents(filters: EventFilters = {}): Promise<PaginatedResult<SyncEvent>> {
  void await getDataSourceMode()
  const events = await getLiveSyncEvents()
  const items = applyEventFilters(events, filters)

  return paginate(items, filters.page, filters.pageSize || 25)
}

export interface EventKpis {
  total: number
  successRate: number
  avgDurationMs: number
  failuresToday: number
}

export async function getEventKpis(): Promise<EventKpis> {
  void await getDataSourceMode()
  const events = await getLiveSyncEvents()
  return getEventKpisFromEvents(events, new Date().toISOString().slice(0, 10))
}

// ---------------------------------------------------------------------------
// Failed Syncs
// ---------------------------------------------------------------------------

export async function getFailedSyncs(): Promise<SyncEvent[]> {
  void await getDataSourceMode()
  const events = await getLiveSyncEvents()

  return sortByCreatedDesc(events).filter(
    (e) => e.status === 'failed' || e.status === 'retrying'
  )
}

// ---------------------------------------------------------------------------
// Integration Status
// ---------------------------------------------------------------------------

export async function getIntegrationStatus(): Promise<IntegrationStatusData[]> {
  void await getDataSourceMode()
  return getLiveIntegrationStatus()
}

// ---------------------------------------------------------------------------
// Field Mappings
// ---------------------------------------------------------------------------

export async function getFieldMappings(automation?: string): Promise<FieldMapping[]> {
  void await getDataSourceMode()
  const mappings = await getLiveFieldMappings()

  if (automation && automation !== 'all') {
    return mappings.filter((m) => m.automation === automation)
  }
  return mappings
}

// ---------------------------------------------------------------------------
// Connection Configs
// ---------------------------------------------------------------------------

export async function getConnectionConfigs(): Promise<ConnectionConfig[]> {
  void await getDataSourceMode()
  return getLiveConnectionConfigs()
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function getCustomers(): Promise<Customer[]> {
  void await getDataSourceMode()
  return []
}

// ---------------------------------------------------------------------------
// Sales Analytics
// ---------------------------------------------------------------------------

export async function getSalesLeaderboard(): Promise<SeedSalesRep[]> {
  void await getDataSourceMode()
  const liveReps = await getLiveSalesReps()
  return liveReps.sort((a, b) => b.revenueMTD - a.revenueMTD)
}

export async function getEnhancedSalesReps(): Promise<SeedSalesRep[]> {
  void await getDataSourceMode()
  return getLiveSalesReps()
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
    const [mtdRes, qtdRes, ytdRes] = await Promise.all([
      supabase.from('sf_opportunities').select('amount').eq('owner_sf_id', sfId).eq('is_won', true).gte('close_date', monthStart),
      supabase.from('sf_opportunities').select('amount').eq('owner_sf_id', sfId).eq('is_won', true).gte('close_date', qtrStart),
      supabase.from('sf_opportunities').select('amount').eq('owner_sf_id', sfId).eq('is_won', true).gte('close_date', yearStart),
    ])

    const sum = (rows: AmountRow[] | null | undefined) =>
      (rows ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0)
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
  void await getDataSourceMode()
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

  warnEmptyLiveTable('sf_opportunities', 'pipeline snapshot')
  return []
}

export async function getSalesActivity(limit = 10): Promise<SeedSalesActivity[]> {
  void limit
  void await getDataSourceMode()
  return []
}

export interface QuoteFilters {
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export async function getQuotes(filters: QuoteFilters = {}): Promise<PaginatedResult<SeedQuote>> {
  void await getDataSourceMode()
  return paginate([], filters.page, filters.pageSize)
}

export async function getMonthlyRepRevenue(): Promise<SeedMonthlyRepRevenue[]> {
  void await getDataSourceMode()
  return getLiveMonthlyRepRevenue()
}

export async function getPipelineByRep(): Promise<SeedPipelineByRep[]> {
  void await getDataSourceMode()
  return getLivePipelineByRep()
}

async function getLiveMonthlyRepRevenue(): Promise<SeedMonthlyRepRevenue[]> {
  const supabase = createAdminClient()
  const now = new Date()
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return {
      key,
      label: date.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
    }
  })
  const startDate = `${months[0].key}-01`

  const [oppsRes, usersRes] = await Promise.all([
    supabase
      .from('sf_opportunities')
      .select('owner_sf_id, amount, close_date')
      .eq('is_won', true)
      .gte('close_date', startDate),
    supabase
      .from('sf_users')
      .select('sf_id, name')
      .eq('is_active', true)
      .order('name'),
  ])

  if (oppsRes.error) throw oppsRes.error
  if (usersRes.error) throw usersRes.error
  if (!oppsRes.data || oppsRes.data.length === 0) return []

  const repNamesById = new Map(
    ((usersRes.data ?? []) as LookupNameRow[]).map((user) => [user.sf_id, user.name ?? user.sf_id])
  )
  const rows = months.map(({ label }) => ({ month: label } as SeedMonthlyRepRevenue))

  for (const row of rows) {
    for (const repName of repNamesById.values()) {
      row[repName] = 0
    }
  }

  for (const opp of oppsRes.data as Array<Pick<SfOpportunityRow, 'owner_sf_id' | 'amount' | 'close_date'>>) {
    if (!opp.close_date || !opp.owner_sf_id) continue
    const monthIndex = months.findIndex((month) => opp.close_date?.startsWith(month.key))
    if (monthIndex === -1) continue

    const repName = repNamesById.get(opp.owner_sf_id) ?? opp.owner_sf_id
    rows[monthIndex][repName] = toNumber(rows[monthIndex][repName] as number | string | null) + toNumber(opp.amount)
  }

  return rows
}

function normalizePipelineStage(stageName: string | null): keyof Omit<SeedPipelineByRep, 'repName'> | null {
  const stage = stageName?.toLowerCase() ?? ''
  if (stage.includes('prospect')) return 'Prospecting'
  if (stage.includes('qualif')) return 'Qualification'
  if (stage.includes('proposal') || stage.includes('quote') || stage.includes('price')) return 'Proposal'
  if (stage.includes('negotiat') || stage.includes('review')) return 'Negotiation'
  return null
}

async function getLivePipelineByRep(): Promise<SeedPipelineByRep[]> {
  const supabase = createAdminClient()
  const [oppsRes, usersRes] = await Promise.all([
    supabase
      .from('sf_opportunities')
      .select('owner_sf_id, stage_name, amount')
      .eq('is_closed', false),
    supabase
      .from('sf_users')
      .select('sf_id, name')
      .eq('is_active', true)
      .order('name'),
  ])

  if (oppsRes.error) throw oppsRes.error
  if (usersRes.error) throw usersRes.error
  if (!oppsRes.data || oppsRes.data.length === 0) return []

  const repNamesById = new Map(
    ((usersRes.data ?? []) as LookupNameRow[]).map((user) => [user.sf_id, user.name ?? user.sf_id])
  )
  const byRep = new Map<string, SeedPipelineByRep>()

  for (const opp of oppsRes.data as Array<Pick<SfOpportunityRow, 'owner_sf_id' | 'stage_name' | 'amount'>>) {
    const stage = normalizePipelineStage(opp.stage_name)
    if (!stage) continue

    const repName = opp.owner_sf_id ? repNamesById.get(opp.owner_sf_id) ?? opp.owner_sf_id : 'Unassigned'
    const row = byRep.get(repName) ?? {
      repName,
      Prospecting: 0,
      Qualification: 0,
      Proposal: 0,
      Negotiation: 0,
    }

    row[stage] += toNumber(opp.amount)
    byRep.set(repName, row)
  }

  return Array.from(byRep.values())
    .map((row) => ({
      ...row,
      Prospecting: roundCurrency(row.Prospecting),
      Qualification: roundCurrency(row.Qualification),
      Proposal: roundCurrency(row.Proposal),
      Negotiation: roundCurrency(row.Negotiation),
    }))
    .sort((a, b) => {
      const totalA = a.Prospecting + a.Qualification + a.Proposal + a.Negotiation
      const totalB = b.Prospecting + b.Qualification + b.Proposal + b.Negotiation
      return totalB - totalA
    })
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
  void await getDataSourceMode()
  const reps = await getLiveSalesReps()
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

// ---------------------------------------------------------------------------
// Territory / Geographic
// ---------------------------------------------------------------------------

export async function getCustomersWithLocations(): Promise<Customer[]> {
  void await getDataSourceMode()
  return []
}

export async function getRegionSummaries(): Promise<SeedRegionSummary[]> {
  void await getDataSourceMode()
  return []
}

export async function getCustomersByRegion(region: string): Promise<Customer[]> {
  void region
  void await getDataSourceMode()
  return []
}

export interface ClientMapStats {
  totalClients: number
  activeClients: number
  statesCovered: number
  avgRevenuePerClient: number
}

export async function getClientMapStats(): Promise<ClientMapStats> {
  void await getDataSourceMode()
  return {
    totalClients: 0,
    activeClients: 0,
    statesCovered: 0,
    avgRevenuePerClient: 0,
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
  void await getDataSourceMode()
  return getLiveProfileCalls(filters)
}

async function getLiveProfileCalls(filters: ProfileCallFilters): Promise<PaginatedResult<SeedProfileCall>> {
  const supabase = createAdminClient()
  const { data: calls } = await supabase
    .from('sf_profile_calls')
    .select('*')
    .order('activity_date', { ascending: false })
    .limit(filters.pageSize ?? 50)

  if (!calls || calls.length === 0) {
    warnEmptyLiveTable('sf_profile_calls', 'profile call list')
    return { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }
  }

  // Resolve owner and account names
  const ownerIds = [...new Set(calls.map((c) => c.owner_sf_id).filter(Boolean))]
  const accountIds = [...new Set(calls.map((c) => c.account_sf_id).filter(Boolean))]

  const [usersRes, accountsRes] = await Promise.all([
    ownerIds.length > 0 ? supabase.from('sf_users').select('sf_id, name').in('sf_id', ownerIds) : { data: [] },
    accountIds.length > 0 ? supabase.from('sf_accounts').select('sf_id, name').in('sf_id', accountIds) : { data: [] },
  ])

  const userNames = new Map(
    ((usersRes.data ?? []) as LookupNameRow[]).map((u) => [u.sf_id, u.name])
  )
  const accountNames = new Map(
    ((accountsRes.data ?? []) as LookupNameRow[]).map((a) => [a.sf_id, a.name])
  )

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
  void await getDataSourceMode()
  return getLiveProfileCallMetrics()
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
    warnEmptyLiveTable('sf_profile_calls', 'profile call metrics')
    return { totalMTD: 0, totalLastMonth: lastMonthCount ?? 0, conversionRate: 0, connectRate: 0, avgDuration: 0, byRep: [] }
  }

  // Resolve owner names
  const ownerIds = [...new Set(mtdCalls.map((c) => c.owner_sf_id).filter(Boolean))]
  const { data: users } = await supabase.from('sf_users').select('sf_id, name').in('sf_id', ownerIds)
  const nameMap = new Map(((users ?? []) as LookupNameRow[]).map((u) => [u.sf_id, u.name]))

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
  void await getDataSourceMode()
  const supabase = createAdminClient()
  const now = new Date()
  const weekStarts = Array.from({ length: 8 }, (_, index) => {
    const date = new Date(now)
    date.setDate(now.getDate() - now.getDay() - (7 - index) * 7)
    date.setHours(0, 0, 0, 0)
    return date.toISOString().split('T')[0]
  })
  const startDate = weekStarts[0]

  const [callsRes, usersRes] = await Promise.all([
    supabase
      .from('sf_profile_calls')
      .select('owner_sf_id, activity_date')
      .gte('activity_date', startDate),
    supabase
      .from('sf_users')
      .select('sf_id, name')
      .eq('is_active', true),
  ])

  if (callsRes.error) throw callsRes.error
  if (usersRes.error) throw usersRes.error
  if (!callsRes.data || callsRes.data.length === 0) {
    warnEmptyLiveTable('sf_profile_calls', 'weekly call volume')
    return []
  }

  const userNames = new Map(
    ((usersRes.data ?? []) as LookupNameRow[]).map((user) => [user.sf_id, user.name ?? user.sf_id])
  )
  const rows = weekStarts.map((weekStart) => ({ weekStart } as SeedWeeklyCallVolume))

  for (const row of rows) {
    for (const repName of userNames.values()) {
      row[repName] = 0
    }
  }

  for (const call of callsRes.data as Array<{ owner_sf_id: string | null; activity_date: string | null }>) {
    if (!call.activity_date) continue
    const activityDate = new Date(call.activity_date + 'T00:00:00')
    activityDate.setDate(activityDate.getDate() - activityDate.getDay())
    const weekStart = activityDate.toISOString().split('T')[0]
    const row = rows.find((candidate) => candidate.weekStart === weekStart)
    if (!row) continue

    const repName = call.owner_sf_id ? userNames.get(call.owner_sf_id) ?? call.owner_sf_id : 'Unassigned'
    row[repName] = toNumber(row[repName] as number | string | null) + 1
  }

  return rows
}

export async function getCallOutcomeBreakdown(): Promise<Array<{
  outcome: string
  count: number
  percentage: number
  color: string
}>> {
  void await getDataSourceMode()
  const supabase = createAdminClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const { data: calls } = await supabase
    .from('sf_profile_calls')
    .select('profile_call_outcome')
    .gte('activity_date', monthStart)

  if (!calls || calls.length === 0) {
    warnEmptyLiveTable('sf_profile_calls', 'call outcome breakdown')
    return []
  }

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
    const outcome = call.profile_call_outcome ?? 'Unknown'
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1)
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
  void await getDataSourceMode()
  return getLiveTopKeywords(limit)
}

async function getLiveTopKeywords(limit: number): Promise<KeywordResult[]> {
  const supabase = createAdminClient()
  const { data: calls } = await supabase
    .from('sf_profile_calls')
    .select('sf_id, ringdna_keywords')
    .not('ringdna_keywords', 'is', null)

  if (!calls || calls.length === 0) {
    warnEmptyLiveTable('sf_profile_calls', 'competitor keywords')
    return []
  }

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
