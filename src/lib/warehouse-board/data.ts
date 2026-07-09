import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type LaneSeverity = 'ok' | 'warn' | 'critical'

export interface WallboardOrder {
  soNumber: string
  customer: string
  shipTo: string | null
  salesperson: string | null
  ageDays: number
  scheduled: string | null
  daysPastScheduled: number | null
  lines: number
  qty: number
  qtyFulfilled: number
  pct: number
  partialLines: number
  severity: LaneSeverity
  completedAt: string | null
  completedToday: boolean
}

export interface WallboardData {
  generatedAt: string
  syncAgeMinutes: number | null
  kpis: {
    readyCount: number
    pickingCount: number
    lateCount: number
    stuckPickCount: number
    staleBacklogCount: number
    shippedThisWeek: number
  }
  /** Full lists — the client caps the ambient lanes and offers an
   *  expanded, sortable view of everything. */
  ready: WallboardOrder[]
  picking: WallboardOrder[]
  shipped: WallboardOrder[]
  closedShort: WallboardOrder[]
  longestWaiting: WallboardOrder[]
  alerts: string[]
}

type SoRow = {
  so_number: string
  status: string
  customer_name: string | null
  ship_to_city: string | null
  ship_to_state: string | null
  salesperson: string | null
  date_issued: string | null
  date_scheduled: string | null
  date_completed: string | null
  last_synced_at: string | null
}

type ItemAgg = { lines: number; qty: number; fulfilled: number; partial: number }

function dayDiff(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000))
}

function severityFor(status: string, ageDays: number): LaneSeverity {
  if (status === 'Issued') {
    if (ageDays > 7) return 'critical'
    if (ageDays >= 3) return 'warn'
    return 'ok'
  }
  // In Progress: picking has started — slower thresholds
  if (ageDays > 14) return 'critical'
  if (ageDays >= 7) return 'warn'
  return 'ok'
}

function toOrder(
  row: SoRow,
  agg: ItemAgg | undefined,
  now: Date
): WallboardOrder {
  const issued = row.date_issued ? new Date(row.date_issued) : null
  const ageDays = issued ? dayDiff(issued, now) : 0
  const scheduled = row.date_scheduled ? new Date(row.date_scheduled + 'T00:00:00') : null
  const qty = agg?.qty ?? 0
  const fulfilled = agg?.fulfilled ?? 0
  const completed = row.date_completed ? new Date(row.date_completed) : null
  return {
    soNumber: row.so_number,
    customer: row.customer_name ?? '—',
    shipTo:
      row.ship_to_city && row.ship_to_state
        ? `${row.ship_to_city}, ${row.ship_to_state}`
        : (row.ship_to_state ?? row.ship_to_city),
    salesperson: row.salesperson,
    ageDays,
    scheduled: row.date_scheduled,
    daysPastScheduled: scheduled ? dayDiff(scheduled, now) : null,
    lines: agg?.lines ?? 0,
    qty,
    qtyFulfilled: fulfilled,
    pct: qty > 0 ? Math.min(100, Math.round((fulfilled / qty) * 100)) : 0,
    partialLines: agg?.partial ?? 0,
    severity: severityFor(row.status, ageDays),
    completedAt: row.date_completed,
    completedToday:
      completed !== null && completed.toDateString() === now.toDateString(),
  }
}

