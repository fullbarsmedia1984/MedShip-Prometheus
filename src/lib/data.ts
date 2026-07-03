// =============================================================================
// Data Access Layer
// Dashboard reads live Salesforce/Fishbowl cache only. Seed data remains typed
// fixture data, but user-facing dashboard modules must not fall back to it.
// =============================================================================

import 'server-only'

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
  scope?: 'business' | 'all'
  page?: number
  pageSize?: number
  includeItems?: boolean
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
  includePayload?: boolean
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

function normalizeRingDnaDirection(direction: string | null): 'Inbound' | 'Outbound' {
  return direction === 'Inbound' ? 'Inbound' : 'Outbound'
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

type SupabaseRangeQuery<T> = {
  range(from: number, to: number): PromiseLike<{
    data: T[] | null
    error: unknown
  }>
}

const PAGE_FETCH_SIZE = 1000
export const SALES_DASHBOARD_CACHE_TAG = 'sales-dashboard'
const ACTUAL_RINGDNA_CALL_FILTER = [
  'ringdna_start_time.not.is.null',
  'ringdna_duration_min.gt.0',
  'ringdna_connected.eq.true',
  'ringdna_voicemail.eq.true',
  'ringdna_rating.not.is.null',
  'ringdna_disposition.not.is.null',
].join(',')
const LIVE_AUTOMATIONS = new Set<AutomationType>([
  'SF_FULL_SYNC',
  'SF_INCREMENTAL_SYNC',
  'P1_OPP_TO_SO',
  'P2_INVENTORY_SYNC',
  'P7_FB_SO_SYNC',
])

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

type SfCallActivityRow = {
  sf_id: string
  activity_type: string
  owner_sf_id: string | null
  activity_date: string | null
  created_date: string | null
  last_modified_date: string | null
  task_subtype: string | null
  call_type: string | null
  call_disposition: string | null
  profile_call_type: string | null
  profile_call_outcome: string | null
  products_discussed: string | null
  program_size: string | null
  budget_timeframe: string | null
  follow_up_date: string | null
  converted_to_opp: boolean | null
  related_opportunity_sf_id: string | null
  ringdna_direction: string | null
  ringdna_duration_min: number | string | null
  ringdna_connected: boolean | null
  ringdna_rating: number | string | null
  ringdna_voicemail: boolean | null
  ringdna_keywords: string | null
  ringdna_start_time: string | null
  ringdna_disposition: string | null
  calendly_no_show: boolean | null
  calendly_rescheduled: boolean | null
}

type CanonicalSalesOrderRow = {
  id: string
  so_number: string
  status: string
  customer_name: string | null
  customer_id: string | null
  salesperson: string | null
  date_created: string | null
  date_scheduled: string | null
  date_issued: string | null
  date_completed: string | null
  total_amount: number | string | null
  subtotal_amount: number | string | null
  sf_opportunity_id: string | null
  canonical_state: 'quote' | 'order' | 'void' | 'unknown'
  business_classification: 'new_business' | 'recurring_business' | null
  prior_issued_so_number: string | null
  prior_issued_order_at: string | null
  last_synced_at: string | null
  data_quality_flags: string[] | null
}

type FishbowlSalespersonAliasRow = {
  fishbowl_salesperson: string
  sf_user_id: string | null
  display_name: string
  team: string | null
  is_active: boolean | null
  is_house_account: boolean | null
  is_system_alias: boolean | null
  show_on_sales_dashboard: boolean | null
  dashboard_sort_order: number | null
}

type CanonicalSalesOrderItemRow = {
  id: string
  sales_order_number: string
  part_number: string | null
  part_description: string | null
  sf_product_id: string | null
  quantity: number | string | null
  unit_price: number | string | null
  total_price: number | string | null
}

const STALE_QUOTE_DAYS = 365
const QUALITY_LIKELY_TEST = 'likely_test'
const QUALITY_INCOMPLETE_LINES = 'missing_line_items'
const QUALITY_ZERO_VALUE = 'zero_value'
const QUALITY_HISTORICAL = 'historical'
const QUALITY_UNKNOWN_STATE = 'unknown_state'
const TEST_RECORD_PATTERN = /(^|\b)(test|testing|do not use|sample|warehouse)/i
const SALES_ORDER_HEADER_SELECT = 'id, so_number, status, customer_name, customer_id, salesperson, date_created, date_scheduled, date_issued, date_completed, total_amount, subtotal_amount, sf_opportunity_id, canonical_state, business_classification, prior_issued_so_number, prior_issued_order_at, last_synced_at, data_quality_flags'
const SALES_ORDER_METRIC_SELECT = 'id, so_number, status, customer_name, customer_id, salesperson, date_created, date_scheduled, date_issued, date_completed, total_amount, subtotal_amount, sf_opportunity_id, canonical_state, business_classification, prior_issued_so_number, prior_issued_order_at, last_synced_at, data_quality_flags'

export interface SalesRepPerformance extends SeedSalesRep {
  fishbowlAliases: string[]
  mappingStatus: 'mapped' | 'unmapped' | 'house' | 'system'
  sourceLabel: 'Fishbowl SO'
  newBusinessRevenueMTD: number
  newBusinessRevenueQTD: number
  newBusinessRevenueYTD: number
  recurringBusinessRevenueMTD: number
  recurringBusinessRevenueQTD: number
  recurringBusinessRevenueYTD: number
  newBusinessOrdersMTD: number
  recurringBusinessOrdersMTD: number
  newBusinessOrdersYTD: number
  recurringBusinessOrdersYTD: number
  quoteValueMTD: number
  quoteValueQTD: number
  quoteValueYTD: number
  ordersYTD: number
  quotesYTD: number
  lastFishbowlActivityAt: string | null
}

export interface SalesAliasGap {
  alias: string
  displayName: string
  status: 'unmapped' | 'house' | 'system'
  ordersYTD: number
  quotesYTD: number
  revenueYTD: number
  latestActivityAt: string | null
}

export interface SalesRosterOption {
  fishbowlSalesperson: string
  displayName: string
  sfUserId: string | null
  team: string | null
  isSelected: boolean
  sortOrder: number | null
  latestActivityAt: string | null
}

export interface SalesDataHealth {
  revenueSource: 'fishbowl_sales_orders'
  pipelineSource: 'salesforce_opportunities'
  latestFishbowlOrderDate: string | null
  latestFishbowlQuoteDate: string | null
  fishbowlOrderFreshnessDays: number | null
  isFishbowlOrderStale: boolean
  mappedAliasCount: number
  unmappedAliasCount: number
  houseAliasCount: number
  systemAliasCount: number
  unmappedAliases: SalesAliasGap[]
  houseAndSystemAliases: SalesAliasGap[]
  linkedSalesOrders: number
  unlinkedSalesOrders: number
  linkCoverage: number
  linkRows: number
  newBusinessDefinition: string
  activeMetricPeriodLabel: string
  activeMetricPeriodStart: string
  activeMetricPeriodEnd: string
  isMetricPeriodFallback: boolean
  rosterOptions: SalesRosterOption[]
}

export interface SalesDashboardCore {
  kpis: SalesKpis
  reps: SalesRepPerformance[]
  monthlyRevenue: SeedMonthlyRepRevenue[]
  salesHealth: SalesDataHealth
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

async function fetchAllRows<T>(
  buildQuery: () => SupabaseRangeQuery<T>,
  pageSize = PAGE_FETCH_SIZE
): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await buildQuery().range(from, to)
    if (error) throw error

    const batch = data ?? []
    rows.push(...batch)

    if (batch.length < pageSize) break
  }

  return rows
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

function isEventTelemetry(event: SyncEvent): boolean {
  return Boolean(
    event.payload?.circuitBreaker ||
      (event.source_system === 'prometheus' && event.target_system === 'inngest') ||
      event.status === 'dismissed' ||
      event.status === 'pending'
  )
}

function getEventKpisFromEvents(events: SyncEvent[], today: string): EventKpis {
  const total = events.length
  const outcomeEvents = events.filter((e) => !isEventTelemetry(e) && (e.status === 'success' || e.status === 'failed'))
  const successes = outcomeEvents.filter((e) => e.status === 'success').length
  const successRate = outcomeEvents.length > 0
    ? Math.round((successes / outcomeEvents.length) * 1000) / 10
    : 0

  const completed = events.filter((e) => e.completed_at && !isEventTelemetry(e))
  const totalDuration = completed.reduce((sum, e) => {
    const dur = new Date(e.completed_at!).getTime() - new Date(e.created_at).getTime()
    return sum + Math.max(dur, 0)
  }, 0)
  const avgDurationMs = completed.length > 0 ? Math.round(totalDuration / completed.length) : 0

  const failuresToday = events.filter(
    (e) => !isEventTelemetry(e) && e.status === 'failed' && e.created_at.startsWith(today)
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

function daysSince(dateValue: string | null | undefined): number | null {
  if (!dateValue) return null
  const time = new Date(dateValue).getTime()
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000))
}

function hasTestMarker(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => Boolean(value && TEST_RECORD_PATTERN.test(value)))
}

function salesOrderQualityFlags(input: {
  soNumber: string
  customerName: string | null
  salesperson: string | null
  amount: number
  lineItemCount: number
  quoteDaysOpen?: number | null
}): string[] {
  const flags = new Set<string>()

  if (hasTestMarker(input.soNumber, input.customerName, input.salesperson)) {
    flags.add(QUALITY_LIKELY_TEST)
  }
  if (input.lineItemCount === 0) {
    flags.add(QUALITY_INCOMPLETE_LINES)
  }
  if (input.amount <= 0) {
    flags.add(QUALITY_ZERO_VALUE)
  }
  if (input.quoteDaysOpen !== undefined && input.quoteDaysOpen !== null && input.quoteDaysOpen > STALE_QUOTE_DAYS) {
    flags.add(QUALITY_HISTORICAL)
  }

  return [...flags]
}

function getSalesOrderFlags(
  row: CanonicalSalesOrderRow,
  amount: number,
  lineItemCount: number,
  quoteDaysOpen?: number | null
) {
  if (Array.isArray(row.data_quality_flags) && row.data_quality_flags.length > 0) {
    return row.data_quality_flags
  }

  return salesOrderQualityFlags({
    soNumber: row.so_number,
    customerName: row.customer_name,
    salesperson: row.salesperson,
    amount,
    lineItemCount,
    quoteDaysOpen,
  })
}

function warnEmptyLiveTable(tableName: string, surface: string): void {
  console.warn(`${tableName} returned no live rows; ${surface} is returning an empty live result`)
}

function isMissingRelationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('42P01') || message.toLowerCase().includes('could not find the table')
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

  const inventory = await fetchAllRows<InventorySnapshotRow>(() =>
    supabase
      .from('inventory_snapshot')
      .select('id, part_number, part_description, qty_on_hand, qty_allocated, qty_available, uom, location, fishbowl_part_id, last_synced_at, sf_product_id')
      .order('part_number') as unknown as SupabaseRangeQuery<InventorySnapshotRow>
  )

  if (!inventory || inventory.length === 0) {
    warnEmptyLiveTable('inventory_snapshot', 'inventory')
    return []
  }

  let reorderRules: ReorderRuleRow[] = []

  try {
    reorderRules = await fetchAllRows<ReorderRuleRow>(() =>
      supabase
        .from('reorder_rules')
        .select('part_number, reorder_point, is_active') as unknown as SupabaseRangeQuery<ReorderRuleRow>
    )
  } catch (error) {
    console.warn('Live reorder rules query failed; using product metadata defaults:', error)
  }

  const rulesByPart = new Map(
    reorderRules
      .filter((rule) => rule.is_active !== false)
      .map((rule) => [rule.part_number, toNumber(rule.reorder_point)])
  )
  return inventory.map((row) => {
    const reorderPoint = rulesByPart.get(row.part_number) ?? 0
    return mapInventorySnapshotToProduct(row, reorderPoint)
  })
}

async function getLiveSyncEvents(limit = 1000): Promise<SyncEvent[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sync_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as SyncEvent[]
}

async function getLiveSyncEventsSince(since: string): Promise<SyncEvent[]> {
  const supabase = createAdminClient()
  return fetchAllRows<SyncEvent>(() =>
    supabase
      .from('sync_events')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false }) as unknown as SupabaseRangeQuery<SyncEvent>
  )
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

function isIntegrationOutcomeEvent(event: SyncEvent): boolean {
  return !isEventTelemetry(event) && (event.status === 'success' || event.status === 'failed')
}

function buildLast7Days(events: SyncEvent[]): { date: string; success: number; failed: number }[] {
  const now = new Date()
  const days: { date: string; success: number; failed: number }[] = []

  for (let offset = 6; offset >= 0; offset--) {
    const day = new Date(now)
    day.setDate(now.getDate() - offset)
    const date = day.toISOString().slice(0, 10)
    const dayEvents = events.filter((event) => event.created_at.startsWith(date) && isIntegrationOutcomeEvent(event))
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
  const outcomeEvents = events.filter(isIntegrationOutcomeEvent)

  if (!schedule && events.length === 0) return 'warning'
  if (schedule?.is_active === false) return 'warning'
  if (schedule?.last_run_status === 'failed') return 'error'
  if (schedule?.last_run_status === 'partial') return 'warning'
  if (schedule?.last_run_status && schedule.last_run_status !== 'success') return 'warning'
  if (outcomeEvents.some((event) => event.status === 'failed' && event.retry_count >= event.max_retries)) {
    return 'error'
  }
  if (outcomeEvents.some((event) => event.status === 'failed')) {
    return 'warning'
  }
  if (outcomeEvents.length > 0 && successRate < 80) return 'error'
  if (outcomeEvents.length > 0 && successRate < 95) return 'warning'
  return 'healthy'
}

async function getLiveIntegrationStatus(): Promise<IntegrationStatusData[]> {
  const supabase = createAdminClient()
  const { data: schedules, error } = await supabase
    .from('sync_schedules')
    .select('*')
    .order('automation')

  if (error) throw error

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6)
  sevenDaysAgo.setUTCHours(0, 0, 0, 0)

  const events = await getLiveSyncEventsSince(sevenDaysAgo.toISOString())
  if ((!schedules || schedules.length === 0) && events.length === 0) return []

  const scheduleRows = ((schedules ?? []) as SyncScheduleRow[])
  const schedulesByAutomation = new Map(
    scheduleRows.map((schedule) => [schedule.automation, schedule])
  )
  const automationSet = new Set<AutomationType>([
    ...scheduleRows.map((schedule) => schedule.automation),
    ...events.map((event) => event.automation),
  ])

  return Array.from(automationSet).map((automation) => {
    const schedule = schedulesByAutomation.get(automation)
    const automationEvents = sortByCreatedDesc(events.filter((event) => event.automation === automation))
    const completed = automationEvents.filter(isIntegrationOutcomeEvent)
    const latestEvent = completed[0] ?? automationEvents[0]
    const successful = completed.filter((event) => event.status === 'success').length
    const successRate = completed.length > 0
      ? Math.round((successful / completed.length) * 1000) / 10
      : schedule?.last_run_status === 'success'
        ? 100
        : 0
    const info = AUTOMATION_INFO[automation]
    const hasObservedData = Boolean(schedule || latestEvent)
    const isComingSoon = !LIVE_AUTOMATIONS.has(automation)

    return {
      automation,
      name: info?.name ?? automation,
      description: info?.description ?? 'Integration automation',
      status: isComingSoon ? 'warning' : getIntegrationHealth(schedule, automationEvents, successRate),
      lastRunAt: isComingSoon ? '' : schedule?.last_run_at ?? latestEvent?.created_at ?? '',
      lastRunDurationMs: isComingSoon ? 0 : schedule?.last_run_duration_ms ?? getEventDurationMs(latestEvent),
      recordsProcessed: isComingSoon ? 0 : schedule?.records_processed ?? completed.length,
      successRate: isComingSoon ? 0 : successRate,
      schedule: schedule
        ? cronToScheduleLabel(schedule.cron_expression)
        : latestEvent
          ? 'Event-driven'
          : 'Not scheduled',
      isActive: isComingSoon ? false : schedule?.is_active ?? hasObservedData,
      last7Days: isComingSoon ? [] : buildLast7Days(automationEvents),
      isComingSoon,
      observedEvents: automationEvents.length,
      hasLiveSchedule: Boolean(schedule),
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
  const scope = filters.scope ?? 'business'

  if (scope !== 'all') {
    filtered = filtered.filter((order) => {
      const flags = order.dataQualityFlags ?? []
      return !flags.includes(QUALITY_LIKELY_TEST) && !flags.includes(QUALITY_INCOMPLETE_LINES)
    })
  }

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

function mapFishbowlOrderStatus(status: string): Order['status'] {
  const normalized = status.toLowerCase()
  if (['completed', 'fulfilled', 'closed', 'delivered'].includes(normalized)) return 'Delivered'
  if (['issued', 'in progress', 'partial'].includes(normalized)) return 'Pending'
  if (['shipped'].includes(normalized)) return 'Shipped'
  if (['void', 'voided', 'cancelled', 'canceled'].includes(normalized)) return 'Cancelled'
  return 'Pending'
}

async function fetchSalesOrderItemsForNumbers(
  orderNumbers: string[]
): Promise<Map<string, OrderItem[]>> {
  const supabase = createAdminClient()
  const uniqueOrderNumbers = [...new Set(orderNumbers.filter(Boolean))]
  const itemsByOrder = new Map<string, OrderItem[]>()

  for (let index = 0; index < uniqueOrderNumbers.length; index += 100) {
    const chunk = uniqueOrderNumbers.slice(index, index + 100)
    const { data, error } = await supabase
      .from('fb_sales_order_items')
      .select('id, sales_order_number, part_number, part_description, sf_product_id, quantity, unit_price, total_price')
      .in('sales_order_number', chunk)
      .order('line_number', { ascending: true })

    if (error) throw error

    for (const item of (data ?? []) as CanonicalSalesOrderItemRow[]) {
      const items = itemsByOrder.get(item.sales_order_number) ?? []
      const quantity = toNumber(item.quantity)
      const unitPrice = toNumber(item.unit_price)
      const total = toNumber(item.total_price) || quantity * unitPrice
      items.push({
        productId: item.sf_product_id ?? item.part_number ?? item.id,
        productName: item.part_description ?? item.part_number ?? 'Unknown Product',
        sku: item.part_number ?? '',
        quantity,
        unitPrice: roundCurrency(unitPrice),
        total: roundCurrency(total),
      })
      itemsByOrder.set(item.sales_order_number, items)
    }
  }

  return itemsByOrder
}

async function getLiveOrderRows(): Promise<CanonicalSalesOrderRow[]> {
  const supabase = createAdminClient()
  return fetchAllRows<CanonicalSalesOrderRow>(() =>
    supabase
      .from('canonical_orders')
      .select(SALES_ORDER_HEADER_SELECT)
      .order('date_issued', { ascending: false, nullsFirst: false }) as unknown as SupabaseRangeQuery<CanonicalSalesOrderRow>
  ).catch((error) => {
      if (isMissingRelationError(error)) {
        warnEmptyLiveTable('canonical_orders', 'orders')
        return []
      }
      throw error
    })
}

function mapCanonicalOrderRow(
  row: CanonicalSalesOrderRow,
  items: OrderItem[] = []
): Order {
    const subtotal = toNumber(row.subtotal_amount) ||
      toNumber(row.total_amount) ||
      items.reduce((sum, item) => sum + item.total, 0)
    const date = row.date_issued ?? row.date_created ?? row.last_synced_at ?? new Date().toISOString()
    const flags = getSalesOrderFlags(row, subtotal, items.length)

    return {
      id: row.id,
      orderNumber: row.so_number,
      customerId: row.customer_id ?? '',
      customerName: row.customer_name ?? 'Unknown Customer',
      salesRepId: row.salesperson ?? '',
      salesRepName: row.salesperson ?? 'Unassigned',
      date: date.split('T')[0],
      status: mapFishbowlOrderStatus(row.status),
      fulfillmentStatus: 'Synced',
      trackingNumber: undefined,
      items,
      subtotal: roundCurrency(subtotal),
      sourceStatus: row.status,
      dataQualityFlags: flags,
      lineItemCount: items.length,
    }
}

async function getLiveOrders(): Promise<Order[]> {
  const orderRows = await getLiveOrderRows()
  return orderRows.map((row) => mapCanonicalOrderRow(row))
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
  const orderRows = await getLiveOrderRows()
  const headerOrders = orderRows.map((row) => mapCanonicalOrderRow(row))
  const filteredOrders = applyOrderFilters(headerOrders, filters)
  const paginated = paginate(filteredOrders, filters.page, filters.pageSize)

  if (filters.includeItems === false || paginated.data.length === 0) {
    return paginated
  }

  const itemsByOrder = await fetchSalesOrderItemsForNumbers(
    paginated.data.map((order) => order.orderNumber)
  ).catch((error) => {
    console.warn('Live Fishbowl sales order item page query failed; orders will use header totals only:', error)
    return new Map<string, OrderItem[]>()
  })
  const rowsByOrderNumber = new Map(orderRows.map((row) => [row.so_number, row]))

  return {
    ...paginated,
    data: paginated.data.map((order) => {
      const row = rowsByOrderNumber.get(order.orderNumber)
      if (!row) return order
      return mapCanonicalOrderRow(row, itemsByOrder.get(order.orderNumber) ?? [])
    }),
  }
}

export async function getOrderById(id: string): Promise<Order | null> {
  void await getDataSourceMode()
  const decodedId = decodeURIComponent(id)
  const orderRows = await getLiveOrderRows()
  const row = orderRows.find((order) => order.id === decodedId || order.so_number === decodedId)
  if (!row) return null

  const itemsByOrder = await fetchSalesOrderItemsForNumbers([row.so_number]).catch((error) => {
    console.warn('Live Fishbowl sales order item detail query failed; order will use header totals only:', error)
    return new Map<string, OrderItem[]>()
  })

  return mapCanonicalOrderRow(row, itemsByOrder.get(row.so_number) ?? [])
}

export async function getRecentOrders(limit = 10): Promise<Order[]> {
  void await getDataSourceMode()
  const result = await getOrders({ page: 1, pageSize: limit })
  return result.data
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
  const supabase = createAdminClient()
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(Math.max(1, filters.pageSize ?? 25), 100)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const columns = filters.includePayload === false
    ? 'id,created_at,automation,source_system,target_system,source_record_id,target_record_id,status,error_message,retry_count,max_retries,next_retry_at,completed_at,idempotency_key'
    : '*'

  let query = supabase
    .from('sync_events')
    .select(columns, { count: 'estimated' })
    .order('created_at', { ascending: false })

  if (filters.automation && filters.automation !== 'all') {
    query = query.eq('automation', filters.automation)
  }
  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }
  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom)
  }
  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo)
  }
  if (filters.search) {
    const search = filters.search.replace(/[%*,]/g, '').trim()
    if (search) {
      query = query.or(
        `source_record_id.ilike.%${search}%,target_record_id.ilike.%${search}%,error_message.ilike.%${search}%`
      )
    }
  }

  const { data, count, error } = await query.range(from, to)
  if (error) throw error

  return {
    data: (data ?? []) as unknown as SyncEvent[],
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  }
}

