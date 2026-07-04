import { createAdminClient } from '@/lib/supabase/admin'
import { chicagoMidnightUtc, chicagoNextMidnightUtc } from './dates'
import type {
  BellLogRow,
  IncentiveRefreshState,
  IncentiveSettings,
  MergeCandidateRow,
  MergeMapRow,
  OrderIncentiveDetailRow,
  PayoutSnapshotRow,
  PayoutVarianceRow,
  RepIncentiveMonthlyRow,
  RepNewAccount,
  UnmappedRepRow,
} from './types'

export const INCENTIVE_CACHE_TAG = 'incentive-dashboard'

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return toNumber(value)
}

function normalizeMonthlyRow(row: Record<string, unknown>): RepIncentiveMonthlyRow {
  return {
    rep_key: String(row.rep_key ?? ''),
    rep_display_name: (row.rep_display_name as string | null) ?? null,
    month: String(row.month ?? ''),
    in_promo_period: Boolean(row.in_promo_period),
    enrollments: toNumber(row.enrollments),
    enrollment_gate: toNumber(row.enrollment_gate),
    qualifies: Boolean(row.qualifies),
    order_count: toNumber(row.order_count),
    new_window_order_count: toNumber(row.new_window_order_count),
    attributed_revenue: toNumber(row.attributed_revenue),
    new_customer_revenue_gross: toNumber(row.new_customer_revenue_gross),
    net_new_customer_revenue: toNumber(row.net_new_customer_revenue),
    win_back_revenue: toNumber(row.win_back_revenue),
    blocking_unmapped_count: toNumber(row.blocking_unmapped_count),
    base_commission: toNullableNumber(row.base_commission),
    bonus_commission: toNullableNumber(row.bonus_commission),
    projected_total: toNullableNumber(row.projected_total),
  }
}

export async function getRepIncentiveMonthly(month?: string): Promise<RepIncentiveMonthlyRow[]> {
  const supabase = createAdminClient()
  let query = supabase.from('v_incentive_rep_month').select('*').limit(5000)
  if (month) {
    query = query.eq('month', month)
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row) => normalizeMonthlyRow(row as Record<string, unknown>))
}

export async function getRepNewAccounts(repKey: string, settings: IncentiveSettings): Promise<RepNewAccount[]> {
  const supabase = createAdminClient()
  const { data: orders, error } = await supabase
    .from('v_incentive_order_detail')
    .select('so_number, canonical_customer_key, customer_name, net_amount, order_at')
    .eq('rep_key', repKey)
    .eq('class', 'NEW_WINDOW')
    .limit(5000)
  if (error) throw error

  const keys = Array.from(
    new Set((orders ?? []).map((o) => o.canonical_customer_key as string).filter(Boolean))
  )
  if (keys.length === 0) return []

  const { data: firsts, error: firstsError } = await supabase
    .from('customer_first_order')
    .select('canonical_customer_key, first_order_at, new_window_end')
    .in('canonical_customer_key', keys)
  if (firstsError) throw firstsError

  const firstByKey = new Map(
    (firsts ?? []).map((f) => [f.canonical_customer_key as string, f])
  )

  const accounts = new Map<string, RepNewAccount>()
  for (const order of orders ?? []) {
    const key = order.canonical_customer_key as string
    const first = firstByKey.get(key)
    if (!first?.first_order_at || !first?.new_window_end) continue
    const existing = accounts.get(key)
    if (existing) {
      existing.revenueInWindow += toNumber(order.net_amount)
      if (!existing.institution && order.customer_name) existing.institution = order.customer_name as string
    } else {
      const windowEnd = String(first.new_window_end)
      accounts.set(key, {
        canonicalKey: key,
        institution: (order.customer_name as string | null) ?? null,
        firstOrderAt: String(first.first_order_at),
        windowEnd,
        daysLeft: Math.max(0, Math.ceil((new Date(windowEnd).getTime() - Date.now()) / 86_400_000)),
        revenueInWindow: toNumber(order.net_amount),
      })
    }
  }

  void settings
  return Array.from(accounts.values()).sort((a, b) => b.firstOrderAt.localeCompare(a.firstOrderAt))
}

