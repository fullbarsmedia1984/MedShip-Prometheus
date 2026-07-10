import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type LaneSeverity = 'ok' | 'warn' | 'critical'

/** Stock posture of an Issued (ready-to-pick) order, from cached Fishbowl
 *  inventory + open purchase-order lines:
 *  - ready:       every unfulfilled Sale line is on hand — pick it now
 *  - partial:     some lines on hand, the rest short but on order
 *  - awaiting_po: short lines exist and all are covered by open POs
 *  - not_ordered: at least one short line has NO open PO — needs purchasing
 *  - na:          no evaluable Sale lines (drop-ship / service / kit order)
 */
export type StockState = 'ready' | 'partial' | 'awaiting_po' | 'not_ordered' | 'na'

export interface StockInfo {
  state: StockState
  evaluatedLines: number
  shortLines: number
  onOrderLines: number
  /** earliest expected date among covering POs, YYYY-MM-DD */
  eta: string | null
}

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
  /** shipment(s) went out but the SO still has open lines */
  partialShipment: boolean
  /** populated for ready-to-pick orders only */
  stock: StockInfo | null
}

export interface SyncAges {
  /** minutes since the newest fb_sales_orders row sync */
  so: number | null
  /** minutes since the open-PO cache refresh */
  po: number | null
  /** minutes since the newest inventory_snapshot row sync */
  inventory: number | null
  /** minutes since the shipments cache refresh */
  shipments: number | null
}

