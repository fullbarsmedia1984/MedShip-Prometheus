import { createAdminClient } from '@/lib/supabase/admin'

// Revenue cohorts (migration 028): NEW = first-ever purchaser (365-day
// period from the first SO), WINBACK = returned after a >=365-day lapse
// (365-day period, re-entrant), RECURRING = everything else. LAPSED is a
// customer-state-only bucket (no purchase in >=365 days — winback-eligible).

export type RevenueCohort = 'NEW' | 'WINBACK' | 'RECURRING'
export type CustomerCohortState = RevenueCohort | 'LAPSED'

export type CohortMonthlyPoint = {
  month: string        // e.g. "Jul 25" (America/Chicago bucket)
  monthDate: string    // ISO first-of-month
  NEW: number
  WINBACK: number
  RECURRING: number
}

export type CohortSnapshot = {
  customers: Record<CustomerCohortState, number>
  totalCustomers: number
  mtdRevenue: Record<RevenueCohort, number>
  mtdOrders: Record<RevenueCohort, number>
  mtdNewCustomers: number
  mtdWinbackEntries: number
}

export type CohortEntryRow = {
  soNumber: string
  customerName: string | null
  cohort: 'NEW' | 'WINBACK'
  orderAt: string
  amount: number | null
  priorGapDays: number | null
  reason: string
}

export type WinbackOpportunityRow = {
  canonicalKey: string
  customerName: string | null
  lastRep: string | null
  state: string | null
  lastOrderAt: string
  lastOrderSo: string
  daysLapsed: number
  revenue3yr: number
  revenueLifetime: number
  lifetimeOrders: number
}