export async function getGateFeasibilityTrend(weeks = 13): Promise<Array<{ weekStart: string; enrollments: number }>> {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - weeks * 7 * 86_400_000)
  const { data, error } = await supabase
    .from('customer_first_order')
    .select('first_order_at')
    .eq('is_quote_only', false)
    .gte('first_order_at', since.toISOString())
    .limit(10000)
  if (error) throw error

  const buckets = new Map<string, number>()
  // Zero-fill Sunday-anchored weeks so the chart shows quiet weeks.
  const anchor = new Date(since)
  anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay())
  anchor.setUTCHours(0, 0, 0, 0)
  for (let cursor = new Date(anchor); cursor.getTime() <= Date.now(); cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    buckets.set(cursor.toISOString().slice(0, 10), 0)
  }
  for (const row of data ?? []) {
    if (!row.first_order_at) continue
    const at = new Date(row.first_order_at as string)
    at.setUTCDate(at.getUTCDate() - at.getUTCDay())
    at.setUTCHours(0, 0, 0, 0)
    const key = at.toISOString().slice(0, 10)
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, enrollments]) => ({ weekStart, enrollments }))
}

export async function getWinBackSummary(settings: IncentiveSettings): Promise<{
  count: number
  revenue: number
  orders: OrderIncentiveDetailRow[]
}> {
  const supabase = createAdminClient()
  const promoStart = chicagoMidnightUtc(settings.promoStart).toISOString()
  const promoEndExclusive = chicagoNextMidnightUtc(settings.promoEnd).toISOString()
  const { data, error } = await supabase
    .from('v_incentive_order_detail')
    .select('*')
    .eq('class', 'WIN_BACK')
    .gte('order_at', promoStart)
    .lt('order_at', promoEndExclusive)
    .order('order_at', { ascending: false })
    .limit(500)
  if (error) throw error

  const orders = (data ?? []) as unknown as OrderIncentiveDetailRow[]
  return {
    count: orders.length,
    revenue: orders.reduce((sum, order) => sum + toNumber(order.net_amount), 0),
    orders,
  }
}

export interface ExceptionsPayload {
  unmappedReps: UnmappedRepRow[]
  noRepOrders: { count: number; amount: number }
  houseOrders: { count: number; amount: number }
  reconciliationExceptions: Array<{
    so_number: string
    customer_name: string | null
    order_at: string | null
    total_amount: number | null
    line_item_sum: number
    divergence: number
    class: string | null
  }>
  reconciliationCount: number
  suspectedDuplicates: MergeCandidateRow[]
  refreshState: IncentiveRefreshState | null
}