export interface WallboardData {
  generatedAt: string
  syncAges: SyncAges
  kpis: {
    readyCount: number
    pickingCount: number
    lateCount: number
    stuckPickCount: number
    noPoCount: number
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

// Aggregates count warehouse-fulfillable lines only (Sale/Kit); Drop Ship
// lines ship from the vendor and never touch the floor. `dropShip` tallies
// them so pure drop-ship SOs can be excluded from the board entirely.
type ItemAgg = {
  lines: number
  qty: number
  fulfilled: number
  partial: number
  dropShip: number
}

// PostgREST caps a response at 1,000 rows — page through anything that can
// exceed that (line items are ~16 rows per SO).
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

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
    stock: null,
    partialShipment: false,
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
  const fulfilled = (shippedRes.data ?? []) as SoRow[]
  const closedShort = (shortRes.data ?? []) as SoRow[]

  // Shipments are the ground truth for "went out the door": a shipment in
  // the last 7 days puts the SO on the Shipped lane even while the SO is
  // still In Progress (partial) or before date_completed lands in the cache.
  const { data: shipRows, error: shipErr } = await supabase
    .from('fb_recent_shipments')
    .select('so_number, date_shipped, synced_at')
    .gte('date_shipped', weekAgo)
  if (shipErr) throw shipErr
  const latestShipBySo = new Map<string, string>()
  for (const row of shipRows ?? []) {
    const cur = latestShipBySo.get(row.so_number as string)
    const ts = row.date_shipped as string
    if (!cur || ts > cur) latestShipBySo.set(row.so_number as string, ts)
  }

  // SO rows for shipment-sourced orders that aren't already loaded
  // (e.g. flipped Fulfilled with a stale date_completed, or Closed Short).
  const loadedSos = new Set(
    [...open, ...fulfilled, ...closedShort].map((r) => r.so_number)
  )
  const missingShipSos = [...latestShipBySo.keys()].filter(
    (so) => !loadedSos.has(so)
  )
  let shipOnlyRows: SoRow[] = []
  if (missingShipSos.length > 0) {
    const { data, error } = await supabase
      .from('fb_sales_orders')
      .select(soColumns)
      .in('so_number', missingShipSos)
    if (error) throw error
    shipOnlyRows = (data ?? []) as SoRow[]
  }

  // Line-item aggregates for every SO on the board (batch the IN() filter).
  // For Issued orders also collect unfulfilled Sale lines for the stock check.
  const issuedSos = new Set(
    open.filter((r) => r.status === 'Issued').map((r) => r.so_number)
  )
  const soNumbers = [...open, ...fulfilled, ...closedShort, ...shipOnlyRows].map(
    (r) => r.so_number
  )
  const aggs = new Map<string, ItemAgg>()
  const openSaleLines = new Map<string, { part: string; remaining: number }[]>()
  for (let i = 0; i < soNumbers.length; i += 100) {
    const batch = soNumbers.slice(i, i + 100)
    const data = await pageAll((from, to) =>
      supabase
        .from('fb_sales_order_items')
        .select(
          'sales_order_number, part_number, quantity, quantity_fulfilled, line_type:raw_data->type->>name'
        )
        .in('sales_order_number', batch)
        .order('id')
        .range(from, to)
    )
    for (const row of data) {
      const key = row.sales_order_number as string
      const lineType = (row as { line_type?: string | null }).line_type ?? null
      const agg =
        aggs.get(key) ??
        { lines: 0, qty: 0, fulfilled: 0, partial: 0, dropShip: 0 }
      const q = Number(row.quantity ?? 0)
      const f = Number(row.quantity_fulfilled ?? 0)
      if (lineType === 'Drop Ship') {
        agg.dropShip += 1
      } else if (lineType === 'Sale' || lineType === 'Kit') {
        agg.lines += 1
        agg.qty += q
        agg.fulfilled += f
        if (f > 0 && f < q) agg.partial += 1
      }
      aggs.set(key, agg)

      if (
        issuedSos.has(key) &&
        lineType === 'Sale' &&
        q - f > 0 &&
        row.part_number
      ) {
        const list = openSaleLines.get(key) ?? []
        list.push({ part: String(row.part_number), remaining: q - f })
        openSaleLines.set(key, list)
      }
    }
  }

  // Warehouse stock (on hand, summed across locations) for the parts on
  // Issued orders, plus the open-PO cache for "is it on order?".
  const neededParts = [
    ...new Set([...openSaleLines.values()].flat().map((l) => l.part)),
  ]
  const onHand = new Map<string, number>()
  for (let i = 0; i < neededParts.length; i += 100) {
    const batch = neededParts.slice(i, i + 100)
    const data = await pageAll((from, to) =>
      supabase
        .from('inventory_snapshot')
        .select('part_number, qty_on_hand')
        .in('part_number', batch)
        .order('id')
        .range(from, to)
    )
    for (const row of data) {
      const key = row.part_number as string
      onHand.set(key, (onHand.get(key) ?? 0) + Number(row.qty_on_hand ?? 0))
    }
  }

  const onOrder = new Map<string, { qty: number; eta: string | null }>()
  {
    const data = await pageAll((from, to) =>
      supabase
        .from('fb_open_po_lines')
        .select('part_number, qty_open, expected_date')
        .order('id')
        .range(from, to)
    )
    for (const row of data) {
      const key = row.part_number as string
      const cur = onOrder.get(key) ?? { qty: 0, eta: null }
      cur.qty += Number(row.qty_open ?? 0)
      const eta = row.expected_date as string | null
      if (eta && (!cur.eta || eta < cur.eta)) cur.eta = eta
      onOrder.set(key, cur)
    }
  }

  function stockFor(soNumber: string): StockInfo {
    const lines = openSaleLines.get(soNumber) ?? []
    if (lines.length === 0) {
      return { state: 'na', evaluatedLines: 0, shortLines: 0, onOrderLines: 0, eta: null }
    }
    let short = 0
    let covered = 0
    let eta: string | null = null
    for (const l of lines) {
      if ((onHand.get(l.part) ?? 0) >= l.remaining) continue
      short += 1
      const po = onOrder.get(l.part)
      if (po && po.qty > 0) {
        covered += 1
        if (po.eta && (!eta || po.eta < eta)) eta = po.eta
      }
    }
    const state: StockState =
      short === 0
        ? 'ready'
        : covered < short
          ? 'not_ordered'
          : short === lines.length
            ? 'awaiting_po'
            : 'partial'
    return {
      state,
      evaluatedLines: lines.length,
      shortLines: short,
      onOrderLines: covered,
      eta,
    }
  }

  // Pure drop-ship SOs (vendor ships everything; no warehouse lines) never
  // enter the building — drop them from every lane and KPI.
  const isDropShipSo = (soNumber: string): boolean => {
    const agg = aggs.get(soNumber)
    return Boolean(agg && agg.dropShip > 0 && agg.lines === 0)
  }
  const openWh = open.filter((r) => !isDropShipSo(r.so_number))
  const fulfilledWh = fulfilled.filter((r) => !isDropShipSo(r.so_number))
  const closedShortWh = closedShort.filter((r) => !isDropShipSo(r.so_number))

  const toO = (r: SoRow) => toOrder(r, aggs.get(r.so_number), now)

  const ready = openWh
    .filter((r) => r.status === 'Issued')
    .map((r) => ({ ...toO(r), stock: stockFor(r.so_number) }))
  const picking = openWh.filter((r) => r.status === 'In Progress').map(toO)
  const shortO = closedShortWh.map(toO)

  // Shipped lane: SOs with a shipment in the last 7 days, unioned with
  // Fulfilled-in-window SOs (covers fulfillments whose ship records predate
  // the cache). Shipment dates override completedAt; an SO that shipped but
  // still has open lines is flagged as a partial shipment (it also stays in
  // Picking — both are true).
  const shippedBySo = new Map<string, WallboardOrder>()
  for (const row of fulfilledWh) {
    shippedBySo.set(row.so_number, toO(row))
  }
  const allRowsBySo = new Map<string, SoRow>(
    [...open, ...fulfilled, ...closedShort, ...shipOnlyRows].map((r) => [
      r.so_number,
      r,
    ])
  )
  for (const [soNumber, shippedAt] of latestShipBySo) {
    const row = allRowsBySo.get(soNumber)
    if (!row || isDropShipSo(soNumber)) continue
    const base = shippedBySo.get(soNumber) ?? toO(row)
    const shippedDate = new Date(shippedAt)
    shippedBySo.set(soNumber, {
      ...base,
      completedAt:
        !base.completedAt || shippedAt > base.completedAt
          ? shippedAt
          : base.completedAt,
      completedToday:
        base.completedToday ||
        shippedDate.toDateString() === now.toDateString(),
      partialShipment: row.status === 'In Progress',
    })
  }
  const shippedO = [...shippedBySo.values()].sort((a, b) =>
    (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
  )

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

  const noPo = ready.filter((o) => o.stock?.state === 'not_ordered')

  const alerts: string[] = []
  for (const o of noPo.slice(0, 3)) {
    const s = o.stock!
    alerts.push(
      `${o.soNumber} ${o.customer} — ${s.shortLines - s.onOrderLines} line${
        s.shortLines - s.onOrderLines > 1 ? 's' : ''
      } short with NO PO`
    )
  }
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

  const newestSoSync = open
    .concat(fulfilled)
    .map((r) => r.last_synced_at)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1)

  const ageMinutes = (ts: string | null | undefined): number | null =>
    ts ? Math.round((now.getTime() - new Date(ts).getTime()) / 60000) : null

  const [poSync, invSync, shipSync] = await Promise.all([
    supabase
      .from('fb_open_po_lines')
      .select('synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('inventory_snapshot')
      .select('last_synced_at')
      .order('last_synced_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('fb_recent_shipments')
      .select('synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return {
    generatedAt: now.toISOString(),
    syncAges: {
      so: ageMinutes(newestSoSync),
      po: ageMinutes(poSync.data?.synced_at as string | undefined),
      inventory: ageMinutes(invSync.data?.last_synced_at as string | undefined),
      shipments: ageMinutes(shipSync.data?.synced_at as string | undefined),
    },
    kpis: {
      readyCount: ready.length,
      pickingCount: picking.length,
      lateCount,
      stuckPickCount: stuck.length,
      noPoCount: noPo.length,
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