export type CohortDashboard = {
  monthly: CohortMonthlyPoint[]
  snapshot: CohortSnapshot
  recentEntries: CohortEntryRow[]
  winbackOpportunities: WinbackOpportunityRow[]
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

function monthLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`)
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function chicagoCurrentMonthIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
  return `${parts.slice(0, 7)}-01`
}

export async function getCohortMonthly(monthsBack = 13): Promise<CohortMonthlyPoint[]> {
  const supabase = createAdminClient()
  const since = new Date()
  since.setMonth(since.getMonth() - monthsBack)
  const sinceIso = `${since.toISOString().slice(0, 7)}-01`

  const { data, error } = await supabase
    .from('v_revenue_cohort_monthly')
    .select('order_month, cohort, orders, revenue')
    .gte('order_month', sinceIso)
    .order('order_month', { ascending: true })
  if (error) throw error

  const byMonth = new Map<string, CohortMonthlyPoint>()
  for (const row of data ?? []) {
    const monthDate = String(row.order_month)
    const point = byMonth.get(monthDate) ?? {
      month: monthLabel(monthDate),
      monthDate,
      NEW: 0,
      WINBACK: 0,
      RECURRING: 0,
    }
    const cohort = String(row.cohort) as RevenueCohort
    if (cohort === 'NEW' || cohort === 'WINBACK' || cohort === 'RECURRING') {
      point[cohort] = Math.max(0, Math.round(toNumber(row.revenue)))
    }
    byMonth.set(monthDate, point)
  }
  return Array.from(byMonth.values()).sort((a, b) => a.monthDate.localeCompare(b.monthDate))
}

export async function getCohortSnapshot(): Promise<CohortSnapshot> {
  const supabase = createAdminClient()
  const states: CustomerCohortState[] = ['NEW', 'WINBACK', 'RECURRING', 'LAPSED']

  const customerCounts = await Promise.all(
    states.map(async (state) => {
      const { count, error } = await supabase
        .from('v_customer_cohort_current')
        .select('canonical_customer_key', { count: 'exact', head: true })
        .eq('current_cohort', state)
      if (error) throw error
      return count ?? 0
    })
  )

  const currentMonth = chicagoCurrentMonthIso()
  const { data: mtdRows, error: mtdError } = await supabase
    .from('v_revenue_cohort_monthly')
    .select('cohort, orders, revenue, cohort_entries')
    .eq('order_month', currentMonth)
  if (mtdError) throw mtdError

  const mtdRevenue: Record<RevenueCohort, number> = { NEW: 0, WINBACK: 0, RECURRING: 0 }
  const mtdOrders: Record<RevenueCohort, number> = { NEW: 0, WINBACK: 0, RECURRING: 0 }
  let mtdNewCustomers = 0
  let mtdWinbackEntries = 0
  for (const row of mtdRows ?? []) {
    const cohort = String(row.cohort) as RevenueCohort
    if (cohort !== 'NEW' && cohort !== 'WINBACK' && cohort !== 'RECURRING') continue
    mtdRevenue[cohort] = Math.round(toNumber(row.revenue))
    mtdOrders[cohort] = toNumber(row.orders)
    if (cohort === 'NEW') mtdNewCustomers = toNumber(row.cohort_entries)
    if (cohort === 'WINBACK') mtdWinbackEntries = toNumber(row.cohort_entries)
  }

  return {
    customers: {
      NEW: customerCounts[0],
      WINBACK: customerCounts[1],
      RECURRING: customerCounts[2],
      LAPSED: customerCounts[3],
    },
    totalCustomers: customerCounts.reduce((sum, count) => sum + count, 0),
    mtdRevenue,
    mtdOrders,
    mtdNewCustomers,
    mtdWinbackEntries,
  }
}

export async function getRecentCohortEntries(limit = 12): Promise<CohortEntryRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('order_revenue_cohort')
    .select('so_number, cohort, order_at, amount, prior_gap_days, cohort_reason')
    .eq('is_cohort_entry', true)
    .order('order_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  const soNumbers = (data ?? []).map((row) => String(row.so_number))
  const names = new Map<string, string | null>()
  if (soNumbers.length > 0) {
    const { data: orders, error: nameError } = await supabase
      .from('fb_sales_orders')
      .select('so_number, customer_name')
      .in('so_number', soNumbers)
    if (nameError) throw nameError
    for (const order of orders ?? []) {
      names.set(String(order.so_number), (order.customer_name as string | null) ?? null)
    }
  }

  return (data ?? []).map((row) => ({
    soNumber: String(row.so_number),
    customerName: names.get(String(row.so_number)) ?? null,
    cohort: String(row.cohort) as 'NEW' | 'WINBACK',
    orderAt: String(row.order_at),
    amount: row.amount === null || row.amount === undefined ? null : toNumber(row.amount),
    priorGapDays: row.prior_gap_days === null || row.prior_gap_days === undefined
      ? null
      : toNumber(row.prior_gap_days),
    reason: String(row.cohort_reason ?? ''),
  }))
}

/** Top lapsed customers for winback outreach, ranked by recent value. */
export async function getWinbackOpportunities(limit = 150): Promise<WinbackOpportunityRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('v_winback_opportunities')
    .select('*')
    .order('revenue_3yr', { ascending: false })
    .limit(limit)
  if (error) throw error

  return (data ?? []).map((row) => ({
    canonicalKey: String(row.canonical_customer_key),
    customerName: (row.customer_name as string | null) ?? null,
    lastRep: (row.last_rep_display_name as string | null) ?? (row.last_salesperson as string | null) ?? null,
    state: (row.ship_to_state as string | null) ?? null,
    lastOrderAt: String(row.last_order_at),
    lastOrderSo: String(row.last_order_so),
    daysLapsed: toNumber(row.days_lapsed),
    revenue3yr: toNumber(row.revenue_3yr),
    revenueLifetime: toNumber(row.revenue_lifetime),
    lifetimeOrders: toNumber(row.lifetime_orders),
  }))
}

export async function getCohortDashboard(): Promise<CohortDashboard> {
  const [monthly, snapshot, recentEntries, winbackOpportunities] = await Promise.all([
    getCohortMonthly(),
    getCohortSnapshot(),
    getRecentCohortEntries(),
    getWinbackOpportunities(),
  ])
  return { monthly, snapshot, recentEntries, winbackOpportunities }
}