export interface EventKpis {
  total: number
  successRate: number
  avgDurationMs: number
  failuresToday: number
}

export async function getEventKpis(filters: EventFilters = {}): Promise<EventKpis> {
  void await getDataSourceMode()
  const events = await getLiveSyncEvents(1000)
  const items = applyEventFilters(events, filters)
  return getEventKpisFromEvents(items, new Date().toISOString().slice(0, 10))
}

// ---------------------------------------------------------------------------
// Failed Syncs
// ---------------------------------------------------------------------------

export async function getFailedSyncs(): Promise<SyncEvent[]> {
  void await getDataSourceMode()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sync_events')
    .select('*')
    .in('status', ['failed', 'retrying'])
    .order('created_at', { ascending: false })
    .limit(250)

  if (error) throw error

  return (data ?? []) as SyncEvent[]
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

function getSalesPeriodStarts(now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const qtrStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().split('T')[0]
  const yearStart = `${now.getFullYear()}-01-01`
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
  const monthlyStart = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().split('T')[0]
  return { monthStart, qtrStart, yearStart, lastMonthStart, monthlyStart }
}

const REP_COLORS = ['#1E98D5', '#0FA62C', '#1C3C6E', '#A0007E', '#E89C0C', '#D93025', '#B5C8CD', '#3AACE3']

function colorFromId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return REP_COLORS[Math.abs(hash) % REP_COLORS.length]
}

function salesOrderMetricDate(row: CanonicalSalesOrderRow): string | null {
  return row.date_issued ?? row.date_completed ?? row.date_created ?? row.last_synced_at ?? null
}

function isOnOrAfter(dateValue: string | null, startDate: string): boolean {
  return Boolean(dateValue && dateValue >= startDate)
}