export async function getWallboardData(): Promise<WallboardData> {
  const supabase = createAdminClient()
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString()

  const soColumns =
    'so_number, status, customer_name, ship_to_city, ship_to_state, salesperson, date_issued, date_scheduled, date_completed, last_synced_at'

  const [openRes, shippedRes, shortRes] = await Promise.all([
    supabase
      .from('fb_sales_orders')
      .select(soColumns)
      .in('status', ['Issued', 'In Progress'])
      .order('date_issued', { ascending: true }),
    supabase
      .from('fb_sales_orders')
      .select(soColumns)
      .eq('status', 'Fulfilled')
      .gte('date_completed', weekAgo)
      .order('date_completed', { ascending: false }),
    supabase
      .from('fb_sales_orders')
      .select(soColumns)
      .eq('status', 'Closed Short')
      .gte('date_completed', monthAgo)
      .order('date_completed', { ascending: false }),
  ])
  if (openRes.error) throw openRes.error
  const open = (openRes.data ?? []) as SoRow[]
  const shipped = (shippedRes.data ?? []) as SoRow[]
  const closedShort = (shortRes.data ?? []) as SoRow[]

  // Line-item aggregates for every SO on the board (batch the IN() filter).
  const soNumbers = [...open, ...shipped, ...closedShort].map((r) => r.so_number)
  const aggs = new Map<string, ItemAgg>()
  for (let i = 0; i < soNumbers.length; i += 150) {
    const batch = soNumbers.slice(i, i + 150)
    const { data, error } = await supabase
      .from('fb_sales_order_items')
      .select('sales_order_number, quantity, quantity_fulfilled')
      .in('sales_order_number', batch)
    if (error) throw error
    for (const row of data ?? []) {
      const key = row.sales_order_number as string
      const agg = aggs.get(key) ?? { lines: 0, qty: 0, fulfilled: 0, partial: 0 }
      const q = Number(row.quantity ?? 0)
      const f = Number(row.quantity_fulfilled ?? 0)
      agg.lines += 1
      agg.qty += q
      agg.fulfilled += f
      if (f > 0 && f < q) agg.partial += 1
      aggs.set(key, agg)
    }
  }

  const toO = (r: SoRow) => toOrder(r, aggs.get(r.so_number), now)

  const ready = open.filter((r) => r.status === 'Issued').map(toO)
  const picking = open.filter((r) => r.status === 'In Progress').map(toO)
  const shippedO = shipped.map(toO)
  const shortO = closedShort.map(toO)

  // Oldest first = most critical at the top of each lane.
  ready.sort((a, b) => b.ageDays - a.ageDays)
  picking.sort((a, b) => b.ageDays - a.ageDays)

  const allOpen = [...ready, ...picking]
  const lateCount = allOpen.filter((o) => o.ageDays > 7).length
  const staleBacklogCount = allOpen.filter((o) => o.ageDays > 90).length
  const stuck = picking.filter((o) => o.ageDays > 14)

  const readyCritical = ready.filter(
    (o) => o.severity === 'critical' && o.ageDays <= 90
  )

  const longestWaiting = allOpen
    .slice()
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 6)

  const alerts: string[] = []
  for (const o of stuck.slice(0, 3)) {
    alerts.push(
      `${o.soNumber} ${o.customer} — picking stalled ${o.ageDays}d${
        o.partialLines > 0 ? ` (${o.partialLines} partial line${o.partialLines > 1 ? 's' : ''})` : ''
      }`
    )
  }
  for (const o of readyCritical.slice(0, 3)) {
    alerts.push(`${o.soNumber} ${o.customer} — waiting to pick ${o.ageDays}d`)
  }
  for (const o of shortO.slice(0, 2)) {
    alerts.push(`${o.soNumber} ${o.customer} — closed short, review lines`)
  }

  const newestSync = open
    .concat(shipped)
    .map((r) => r.last_synced_at)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1)

  return {
    generatedAt: now.toISOString(),
    syncAgeMinutes: newestSync
      ? Math.round((now.getTime() - new Date(newestSync).getTime()) / 60000)
      : null,
    kpis: {
      readyCount: ready.length,
      pickingCount: picking.length,
      lateCount,
      stuckPickCount: stuck.length,
      staleBacklogCount,
      shippedThisWeek: shippedO.length,
    },
    ready,
    picking,
    shipped: shippedO,
    closedShort: shortO,
    longestWaiting,
    alerts,
  }
}