export async function getExceptions(): Promise<ExceptionsPayload> {
  const supabase = createAdminClient()

  const [unmappedRes, noRepRes, houseRes, reconRes, reconCountRes, dupRes, stateRes] = await Promise.all([
    supabase.from('v_incentive_unmapped_salespersons').select('*').limit(500),
    supabase
      .from('order_incentive_class')
      .select('net_amount')
      .eq('class', 'EXCLUDED_NO_REP')
      .limit(10000),
    supabase
      .from('order_incentive_class')
      .select('net_amount')
      .eq('class', 'EXCLUDED_HOUSE')
      .limit(10000),
    supabase
      .from('v_incentive_reconciliation_exceptions')
      .select('so_number, customer_name, order_at, total_amount, line_item_sum, divergence, class')
      .order('divergence', { ascending: false })
      .limit(100),
    supabase
      .from('v_incentive_reconciliation_exceptions')
      .select('so_number', { count: 'exact', head: true }),
    supabase.from('v_customer_merge_candidates').select('*').limit(100),
    supabase.from('incentive_refresh_state').select('dirty_at, last_refresh_at, last_refresh_result').maybeSingle(),
  ])

  for (const res of [unmappedRes, noRepRes, houseRes, reconRes, dupRes]) {
    if (res.error) throw res.error
  }

  const sumAmounts = (rows: Array<{ net_amount: unknown }> | null) =>
    (rows ?? []).reduce((sum, row) => sum + toNumber(row.net_amount), 0)

  return {
    unmappedReps: (unmappedRes.data ?? []).map((row) => ({
      fishbowl_salesperson: String(row.fishbowl_salesperson),
      order_count_all_time: toNumber(row.order_count_all_time),
      order_count_in_period: toNumber(row.order_count_in_period),
      amount_in_period: toNumber(row.amount_in_period),
      last_order_at: (row.last_order_at as string | null) ?? null,
    })),
    noRepOrders: { count: noRepRes.data?.length ?? 0, amount: sumAmounts(noRepRes.data) },
    houseOrders: { count: houseRes.data?.length ?? 0, amount: sumAmounts(houseRes.data) },
    reconciliationExceptions: (reconRes.data ?? []).map((row) => ({
      so_number: String(row.so_number),
      customer_name: (row.customer_name as string | null) ?? null,
      order_at: (row.order_at as string | null) ?? null,
      total_amount: toNullableNumber(row.total_amount),
      line_item_sum: toNumber(row.line_item_sum),
      divergence: toNumber(row.divergence),
      class: (row.class as string | null) ?? null,
    })),
    reconciliationCount: reconCountRes.count ?? 0,
    suspectedDuplicates: (dupRes.data ?? []) as unknown as MergeCandidateRow[],
    refreshState: (stateRes.data as IncentiveRefreshState | null) ?? null,
  }
}

export async function getBellFeed(limit = 25): Promise<BellLogRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('incentive_bell_log')
    .select('*')
    .order('rung_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as BellLogRow[]
}

// ---------------------------------------------------------------------------
// Admin writes (service role; called from admin API routes only)
// ---------------------------------------------------------------------------

export async function listMergeMappings(): Promise<MergeMapRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('customer_merge_map')
    .select('*')
    .order('canonical_key')
    .limit(2000)
  if (error) throw error
  return (data ?? []) as unknown as MergeMapRow[]
}

export async function addMergeMapping(input: {
  duplicateKey: string
  canonicalKey: string
  reason?: string
  createdBy?: string | null
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('customer_merge_map').insert({
    duplicate_key: input.duplicateKey,
    canonical_key: input.canonicalKey,
    reason: input.reason ?? null,
    created_by: input.createdBy ?? null,
  })
  if (error) throw error
}

export async function removeMergeMapping(duplicateKey: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('customer_merge_map').delete().eq('duplicate_key', duplicateKey)
  if (error) throw error
}

export async function resolveRepAlias(input: {
  fishbowlSalesperson: string
  action: 'assign' | 'house' | 'system'
  displayName?: string
  sfUserId?: string | null
  notes?: string | null
}): Promise<void> {
  const supabase = createAdminClient()
  const displayName =
    input.action === 'assign'
      ? input.displayName
      : input.displayName ?? input.fishbowlSalesperson

  const { error } = await supabase.from('fishbowl_salesperson_aliases').upsert(
    {
      fishbowl_salesperson: input.fishbowlSalesperson,
      sf_user_id: input.action === 'assign' ? input.sfUserId ?? null : null,
      display_name: displayName,
      team: input.action === 'assign' ? 'Sales' : input.action === 'house' ? 'House' : 'System',
      is_active: true,
      is_house_account: input.action === 'house',
      is_system_alias: input.action === 'system',
      // Never auto-add to the sales dashboard roster.
      show_on_sales_dashboard: false,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'fishbowl_salesperson' }
  )
  if (error) throw error
}

export async function triggerIncentiveRefreshRpc(): Promise<Record<string, unknown>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('refresh_incentive_classification')
  if (error) throw error
  return (data ?? {}) as Record<string, unknown>
}

export async function triggerRevenueCohortRefreshRpc(): Promise<Record<string, unknown>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('refresh_revenue_cohorts')
  if (error) throw error
  return (data ?? {}) as Record<string, unknown>
}