function isWithinPeriod(dateValue: string | null, startDate: string, endDate: string): boolean {
  return Boolean(dateValue && dateValue >= startDate && dateValue < endDate)
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDateKey(value: string): Date {
  return new Date(`${value}T00:00:00`)
}

function weekStartKey(value: string): string {
  const date = parseDateKey(value)
  date.setDate(date.getDate() - date.getDay())
  return dateKey(date)
}

function monthStartKey(value: string): string {
  const date = parseDateKey(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function todayActivityDateKey(): string {
  return dateKey(new Date())
}

function monthPeriodForDate(dateValue: string | null, fallbackNow = new Date()) {
  const date = dateValue ? new Date(dateValue) : fallbackNow
  const safeDate = Number.isNaN(date.getTime()) ? fallbackNow : date
  const start = new Date(safeDate.getFullYear(), safeDate.getMonth(), 1)
  const end = new Date(safeDate.getFullYear(), safeDate.getMonth() + 1, 1)
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
    label: safeDate.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
  }
}

function salesOrderAmount(row: CanonicalSalesOrderRow): number {
  return roundCurrency(toNumber(row.total_amount) || toNumber(row.subtotal_amount))
}

function salesOrderBusinessClassification(row: CanonicalSalesOrderRow): 'new_business' | 'recurring_business' | null {
  if (row.canonical_state !== 'order') return null
  if (row.business_classification === 'new_business' || row.business_classification === 'recurring_business') {
    return row.business_classification
  }
  return null
}

function metricFlags(row: CanonicalSalesOrderRow, amount: number): Set<string> {
  const flags = new Set(row.data_quality_flags ?? [])
  if (hasTestMarker(row.so_number, row.customer_name, row.salesperson)) flags.add(QUALITY_LIKELY_TEST)
  if (amount <= 0) flags.add(QUALITY_ZERO_VALUE)
  if (row.canonical_state === 'unknown') flags.add(QUALITY_UNKNOWN_STATE)
  return flags
}

function isBusinessSalesMetric(row: CanonicalSalesOrderRow, amount: number): boolean {
  const flags = metricFlags(row, amount)
  return !flags.has(QUALITY_LIKELY_TEST) &&
    !flags.has(QUALITY_ZERO_VALUE) &&
    !flags.has(QUALITY_UNKNOWN_STATE) &&
    row.canonical_state !== 'void'
}

function aliasKey(alias: string | null | undefined): string {
  return (alias ?? 'Unassigned').trim().toLowerCase()
}

function defaultAliasMappingRows(): FishbowlSalespersonAliasRow[] {
  return [
    { fishbowl_salesperson: 'MikeF', sf_user_id: '0052E00000Ip9EmQAJ', display_name: 'Mike Franzese', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: true, dashboard_sort_order: 10 },
    { fishbowl_salesperson: 'Leo', sf_user_id: '0052E00000JxFvcQAF', display_name: 'Leo Joanidhi', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: true, dashboard_sort_order: 50 },
    { fishbowl_salesperson: 'selliott', sf_user_id: '0052E00000NdGDeQAN', display_name: 'Samantha Elliott', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: true, dashboard_sort_order: 30 },
    { fishbowl_salesperson: 'Samantha', sf_user_id: '0052E00000NdGDeQAN', display_name: 'Samantha Elliott', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: true, dashboard_sort_order: 31 },
    { fishbowl_salesperson: 'dtorres', sf_user_id: '0052E00000M1qRMQAZ', display_name: 'Danny Torres', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: true, dashboard_sort_order: 20 },
    { fishbowl_salesperson: 'Dan', sf_user_id: '0052E00000Hlo1lQAB', display_name: 'Dan Micic', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: false, dashboard_sort_order: null },
    { fishbowl_salesperson: 'svasic', sf_user_id: '0052E00000Ip9DhQAJ', display_name: 'Stefan Vasic', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: true, dashboard_sort_order: 40 },
    { fishbowl_salesperson: 'kbugarski', sf_user_id: '0052E00000Kuuj8QAB', display_name: 'Kristina Bugarski', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: false, dashboard_sort_order: null },
    { fishbowl_salesperson: 'Christine', sf_user_id: '0052E00000M1j73QAB', display_name: 'Christine Livingstone', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: false, dashboard_sort_order: null },
    { fishbowl_salesperson: 'Nikola', sf_user_id: '005Ua00000EnNsTIAV', display_name: 'Nikola Kovilic', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: false, dashboard_sort_order: null },
    { fishbowl_salesperson: 'kdedvukaj', sf_user_id: '005Ua000008QA96IAG', display_name: 'Kendall Cook', team: 'Sales', is_active: true, is_house_account: false, is_system_alias: false, show_on_sales_dashboard: false, dashboard_sort_order: null },
    { fishbowl_salesperson: 'admin', sf_user_id: null, display_name: 'Fishbowl Admin / Legacy', team: 'System', is_active: true, is_house_account: false, is_system_alias: true, show_on_sales_dashboard: false, dashboard_sort_order: null },
    { fishbowl_salesperson: 'MedShip', sf_user_id: null, display_name: 'Medical Shipment House Account', team: 'House', is_active: true, is_house_account: true, is_system_alias: false, show_on_sales_dashboard: false, dashboard_sort_order: null },
    { fishbowl_salesperson: 'House Account', sf_user_id: null, display_name: 'House Account', team: 'House', is_active: true, is_house_account: true, is_system_alias: false, show_on_sales_dashboard: false, dashboard_sort_order: null },
    { fishbowl_salesperson: 'Warehouse', sf_user_id: null, display_name: 'Warehouse', team: 'System', is_active: true, is_house_account: false, is_system_alias: true, show_on_sales_dashboard: false, dashboard_sort_order: null },
  ]
}

async function getFishbowlSalespersonMappings() {
  const supabase = createAdminClient()
  return fetchAllRows<FishbowlSalespersonAliasRow>(() =>
    supabase
      .from('fishbowl_salesperson_aliases')
      .select('fishbowl_salesperson, sf_user_id, display_name, team, is_active, is_house_account, is_system_alias, show_on_sales_dashboard, dashboard_sort_order')
      .eq('is_active', true)
      .order('dashboard_sort_order', { ascending: true, nullsFirst: false })
      .order('display_name') as unknown as SupabaseRangeQuery<FishbowlSalespersonAliasRow>
  ).catch((error) => {
    if (isMissingRelationError(error)) return defaultAliasMappingRows()
    throw error
  })
}

function createEmptySalesRep(input: {
  id: string
  name: string
  email?: string
  team?: string | null
  mappingStatus: SalesRepPerformance['mappingStatus']
}): SalesRepPerformance {
  return {
    id: input.id,
    name: input.name,
    email: input.email ?? '',
    region: input.team ?? '',
    color: colorFromId(input.id),
    revenueMTD: 0,
    revenueQTD: 0,
    revenueYTD: 0,
    dealsClosed: 0,
    dealsLost: 0,
    quotesSent: 0,
    profileCalls: 0,
    profileCallsChange: 0,
    connectRate: 0,
    avgDealSize: 0,
    avgDaysToClose: 0,
    pipelineValue: 0,
    winRate: 0,
    activityScore: 'cold',
    fishbowlAliases: [],
    mappingStatus: input.mappingStatus,
    sourceLabel: 'Fishbowl SO',
    newBusinessRevenueMTD: 0,
    newBusinessRevenueQTD: 0,
    newBusinessRevenueYTD: 0,
    recurringBusinessRevenueMTD: 0,
    recurringBusinessRevenueQTD: 0,
    recurringBusinessRevenueYTD: 0,
    newBusinessOrdersMTD: 0,
    recurringBusinessOrdersMTD: 0,
    newBusinessOrdersYTD: 0,
    recurringBusinessOrdersYTD: 0,
    quoteValueMTD: 0,
    quoteValueQTD: 0,
    quoteValueYTD: 0,
    ordersYTD: 0,
    quotesYTD: 0,
    lastFishbowlActivityAt: null,
  }
}

async function getOperationalSalesDashboardCore(): Promise<SalesDashboardCore> {
  const supabase = createAdminClient()
  const now = new Date()
  const { monthStart, qtrStart, yearStart, lastMonthStart, monthlyStart } = getSalesPeriodStarts(now)
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return {
      key,
      label: date.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
    }
  })
  const metricQueryStart = [yearStart, monthlyStart].sort()[0]

  const [usersRes, mappings, orderRows, pipelineRes, callActivitiesRes, linkRowsRes] = await Promise.all([
    supabase.from('sf_users').select('sf_id, name, email').eq('is_active', true),
    getFishbowlSalespersonMappings(),
    fetchAllRows<CanonicalSalesOrderRow>(() =>
      supabase
        .from('fb_sales_orders')
        .select(SALES_ORDER_METRIC_SELECT)
        .in('canonical_state', ['order', 'quote'])
        .or(`date_issued.gte.${metricQueryStart},date_completed.gte.${metricQueryStart},date_created.gte.${metricQueryStart}`)
        .order('date_created', { ascending: false, nullsFirst: false }) as unknown as SupabaseRangeQuery<CanonicalSalesOrderRow>
    ),
    supabase.from('sf_opportunities').select('owner_sf_id, amount').eq('is_closed', false),
    supabase
      .from('sf_call_activities')
      .select('owner_sf_id, ringdna_connected, activity_date')
      .gte('activity_date', lastMonthStart)
      .lte('activity_date', todayActivityDateKey())
      .or(ACTUAL_RINGDNA_CALL_FILTER),
    supabase.from('opportunity_sales_order_links').select('*', { count: 'estimated', head: true }),
  ])

  if (usersRes.error) throw usersRes.error
  if (pipelineRes.error) throw pipelineRes.error
  if (callActivitiesRes.error && !isMissingRelationError(callActivitiesRes.error)) throw callActivitiesRes.error
  if (linkRowsRes.error && !isMissingRelationError(linkRowsRes.error)) throw linkRowsRes.error

  const usersById = new Map(((usersRes.data ?? []) as SfUserRow[]).map((user) => [user.sf_id, user]))
  const mappingsByAlias = new Map(mappings.map((row) => [aliasKey(row.fishbowl_salesperson), row]))
  const selectedDashboardAliases = new Set(
    mappings
      .filter((row) => row.show_on_sales_dashboard && !row.is_house_account && !row.is_system_alias)
      .map((row) => aliasKey(row.fishbowl_salesperson))
  )
  const selectedDashboardUserIds = new Set(
    mappings
      .filter((row) => row.show_on_sales_dashboard && row.sf_user_id && !row.is_house_account && !row.is_system_alias)
      .map((row) => row.sf_user_id as string)
  )
  const repsById = new Map<string, SalesRepPerformance>()
  const aliasStats = new Map<string, SalesAliasGap>()
  const latestActivityByAlias = new Map<string, string>()
  const monthlyRows = months.map(({ label }) => ({ month: label } as SeedMonthlyRepRevenue))
  const pipelineByOwner = new Map<string, number>()
  const callStatsByOwner = new Map<string, { mtd: number; lastMonth: number; connected: number }>()

  for (const opp of (pipelineRes.data ?? []) as Array<Pick<SfOpportunityRow, 'owner_sf_id' | 'amount'>>) {
    if (!opp.owner_sf_id) continue
    pipelineByOwner.set(opp.owner_sf_id, (pipelineByOwner.get(opp.owner_sf_id) ?? 0) + toNumber(opp.amount))
  }

  for (const call of (callActivitiesRes.data ?? []) as Array<{ owner_sf_id: string | null; ringdna_connected: boolean | null; activity_date: string | null }>) {
    if (!call.owner_sf_id || !call.activity_date) continue
    const stats = callStatsByOwner.get(call.owner_sf_id) ?? { mtd: 0, lastMonth: 0, connected: 0 }
    if (call.activity_date >= monthStart) {
      stats.mtd++
      if (call.ringdna_connected) stats.connected++
    } else if (call.activity_date >= lastMonthStart) {
      stats.lastMonth++
    }
    callStatsByOwner.set(call.owner_sf_id, stats)
  }

  const kpis: SalesKpis = {
    revenueMTD: 0,
    revenueQTD: 0,
    revenueYTD: 0,
    newBusinessRevenueMTD: 0,
    newBusinessRevenueQTD: 0,
    newBusinessRevenueYTD: 0,
    recurringBusinessRevenueMTD: 0,
    recurringBusinessRevenueQTD: 0,
    recurringBusinessRevenueYTD: 0,
    newBusinessOrdersMTD: 0,
    recurringBusinessOrdersMTD: 0,
    newBusinessMixMTD: 0,
    quotesSentMTD: 0,
    dealsClosedMTD: 0,
    avgDaysToClose: 0,
    pipelineValue: 0,
  }

  let latestFishbowlOrderDate: string | null = null
  let latestFishbowlQuoteDate: string | null = null
  let linkedSalesOrders = 0
  let totalBusinessSalesOrders = 0
  const businessRows = orderRows
    .map((row) => ({ row, amount: salesOrderAmount(row), metricDate: salesOrderMetricDate(row) }))
    .filter(({ row, amount }) => isBusinessSalesMetric(row, amount))

  for (const { row, metricDate } of businessRows) {
    const alias = row.salesperson?.trim() || 'Unassigned'
    if (metricDate && (!latestActivityByAlias.get(alias) || metricDate > latestActivityByAlias.get(alias)!)) {
      latestActivityByAlias.set(alias, metricDate)
    }
    if (row.canonical_state === 'order' && metricDate && (!latestFishbowlOrderDate || metricDate > latestFishbowlOrderDate)) {
      latestFishbowlOrderDate = metricDate
    }
    if (row.canonical_state === 'quote' && metricDate && (!latestFishbowlQuoteDate || metricDate > latestFishbowlQuoteDate)) {
      latestFishbowlQuoteDate = metricDate
    }
  }

  const currentMonthOrderCount = businessRows.filter(({ row, metricDate }) =>
    row.canonical_state === 'order' && isOnOrAfter(metricDate, monthStart)
  ).length
  const currentMonthQuoteCount = businessRows.filter(({ row, metricDate }) =>
    row.canonical_state === 'quote' && isOnOrAfter(metricDate, monthStart)
  ).length
  const activeMonth = (currentMonthOrderCount === 0 && currentMonthQuoteCount === 0 && latestFishbowlOrderDate)
    ? monthPeriodForDate(latestFishbowlOrderDate, now)
    : {
        start: monthStart,
        end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0],
        label: now.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      }
  const isMetricPeriodFallback = activeMonth.start !== monthStart

  function getOrCreateRep(row: CanonicalSalesOrderRow, mapping: FishbowlSalespersonAliasRow | undefined) {
    const alias = row.salesperson?.trim() || 'Unassigned'
    if (mapping?.is_house_account || mapping?.is_system_alias) return null
    if (!selectedDashboardAliases.has(aliasKey(alias))) return null

    const user = mapping?.sf_user_id ? usersById.get(mapping.sf_user_id) : null
    const id = mapping?.sf_user_id ?? `fishbowl:${alias}`
    const rep = repsById.get(id) ?? createEmptySalesRep({
      id,
      name: mapping?.display_name ?? user?.name ?? alias,
      email: user?.email ?? '',
      team: mapping?.team,
      mappingStatus: mapping ? 'mapped' : 'unmapped',
    })

    if (!rep.fishbowlAliases.includes(alias)) rep.fishbowlAliases.push(alias)
    repsById.set(id, rep)
    return rep
  }

  function recordAliasGap(row: CanonicalSalesOrderRow, mapping: FishbowlSalespersonAliasRow | undefined, amount: number, metricDate: string | null) {
    const alias = row.salesperson?.trim() || 'Unassigned'
    if (mapping && !mapping.is_system_alias && !mapping.is_house_account) return

    const status: SalesAliasGap['status'] = mapping?.is_system_alias
      ? 'system'
      : mapping?.is_house_account
        ? 'house'
        : 'unmapped'
    const existing = aliasStats.get(alias) ?? {
      alias,
      displayName: mapping?.display_name ?? alias,
      status,
      ordersYTD: 0,
      quotesYTD: 0,
      revenueYTD: 0,
      latestActivityAt: null,
    }

    if (row.canonical_state === 'order' && isOnOrAfter(metricDate, yearStart)) {
      existing.ordersYTD++
      existing.revenueYTD += amount
    }
    if (row.canonical_state === 'quote' && isOnOrAfter(metricDate, yearStart)) existing.quotesYTD++
    if (metricDate && (!existing.latestActivityAt || metricDate > existing.latestActivityAt)) {
      existing.latestActivityAt = metricDate
    }
    aliasStats.set(alias, existing)
  }

  for (const { row, amount, metricDate } of businessRows) {
    const mapping = mappingsByAlias.get(aliasKey(row.salesperson))
    const isSelectedRosterRow = Boolean(
      mapping &&
      !mapping.is_house_account &&
      !mapping.is_system_alias &&
      selectedDashboardAliases.has(aliasKey(row.salesperson))
    )
    recordAliasGap(row, mapping, amount, metricDate)

    if (row.canonical_state === 'order') {
      const businessClassification = salesOrderBusinessClassification(row)
      totalBusinessSalesOrders++
      if (row.sf_opportunity_id) linkedSalesOrders++
      if (isSelectedRosterRow && isWithinPeriod(metricDate, activeMonth.start, activeMonth.end)) {
        kpis.revenueMTD += amount
        kpis.dealsClosedMTD++
        if (businessClassification === 'new_business') {
          kpis.newBusinessRevenueMTD += amount
          kpis.newBusinessOrdersMTD++
        } else if (businessClassification === 'recurring_business') {
          kpis.recurringBusinessRevenueMTD += amount
          kpis.recurringBusinessOrdersMTD++
        }
      }
      if (isSelectedRosterRow && isOnOrAfter(metricDate, qtrStart)) {
        kpis.revenueQTD += amount
        if (businessClassification === 'new_business') kpis.newBusinessRevenueQTD += amount
        else if (businessClassification === 'recurring_business') kpis.recurringBusinessRevenueQTD += amount
      }
      if (isSelectedRosterRow && isOnOrAfter(metricDate, yearStart)) {
        kpis.revenueYTD += amount
        if (businessClassification === 'new_business') kpis.newBusinessRevenueYTD += amount
        else if (businessClassification === 'recurring_business') kpis.recurringBusinessRevenueYTD += amount
      }
    } else if (row.canonical_state === 'quote') {
      if (isSelectedRosterRow && isWithinPeriod(metricDate, activeMonth.start, activeMonth.end)) kpis.quotesSentMTD++
    }

    const rep = getOrCreateRep(row, mapping)
    if (!rep) continue

    if (metricDate && (!rep.lastFishbowlActivityAt || metricDate > rep.lastFishbowlActivityAt)) {
      rep.lastFishbowlActivityAt = metricDate
    }

    if (row.canonical_state === 'order') {
      const businessClassification = salesOrderBusinessClassification(row)
      if (isWithinPeriod(metricDate, activeMonth.start, activeMonth.end)) {
        rep.revenueMTD += amount
        rep.dealsClosed++
        if (businessClassification === 'new_business') {
          rep.newBusinessRevenueMTD += amount
          rep.newBusinessOrdersMTD++
        } else if (businessClassification === 'recurring_business') {
          rep.recurringBusinessRevenueMTD += amount
          rep.recurringBusinessOrdersMTD++
        }
      }
      if (isOnOrAfter(metricDate, qtrStart)) {
        rep.revenueQTD += amount
        if (businessClassification === 'new_business') rep.newBusinessRevenueQTD += amount
        else if (businessClassification === 'recurring_business') rep.recurringBusinessRevenueQTD += amount
      }
      if (isOnOrAfter(metricDate, yearStart)) {
        rep.revenueYTD += amount
        rep.ordersYTD++
        if (businessClassification === 'new_business') {
          rep.newBusinessRevenueYTD += amount
          rep.newBusinessOrdersYTD++
        } else if (businessClassification === 'recurring_business') {
          rep.recurringBusinessRevenueYTD += amount
          rep.recurringBusinessOrdersYTD++
        }
      }

      const monthIndex = metricDate ? months.findIndex((month) => metricDate.startsWith(month.key)) : -1
      if (monthIndex >= 0 && metricDate && metricDate >= monthlyStart) {
        monthlyRows[monthIndex][rep.name] = toNumber(monthlyRows[monthIndex][rep.name] as number | string | null) + amount
      }
    } else if (row.canonical_state === 'quote') {
      if (isWithinPeriod(metricDate, activeMonth.start, activeMonth.end)) {
        rep.quotesSent++
        rep.quoteValueMTD += amount
      }
      if (isOnOrAfter(metricDate, qtrStart)) rep.quoteValueQTD += amount
      if (isOnOrAfter(metricDate, yearStart)) {
        rep.quoteValueYTD += amount
        rep.quotesYTD++
      }

      const normalized = row.status.toLowerCase()
      if (isWithinPeriod(metricDate, activeMonth.start, activeMonth.end) && ['expired', 'rejected', 'cancelled', 'canceled'].includes(normalized)) {
        rep.dealsLost++
      }
    }
  }

  for (const [ownerId, pipelineValue] of pipelineByOwner.entries()) {
    kpis.pipelineValue += pipelineValue
    const existing = repsById.get(ownerId)
    if (existing) {
      existing.pipelineValue = roundCurrency(pipelineValue)
    } else if (pipelineValue > 0 && selectedDashboardUserIds.has(ownerId)) {
      const user = usersById.get(ownerId)
      if (!user) continue
      const rep = createEmptySalesRep({
        id: ownerId,
        name: user.name ?? ownerId,
        email: user.email ?? '',
        mappingStatus: 'unmapped',
      })
      rep.pipelineValue = roundCurrency(pipelineValue)
      repsById.set(ownerId, rep)
    }
  }

  for (const [ownerId, stats] of callStatsByOwner.entries()) {
    const rep = repsById.get(ownerId)
    if (!rep) continue
    rep.profileCalls = stats.mtd
    rep.profileCallsChange = stats.lastMonth > 0
      ? Math.round(((stats.mtd - stats.lastMonth) / stats.lastMonth) * 1000) / 10
      : 0
    rep.connectRate = stats.mtd > 0 ? Math.round((stats.connected / stats.mtd) * 1000) / 10 : 0
  }

  const reps = Array.from(repsById.values()).map((rep) => {
    rep.revenueMTD = roundCurrency(rep.revenueMTD)
    rep.revenueQTD = roundCurrency(rep.revenueQTD)
    rep.revenueYTD = roundCurrency(rep.revenueYTD)
    rep.newBusinessRevenueMTD = roundCurrency(rep.newBusinessRevenueMTD)
    rep.newBusinessRevenueQTD = roundCurrency(rep.newBusinessRevenueQTD)
    rep.newBusinessRevenueYTD = roundCurrency(rep.newBusinessRevenueYTD)
    rep.recurringBusinessRevenueMTD = roundCurrency(rep.recurringBusinessRevenueMTD)
    rep.recurringBusinessRevenueQTD = roundCurrency(rep.recurringBusinessRevenueQTD)
    rep.recurringBusinessRevenueYTD = roundCurrency(rep.recurringBusinessRevenueYTD)
    rep.quoteValueMTD = roundCurrency(rep.quoteValueMTD)
    rep.quoteValueQTD = roundCurrency(rep.quoteValueQTD)
    rep.quoteValueYTD = roundCurrency(rep.quoteValueYTD)
    rep.avgDealSize = rep.ordersYTD > 0 ? Math.round(rep.revenueYTD / rep.ordersYTD) : 0
    rep.winRate = rep.ordersYTD + rep.quotesYTD > 0
      ? Math.round((rep.ordersYTD / (rep.ordersYTD + rep.quotesYTD)) * 1000) / 10
      : 0
    if (rep.profileCalls >= 20 || rep.dealsClosed >= 10 || rep.revenueMTD >= 100000) rep.activityScore = 'hot'
    else if (rep.profileCalls >= 10 || rep.dealsClosed >= 5 || rep.revenueQTD >= 100000) rep.activityScore = 'active'
    else if (rep.profileCalls >= 5 || rep.dealsClosed >= 2 || rep.revenueYTD > 0) rep.activityScore = 'slow'
    return rep
  }).sort((a, b) => b.revenueYTD - a.revenueYTD)

  for (const row of monthlyRows) {
    for (const rep of reps.slice(0, 8)) {
      row[rep.name] = roundCurrency(toNumber(row[rep.name] as number | string | null))
    }
  }

  const allAliasGaps = Array.from(aliasStats.values())
    .map((gap) => ({ ...gap, revenueYTD: roundCurrency(gap.revenueYTD) }))
    .sort((a, b) => b.revenueYTD - a.revenueYTD)
  const houseAndSystemAliases = allAliasGaps.filter((gap) => gap.status === 'house' || gap.status === 'system')
  const unmappedAliases = allAliasGaps.filter((gap) => gap.status === 'unmapped' && (gap.ordersYTD > 0 || gap.quotesYTD > 0))
  const freshnessDays = daysSince(latestFishbowlOrderDate)
  const rosterOptions = mappings
    .filter((row) => !row.is_house_account && !row.is_system_alias)
    .map((row) => ({
      fishbowlSalesperson: row.fishbowl_salesperson,
      displayName: row.display_name,
      sfUserId: row.sf_user_id,
      team: row.team,
      isSelected: Boolean(row.show_on_sales_dashboard),
      sortOrder: row.dashboard_sort_order,
      latestActivityAt: latestActivityByAlias.get(row.fishbowl_salesperson) ?? null,
    }))
    .sort((a, b) => {
      if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1
      return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || a.displayName.localeCompare(b.displayName)
    })

  kpis.revenueMTD = roundCurrency(kpis.revenueMTD)
  kpis.revenueQTD = roundCurrency(kpis.revenueQTD)
  kpis.revenueYTD = roundCurrency(kpis.revenueYTD)
  kpis.newBusinessRevenueMTD = roundCurrency(kpis.newBusinessRevenueMTD)
  kpis.newBusinessRevenueQTD = roundCurrency(kpis.newBusinessRevenueQTD)
  kpis.newBusinessRevenueYTD = roundCurrency(kpis.newBusinessRevenueYTD)
  kpis.recurringBusinessRevenueMTD = roundCurrency(kpis.recurringBusinessRevenueMTD)
  kpis.recurringBusinessRevenueQTD = roundCurrency(kpis.recurringBusinessRevenueQTD)
  kpis.recurringBusinessRevenueYTD = roundCurrency(kpis.recurringBusinessRevenueYTD)
  kpis.newBusinessMixMTD = kpis.dealsClosedMTD > 0
    ? Math.round((kpis.newBusinessOrdersMTD / kpis.dealsClosedMTD) * 1000) / 10
    : 0
  kpis.pipelineValue = roundCurrency(kpis.pipelineValue)

  return {
    kpis,
    reps,
    monthlyRevenue: monthlyRows,
    salesHealth: {
      revenueSource: 'fishbowl_sales_orders',
      pipelineSource: 'salesforce_opportunities',
      latestFishbowlOrderDate,
      latestFishbowlQuoteDate,
      fishbowlOrderFreshnessDays: freshnessDays,
      isFishbowlOrderStale: freshnessDays === null || freshnessDays > 1,
      mappedAliasCount: mappings.filter((row) => row.is_active !== false && !row.is_house_account && !row.is_system_alias).length,
      unmappedAliasCount: unmappedAliases.length,
      houseAliasCount: houseAndSystemAliases.filter((gap) => gap.status === 'house').length,
      systemAliasCount: houseAndSystemAliases.filter((gap) => gap.status === 'system').length,
      unmappedAliases: unmappedAliases.slice(0, 8),
      houseAndSystemAliases: houseAndSystemAliases.slice(0, 8),
      linkedSalesOrders,
      unlinkedSalesOrders: Math.max(0, totalBusinessSalesOrders - linkedSalesOrders),
      linkCoverage: totalBusinessSalesOrders > 0 ? Math.round((linkedSalesOrders / totalBusinessSalesOrders) * 1000) / 10 : 0,
      linkRows: linkRowsRes.count ?? 0,
      newBusinessDefinition: 'New Business means the first issued Fishbowl Sales Order after 365+ days without an issued order, plus every issued order from that same customer inside the following 365-day new-business cohort window. Orders after that cohort window are Recurring unless a new 365+ day inactivity gap starts a fresh cohort.',
      activeMetricPeriodLabel: activeMonth.label,
      activeMetricPeriodStart: activeMonth.start,
      activeMetricPeriodEnd: activeMonth.end,
      isMetricPeriodFallback,
      rosterOptions,
    },
  }
}

export async function getSalesDashboardCore(): Promise<SalesDashboardCore> {
  void await getDataSourceMode()
  return getOperationalSalesDashboardCore()
}


export async function getSalesLeaderboard(): Promise<SeedSalesRep[]> {
  void await getDataSourceMode()
  const liveReps = await getOperationalSalesDashboardCore().then((core) => core.reps)
  return liveReps.sort((a, b) => b.revenueMTD - a.revenueMTD)
}

export async function getEnhancedSalesReps(): Promise<SalesRepPerformance[]> {
  void await getDataSourceMode()
  return getOperationalSalesDashboardCore().then((core) => core.reps)
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
  scope?: 'active' | 'business' | 'all'
  page?: number
  pageSize?: number
  includeItems?: boolean
}

async function getLiveQuoteRows(): Promise<CanonicalSalesOrderRow[]> {
  const supabase = createAdminClient()
  return fetchAllRows<CanonicalSalesOrderRow>(() =>
    supabase
      .from('canonical_quotes')
      .select(SALES_ORDER_HEADER_SELECT)
      .order('date_created', { ascending: false, nullsFirst: false }) as unknown as SupabaseRangeQuery<CanonicalSalesOrderRow>
  ).catch((error) => {
      if (isMissingRelationError(error)) {
        warnEmptyLiveTable('canonical_quotes', 'quotes')
        return []
      }
      throw error
    })
}