export async function triggerIncentiveWorklistRefreshRpc(): Promise<Record<string, unknown>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('refresh_incentive_worklists')
  if (error) throw error
  return (data ?? {}) as Record<string, unknown>
}

export async function freezeIncentiveMonth(
  month: string,
  frozenBy: string | null,
  force = false
): Promise<Record<string, unknown>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('freeze_incentive_month', {
    p_month: month,
    p_frozen_by: frozenBy,
    p_force: force,
  })
  if (error) throw error
  return (data ?? {}) as Record<string, unknown>
}

export async function getPayoutSnapshots(): Promise<PayoutSnapshotRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('incentive_payout_snapshot')
    .select('month, rep_key, rep_display_name, enrollments, enrollment_gate, qualifies, net_new_customer_revenue, base_commission, bonus_commission, projected_total, frozen_at, frozen_by')
    .order('month', { ascending: true })
    .order('projected_total', { ascending: false })
    .limit(2000)
  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    month: String(row.month),
    enrollments: toNumber(row.enrollments),
    enrollment_gate: toNumber(row.enrollment_gate),
    net_new_customer_revenue: toNumber(row.net_new_customer_revenue),
    base_commission: toNumber(row.base_commission),
    bonus_commission: toNumber(row.bonus_commission),
    projected_total: toNumber(row.projected_total),
  })) as PayoutSnapshotRow[]
}

export async function getPayoutVariance(): Promise<PayoutVarianceRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('v_incentive_payout_variance')
    .select('*')
    .order('month', { ascending: true })
    .limit(2000)
  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    month: String(row.month),
    frozen_total: toNumber(row.frozen_total),
    live_total: toNumber(row.live_total),
    variance: toNumber(row.variance),
    frozen_enrollments: toNumber(row.frozen_enrollments),
    live_enrollments: toNumber(row.live_enrollments),
  })) as PayoutVarianceRow[]
}

export interface RepClassBreakdown {
  newWindowRevenue: number
  newWindowOrders: number
  winBackRevenue: number
  winBackOrders: number
  recurringRevenue: number
  recurringOrders: number
  creditsAmount: number // negative (EXCLUDED_NEGATIVE net amounts)
  creditsOrders: number
}

/** Per-class revenue for one rep-month, from the classification table. */
export async function getRepClassBreakdown(repKey: string, month: string): Promise<RepClassBreakdown> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('order_incentive_class')
    .select('class, net_amount')
    .eq('rep_key', repKey)
    .eq('order_month', month)
    .limit(10000)
  if (error) throw error

  const breakdown: RepClassBreakdown = {
    newWindowRevenue: 0, newWindowOrders: 0,
    winBackRevenue: 0, winBackOrders: 0,
    recurringRevenue: 0, recurringOrders: 0,
    creditsAmount: 0, creditsOrders: 0,
  }
  for (const row of data ?? []) {
    const amount = toNumber(row.net_amount)
    switch (row.class) {
      case 'NEW_WINDOW':
        breakdown.newWindowRevenue += amount
        breakdown.newWindowOrders++
        break
      case 'WIN_BACK':
        breakdown.winBackRevenue += amount
        breakdown.winBackOrders++
        break
      case 'RECURRING':
        breakdown.recurringRevenue += amount
        breakdown.recurringOrders++
        break
      case 'EXCLUDED_NEGATIVE':
        breakdown.creditsAmount += amount
        breakdown.creditsOrders++
        break
    }
  }
  return breakdown
}

/** The rep_key a signed-in user is locked to (profiles.sf_user_id), if any. */
export async function getRepKeyForUser(userId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('sf_user_id')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  const key = (data?.sf_user_id as string | null) ?? null
  return key && key.trim() !== '' ? key : null
}

export async function getRefreshState(): Promise<IncentiveRefreshState | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('incentive_refresh_state')
    .select('dirty_at, last_refresh_at, last_refresh_result')
    .maybeSingle()
  if (error) throw error
  return (data as IncentiveRefreshState | null) ?? null
}