async function fetchLineItemCountsForNumbers(
  orderNumbers: string[]
): Promise<Map<string, number>> {
  const itemsByOrder = await fetchSalesOrderItemsForNumbers(orderNumbers)
  const lineItemCounts = new Map<string, number>()
  for (const [orderNumber, items] of itemsByOrder.entries()) {
    lineItemCounts.set(orderNumber, items.length)
  }
  return lineItemCounts
}

function mapCanonicalQuoteRow(
  row: CanonicalSalesOrderRow,
  lineItemCount = 0,
  now = Date.now()
): SeedQuote {
    const dateValue = row.date_created ?? row.last_synced_at ?? new Date().toISOString()
    const created = new Date(dateValue)
    const daysOpen = Number.isNaN(created.getTime())
      ? 0
      : Math.max(0, Math.floor((now - created.getTime()) / 86_400_000))
    const amount = roundCurrency(toNumber(row.total_amount) || toNumber(row.subtotal_amount))
    const flags = getSalesOrderFlags(row, amount, lineItemCount, daysSince(dateValue))

    return {
      id: row.so_number,
      date: dateValue.split('T')[0],
      repName: row.salesperson ?? 'Unassigned',
      customerName: row.customer_name ?? 'Unknown Customer',
      amount,
      status: mapFishbowlQuoteStatus(row.status),
      daysOpen,
      sourceStatus: row.status,
      dataQualityFlags: flags,
      lineItemCount,
    }
}

export async function getQuotes(filters: QuoteFilters = {}): Promise<PaginatedResult<SeedQuote>> {
  void await getDataSourceMode()
  const rows = await getLiveQuoteRows()
  const now = Date.now()
  const quotes = rows.map((row) => mapCanonicalQuoteRow(row, 0, now))

  let filtered = quotes
  const scope = filters.scope ?? 'active'
  if (scope === 'active') {
    filtered = filtered.filter((quote) => {
      const flags = quote.dataQualityFlags ?? []
      return !flags.includes(QUALITY_LIKELY_TEST) &&
        !flags.includes(QUALITY_INCOMPLETE_LINES) &&
        !flags.includes(QUALITY_ZERO_VALUE) &&
        !flags.includes(QUALITY_HISTORICAL)
    })
  } else if (scope === 'business') {
    filtered = filtered.filter((quote) => {
      const flags = quote.dataQualityFlags ?? []
      return !flags.includes(QUALITY_LIKELY_TEST) &&
        !flags.includes(QUALITY_INCOMPLETE_LINES) &&
        !flags.includes(QUALITY_ZERO_VALUE)
    })
  }

  if (filters.status && filters.status !== 'all') {
    filtered = filtered.filter((quote) => quote.status === filters.status)
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    filtered = filtered.filter((quote) =>
      quote.id.toLowerCase().includes(q) ||
      quote.customerName.toLowerCase().includes(q) ||
      quote.repName.toLowerCase().includes(q)
    )
  }

  const paginated = paginate(filtered, filters.page, filters.pageSize)
  if (filters.includeItems === false || paginated.data.length === 0) {
    return paginated
  }

  const lineItemCounts = await fetchLineItemCountsForNumbers(
    paginated.data.map((quote) => quote.id)
  ).catch((error) => {
    console.warn('Live Fishbowl quote item page query failed; quotes will use cached quality flags:', error)
    return new Map<string, number>()
  })
  const rowsByQuoteNumber = new Map(rows.map((row) => [row.so_number, row]))

  return {
    ...paginated,
    data: paginated.data.map((quote) => {
      const row = rowsByQuoteNumber.get(quote.id)
      if (!row) return quote
      return mapCanonicalQuoteRow(row, lineItemCounts.get(quote.id) ?? 0, now)
    }),
  }
}

function mapFishbowlQuoteStatus(status: string): SeedQuote['status'] {
  const normalized = status.toLowerCase()
  if (['accepted', 'issued'].includes(normalized)) return 'accepted'
  if (['expired'].includes(normalized)) return 'expired'
  if (['rejected', 'void', 'voided', 'cancelled', 'canceled'].includes(normalized)) return 'rejected'
  if (['viewed'].includes(normalized)) return 'viewed'
  return 'sent'
}

export async function getMonthlyRepRevenue(): Promise<SeedMonthlyRepRevenue[]> {
  void await getDataSourceMode()
  return getOperationalSalesDashboardCore().then((core) => core.monthlyRevenue)
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
  newBusinessRevenueMTD: number
  newBusinessRevenueQTD: number
  newBusinessRevenueYTD: number
  recurringBusinessRevenueMTD: number
  recurringBusinessRevenueQTD: number
  recurringBusinessRevenueYTD: number
  newBusinessOrdersMTD: number
  recurringBusinessOrdersMTD: number
  newBusinessMixMTD: number
  quotesSentMTD: number
  dealsClosedMTD: number
  avgDaysToClose: number
  pipelineValue: number
}

export async function getSalesKpis(): Promise<SalesKpis> {
  void await getDataSourceMode()
  return getOperationalSalesDashboardCore().then((core) => core.kpis)
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

  let query = supabase
    .from('sf_call_activities')
    .select('sf_id, activity_type, owner_sf_id, activity_date, task_subtype, call_type, call_disposition, profile_call_type, profile_call_outcome, products_discussed, program_size, budget_timeframe, follow_up_date, converted_to_opp, related_opportunity_sf_id, ringdna_direction, ringdna_duration_min, ringdna_connected, ringdna_rating, ringdna_voicemail, ringdna_keywords, ringdna_start_time, ringdna_disposition, calendly_no_show, calendly_rescheduled')
    .lte('activity_date', todayActivityDateKey())
    .or(ACTUAL_RINGDNA_CALL_FILTER)
    .order('activity_date', { ascending: false })
    .limit(filters.limit ?? filters.pageSize ?? 50)

  if (filters.repId) query = query.eq('owner_sf_id', filters.repId)
  if (filters.startDate) query = query.gte('activity_date', filters.startDate)
  if (filters.endDate) query = query.lte('activity_date', filters.endDate)
  if (filters.outcome) query = query.eq('profile_call_outcome', filters.outcome)
  if (filters.convertedOnly) query = query.eq('converted_to_opp', true)
  if (filters.activityType && filters.activityType !== 'all') query = query.eq('activity_type', filters.activityType)
  if (filters.keyword) query = query.ilike('ringdna_keywords', `%${filters.keyword.replace(/[%*,]/g, '')}%`)

  const { data: calls, error } = await query
  if (error) {
    if (isMissingRelationError(error)) {
      warnEmptyLiveTable('sf_call_activities', 'call activity list')
      return { data: [], total: 0, page: 1, pageSize: filters.pageSize ?? 20, totalPages: 0 }
    }
    throw error
  }

  if (!calls || calls.length === 0) {
    warnEmptyLiveTable('sf_call_activities', 'call activity list')
    return { data: [], total: 0, page: 1, pageSize: filters.pageSize ?? 20, totalPages: 0 }
  }

  const ownerIds = [...new Set(calls.map((c) => c.owner_sf_id).filter(Boolean))]
  const usersRes = ownerIds.length > 0
    ? await supabase.from('sf_users').select('sf_id, name').in('sf_id', ownerIds)
    : { data: [] }

  const userNames = new Map(
    ((usersRes.data ?? []) as LookupNameRow[]).map((u) => [u.sf_id, u.name])
  )

  const mapped: SeedProfileCall[] = (calls as SfCallActivityRow[]).map((c) => ({
    id: c.sf_id,
    subject: 'RingDNA Call',
    repId: c.owner_sf_id ?? '',
    repName: (c.owner_sf_id ? userNames.get(c.owner_sf_id) : undefined) ?? c.owner_sf_id ?? '',
    accountName: '',
    contactName: '',
    activityDate: c.activity_date ?? '',
    activityType: c.activity_type as 'Task' | 'Event',
    profileCallType: c.profile_call_type ?? c.ringdna_disposition ?? c.call_disposition ?? 'Sales Call',
    profileCallOutcome: c.profile_call_outcome ?? c.ringdna_disposition ?? c.call_disposition ?? 'Unclassified',
    productsDiscussed: c.products_discussed ? c.products_discussed.split(';').map((s: string) => s.trim()) : [],
    programSize: c.program_size ?? '',
    currentSupplier: null,
    budgetAvailable: null,
    budgetTimeframe: c.budget_timeframe,
    followUpDate: c.follow_up_date,
    convertedToOpp: c.converted_to_opp ?? false,
    relatedOpportunityName: null,
    callNotesSummary: '',
    competitorIntel: null,
    ringdnaDirection: normalizeRingDnaDirection(c.ringdna_direction),
    ringdnaDurationMin: c.ringdna_duration_min ? Number(c.ringdna_duration_min) : 0,
    ringdnaConnected: c.ringdna_connected ?? false,
    ringdnaRating: c.ringdna_rating != null ? Number(c.ringdna_rating) : null,
    ringdnaRecordingUrl: null,
    ringdnaVoicemail: c.ringdna_voicemail ?? false,
    ringdnaKeywords: c.ringdna_keywords,
    ringdnaStartTime: c.ringdna_start_time ?? c.activity_date ?? '',
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
  voicemailCount: number
  voicemailRate: number
  byRep: Array<{
    repName: string
    calls: number
    converted: number
    conversionRate: number
    connectedCalls: number
    connectRate: number
    avgDuration: number
    avgRating: number | null
    voicemailCount: number
    voicemailRate: number
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

  let mtdCalls: Array<{
    owner_sf_id: string | null
    converted_to_opp: boolean | null
    ringdna_connected: boolean | null
    ringdna_duration_min: number | string | null
    ringdna_rating: number | string | null
    ringdna_voicemail: boolean | null
  }> = []

  try {
    mtdCalls = await fetchAllRows(() =>
      supabase
        .from('sf_call_activities')
        .select('owner_sf_id, converted_to_opp, ringdna_connected, ringdna_duration_min, ringdna_rating, ringdna_voicemail')
        .gte('activity_date', monthStart)
        .lte('activity_date', todayActivityDateKey())
        .or(ACTUAL_RINGDNA_CALL_FILTER)
        .order('activity_date', { ascending: true })
        .order('sf_id', { ascending: true })
    )
  } catch (error) {
    if (isMissingRelationError(error)) {
      warnEmptyLiveTable('sf_call_activities', 'call activity metrics')
      return { totalMTD: 0, totalLastMonth: 0, conversionRate: 0, connectRate: 0, avgDuration: 0, voicemailCount: 0, voicemailRate: 0, byRep: [] }
    }
    throw error
  }

  const { count: lastMonthCount, error: lastMonthError } = await supabase
    .from('sf_call_activities')
    .select('*', { count: 'exact', head: true })
    .gte('activity_date', lastMonthStart)
    .lt('activity_date', monthStart)
    .or(ACTUAL_RINGDNA_CALL_FILTER)

  if (lastMonthError) {
    if (isMissingRelationError(lastMonthError)) {
      warnEmptyLiveTable('sf_call_activities', 'call activity metrics')
      return { totalMTD: 0, totalLastMonth: 0, conversionRate: 0, connectRate: 0, avgDuration: 0, voicemailCount: 0, voicemailRate: 0, byRep: [] }
    }
    throw lastMonthError
  }

  if (mtdCalls.length === 0) {
    warnEmptyLiveTable('sf_call_activities', 'call activity metrics')
    return { totalMTD: 0, totalLastMonth: lastMonthCount ?? 0, conversionRate: 0, connectRate: 0, avgDuration: 0, voicemailCount: 0, voicemailRate: 0, byRep: [] }
  }

  // Resolve owner names
  const ownerIds = [...new Set(mtdCalls.map((c) => c.owner_sf_id).filter(Boolean))]
  const { data: users } = await supabase.from('sf_users').select('sf_id, name').in('sf_id', ownerIds)
  const nameMap = new Map(((users ?? []) as LookupNameRow[]).map((u) => [u.sf_id, u.name]))

  const totalMTD = mtdCalls.length
  const converted = mtdCalls.filter((c) => c.converted_to_opp).length
  const connected = mtdCalls.filter((c) => c.ringdna_connected).length
  const voicemails = mtdCalls.filter((c) => c.ringdna_voicemail).length
  const durations = mtdCalls.map((c) => Number(c.ringdna_duration_min) || 0).filter((d) => d > 0)

  // Group by rep
  const byRepMap = new Map<string, {
    calls: number; converted: number; connected: number; voicemails: number;
    totalDuration: number; totalRating: number; ratingCount: number
  }>()
  for (const call of mtdCalls) {
    const repId = call.owner_sf_id ?? 'unknown'
    const existing = byRepMap.get(repId) ?? { calls: 0, converted: 0, connected: 0, voicemails: 0, totalDuration: 0, totalRating: 0, ratingCount: 0 }
    existing.calls++
    if (call.converted_to_opp) existing.converted++
    if (call.ringdna_connected) existing.connected++
    if (call.ringdna_voicemail) existing.voicemails++
    existing.totalDuration += Number(call.ringdna_duration_min) || 0
    if (call.ringdna_rating != null) {
      existing.totalRating += Number(call.ringdna_rating) || 0
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
    voicemailCount: voicemails,
    voicemailRate: totalMTD > 0 ? Math.round((voicemails / totalMTD) * 1000) / 10 : 0,
    byRep: Array.from(byRepMap.entries()).map(([repId, data]) => ({
      repName: nameMap.get(repId) ?? repId,
      calls: data.calls,
      converted: data.converted,
      conversionRate: data.calls > 0 ? Math.round((data.converted / data.calls) * 1000) / 10 : 0,
      connectedCalls: data.connected,
      connectRate: data.calls > 0 ? Math.round((data.connected / data.calls) * 1000) / 10 : 0,
      avgDuration: data.calls > 0 ? Math.round(data.totalDuration / data.calls) : 0,
      avgRating: data.ratingCount > 0 ? Math.round((data.totalRating / data.ratingCount) * 10) / 10 : null,
      voicemailCount: data.voicemails,
      voicemailRate: data.calls > 0 ? Math.round((data.voicemails / data.calls) * 1000) / 10 : 0,
    })),
  }
}

export interface CallActivityRepPeriod {
  ownerSfId: string
  repName: string
  totalCalls: number
  conversationCalls: number
  outboundCalls: number
  inboundCalls: number
  connectedCalls: number
  totalDurationMin: number
  avgDurationMin: number
}

export interface CallActivityPeriodSummary {
  periodStart: string
  label: string
  totalCalls: number
  conversationCalls: number
  outboundCalls: number
  inboundCalls: number
  connectedCalls: number
  totalDurationMin: number
  avgDurationMin: number
  byRep: CallActivityRepPeriod[]
}

export interface CallActivitySummary {
  generatedAt: string
  latestActivityDate: string | null
  daily: CallActivityPeriodSummary[]
  weekly: CallActivityPeriodSummary[]
  monthly: CallActivityPeriodSummary[]
  byRep: Array<{
    ownerSfId: string
    repName: string
    today: CallActivityRepPeriod
    weekToDate: CallActivityRepPeriod
    monthToDate: CallActivityRepPeriod
  }>
}

type CallActivityMetricRow = {
  owner_sf_id: string | null
  activity_date: string | null
  ringdna_direction: string | null
  ringdna_duration_min: number | string | null
  ringdna_connected: boolean | null
}

type MutableCallActivityPeriod = {
  periodStart: string
  label: string
  totalCalls: number
  conversationCalls: number
  outboundCalls: number
  inboundCalls: number
  connectedCalls: number
  totalDurationMin: number
  byRep: Map<string, CallActivityRepPeriod>
}

function emptyRepPeriod(ownerSfId: string, repName: string): CallActivityRepPeriod {
  return {
    ownerSfId,
    repName,
    totalCalls: 0,
    conversationCalls: 0,
    outboundCalls: 0,
    inboundCalls: 0,
    connectedCalls: 0,
    totalDurationMin: 0,
    avgDurationMin: 0,
  }
}

function createPeriod(periodStart: string, label: string): MutableCallActivityPeriod {
  return {
    periodStart,
    label,
    totalCalls: 0,
    conversationCalls: 0,
    outboundCalls: 0,
    inboundCalls: 0,
    connectedCalls: 0,
    totalDurationMin: 0,
    byRep: new Map(),
  }
}

function addCallToPeriod(period: MutableCallActivityPeriod, call: CallActivityMetricRow, repName: string) {
  const direction = call.ringdna_direction ?? ''
  const duration = toNumber(call.ringdna_duration_min)
  const ownerSfId = call.owner_sf_id ?? 'unassigned'
  const rep = period.byRep.get(ownerSfId) ?? emptyRepPeriod(ownerSfId, repName)

  period.totalCalls += 1
  rep.totalCalls += 1

  if (duration >= 2) {
    period.conversationCalls += 1
    rep.conversationCalls += 1
  }

  if (direction === 'Outbound') {
    period.outboundCalls += 1
    rep.outboundCalls += 1
  } else if (direction === 'Inbound') {
    period.inboundCalls += 1
    rep.inboundCalls += 1
  }

  if (call.ringdna_connected) {
    period.connectedCalls += 1
    rep.connectedCalls += 1
  }

  period.totalDurationMin += duration
  rep.totalDurationMin += duration
  period.byRep.set(ownerSfId, rep)
}

function finalizePeriod(period: MutableCallActivityPeriod): CallActivityPeriodSummary {
  const byRep = Array.from(period.byRep.values())
    .map((rep) => ({
      ...rep,
      totalDurationMin: Math.round(rep.totalDurationMin * 10) / 10,
      avgDurationMin: rep.totalCalls > 0 ? Math.round((rep.totalDurationMin / rep.totalCalls) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.outboundCalls - a.outboundCalls || b.totalDurationMin - a.totalDurationMin)

  return {
    periodStart: period.periodStart,
    label: period.label,
    totalCalls: period.totalCalls,
    conversationCalls: period.conversationCalls,
    outboundCalls: period.outboundCalls,
    inboundCalls: period.inboundCalls,
    connectedCalls: period.connectedCalls,
    totalDurationMin: Math.round(period.totalDurationMin * 10) / 10,
    avgDurationMin: period.totalCalls > 0 ? Math.round((period.totalDurationMin / period.totalCalls) * 10) / 10 : 0,
    byRep,
  }
}

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

function makeDailyPeriods(now: Date): MutableCallActivityPeriod[] {
  const periods: MutableCallActivityPeriod[] = []
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)

  while (periods.length < 6) {
    if (!isWeekend(date)) {
      const key = dateKey(date)
      periods.push(createPeriod(key, date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })))
    }
    date.setDate(date.getDate() - 1)
  }

  return periods.reverse()
}

function makeWeeklyPeriods(now: Date): MutableCallActivityPeriod[] {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now)
    date.setDate(now.getDate() - now.getDay() - (5 - index) * 7)
    date.setHours(0, 0, 0, 0)
    const key = dateKey(date)
    return createPeriod(key, `Week of ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`)
  })
}

function makeMonthlyPeriods(now: Date): MutableCallActivityPeriod[] {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
    const key = dateKey(date)
    return createPeriod(key, date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }))
  })
}

export async function getCallActivitySummary(): Promise<CallActivitySummary> {
  void await getDataSourceMode()
  const supabase = createAdminClient()
  const now = new Date()
  const dailyPeriods = makeDailyPeriods(now)
  const weeklyPeriods = makeWeeklyPeriods(now)
  const monthlyPeriods = makeMonthlyPeriods(now)
  const dailyByKey = new Map(dailyPeriods.map((period) => [period.periodStart, period]))
  const weeklyByKey = new Map(weeklyPeriods.map((period) => [period.periodStart, period]))
  const monthlyByKey = new Map(monthlyPeriods.map((period) => [period.periodStart, period]))
  const startDate = [dailyPeriods[0].periodStart, weeklyPeriods[0].periodStart, monthlyPeriods[0].periodStart].sort()[0]

  let calls: CallActivityMetricRow[] = []

  try {
    calls = await fetchAllRows<CallActivityMetricRow>(() =>
      supabase
        .from('sf_call_activities')
        .select('owner_sf_id, activity_date, ringdna_direction, ringdna_duration_min, ringdna_connected')
        .gte('activity_date', startDate)
        .lte('activity_date', todayActivityDateKey())
        .or(ACTUAL_RINGDNA_CALL_FILTER)
        .order('activity_date', { ascending: true })
        .order('sf_id', { ascending: true })
    )
  } catch (error) {
    if (isMissingRelationError(error)) {
      warnEmptyLiveTable('sf_call_activities', 'call activity summary')
      return { generatedAt: new Date().toISOString(), latestActivityDate: null, daily: [], weekly: [], monthly: [], byRep: [] }
    }
    throw error
  }

  if (calls.length === 0) {
    warnEmptyLiveTable('sf_call_activities', 'call activity summary')
    return {
      generatedAt: new Date().toISOString(),
      latestActivityDate: null,
      daily: dailyPeriods.map(finalizePeriod),
      weekly: weeklyPeriods.map(finalizePeriod),
      monthly: monthlyPeriods.map(finalizePeriod),
      byRep: [],
    }
  }

  const rows = calls
  const ownerIds = [...new Set(rows.map((call) => call.owner_sf_id).filter(Boolean))]
  const usersRes = ownerIds.length > 0
    ? await supabase.from('sf_users').select('sf_id, name').in('sf_id', ownerIds)
    : { data: [] }
  const userNames = new Map(((usersRes.data ?? []) as LookupNameRow[]).map((user) => [user.sf_id, user.name ?? user.sf_id]))
  const repTotals = new Map<string, {
    repName: string
    today: CallActivityRepPeriod
    weekToDate: CallActivityRepPeriod
    monthToDate: CallActivityRepPeriod
  }>()

  const todayKey = dateKey(now)
  const currentWeekKey = weekStartKey(todayKey)
  const currentMonthKey = monthStartKey(todayKey)
  let latestActivityDate: string | null = null

  for (const call of rows) {
    if (!call.activity_date) continue
    const ownerSfId = call.owner_sf_id ?? 'unassigned'
    const repName = call.owner_sf_id ? userNames.get(call.owner_sf_id) ?? call.owner_sf_id : 'Unassigned'
    const dailyPeriod = dailyByKey.get(call.activity_date)
    const weeklyPeriod = weeklyByKey.get(weekStartKey(call.activity_date))
    const monthlyPeriod = monthlyByKey.get(monthStartKey(call.activity_date))

    if (dailyPeriod) addCallToPeriod(dailyPeriod, call, repName)
    if (weeklyPeriod) addCallToPeriod(weeklyPeriod, call, repName)
    if (monthlyPeriod) addCallToPeriod(monthlyPeriod, call, repName)

    if (!latestActivityDate || call.activity_date > latestActivityDate) latestActivityDate = call.activity_date

    const totals = repTotals.get(ownerSfId) ?? {
      repName,
      today: emptyRepPeriod(ownerSfId, repName),
      weekToDate: emptyRepPeriod(ownerSfId, repName),
      monthToDate: emptyRepPeriod(ownerSfId, repName),
    }
    if (call.activity_date === todayKey) {
      const wrapper = createPeriod(todayKey, 'Today')
      wrapper.byRep.set(ownerSfId, totals.today)
      addCallToPeriod(wrapper, call, repName)
      totals.today = wrapper.byRep.get(ownerSfId) ?? totals.today
    }
    if (weekStartKey(call.activity_date) === currentWeekKey) {
      const wrapper = createPeriod(currentWeekKey, 'Week to date')
      wrapper.byRep.set(ownerSfId, totals.weekToDate)
      addCallToPeriod(wrapper, call, repName)
      totals.weekToDate = wrapper.byRep.get(ownerSfId) ?? totals.weekToDate
    }
    if (monthStartKey(call.activity_date) === currentMonthKey) {
      const wrapper = createPeriod(currentMonthKey, 'Month to date')
      wrapper.byRep.set(ownerSfId, totals.monthToDate)
      addCallToPeriod(wrapper, call, repName)
      totals.monthToDate = wrapper.byRep.get(ownerSfId) ?? totals.monthToDate
    }
    repTotals.set(ownerSfId, totals)
  }

  const byRep = Array.from(repTotals.entries()).map(([ownerSfId, totals]) => ({
    ownerSfId,
    repName: totals.repName,
    today: {
      ...totals.today,
      totalDurationMin: Math.round(totals.today.totalDurationMin * 10) / 10,
      avgDurationMin: totals.today.totalCalls > 0 ? Math.round((totals.today.totalDurationMin / totals.today.totalCalls) * 10) / 10 : 0,
    },
    weekToDate: {
      ...totals.weekToDate,
      totalDurationMin: Math.round(totals.weekToDate.totalDurationMin * 10) / 10,
      avgDurationMin: totals.weekToDate.totalCalls > 0 ? Math.round((totals.weekToDate.totalDurationMin / totals.weekToDate.totalCalls) * 10) / 10 : 0,
    },
    monthToDate: {
      ...totals.monthToDate,
      totalDurationMin: Math.round(totals.monthToDate.totalDurationMin * 10) / 10,
      avgDurationMin: totals.monthToDate.totalCalls > 0 ? Math.round((totals.monthToDate.totalDurationMin / totals.monthToDate.totalCalls) * 10) / 10 : 0,
    },
  })).sort((a, b) => b.monthToDate.outboundCalls - a.monthToDate.outboundCalls || b.monthToDate.totalDurationMin - a.monthToDate.totalDurationMin)

  return {
    generatedAt: new Date().toISOString(),
    latestActivityDate,
    daily: dailyPeriods.map(finalizePeriod),
    weekly: weeklyPeriods.map(finalizePeriod),
    monthly: monthlyPeriods.map(finalizePeriod),
    byRep,
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

  const [callsResult, usersRes] = await Promise.all([
    fetchAllRows<Array<{ owner_sf_id: string | null; activity_date: string | null }>[number]>(() =>
      supabase
        .from('sf_call_activities')
        .select('owner_sf_id, activity_date')
        .gte('activity_date', startDate)
        .lte('activity_date', todayActivityDateKey())
        .or(ACTUAL_RINGDNA_CALL_FILTER)
        .order('activity_date', { ascending: true })
        .order('sf_id', { ascending: true })
    ).then((data) => ({ data, error: null as Error | null })).catch((error) => ({ data: null, error })),
    supabase
      .from('sf_users')
      .select('sf_id, name')
      .eq('is_active', true),
  ])

  if (callsResult.error) {
    if (isMissingRelationError(callsResult.error)) {
      warnEmptyLiveTable('sf_call_activities', 'weekly call volume')
      return []
    }
    throw callsResult.error
  }
  if (usersRes.error) throw usersRes.error
  if (!callsResult.data || callsResult.data.length === 0) {
    warnEmptyLiveTable('sf_call_activities', 'weekly call volume')
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

  for (const call of callsResult.data) {
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
  let calls: Array<{ profile_call_outcome: string | null }> = []

  try {
    calls = await fetchAllRows(() =>
      supabase
        .from('sf_call_activities')
        .select('profile_call_outcome')
        .not('profile_call_outcome', 'is', null)
        .gte('activity_date', monthStart)
        .lte('activity_date', todayActivityDateKey())
        .or(ACTUAL_RINGDNA_CALL_FILTER)
        .order('activity_date', { ascending: true })
        .order('sf_id', { ascending: true })
    )
  } catch (error) {
    if (isMissingRelationError(error)) {
      warnEmptyLiveTable('sf_call_activities', 'profile call outcome enrichment')
      return []
    }
    throw error
  }

  if (calls.length === 0) {
    warnEmptyLiveTable('sf_call_activities', 'profile call outcome enrichment')
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
  let calls: Array<{ sf_id: string; ringdna_keywords: string | null }> = []

  try {
    calls = await fetchAllRows(() =>
      supabase
        .from('sf_call_activities')
        .select('sf_id, ringdna_keywords')
        .not('ringdna_keywords', 'is', null)
        .lte('activity_date', todayActivityDateKey())
        .or(ACTUAL_RINGDNA_CALL_FILTER)
        .order('activity_date', { ascending: false })
        .order('sf_id', { ascending: true })
    )
  } catch (error) {
    if (isMissingRelationError(error)) {
      warnEmptyLiveTable('sf_call_activities', 'ringdna keywords')
      return []
    }
    throw error
  }

  if (calls.length === 0) {
    warnEmptyLiveTable('sf_call_activities', 'ringdna keywords')
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
