import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { shipDeadline, workdaysBetween } from './workdays'

// P13 Kit Assembly workbench (Phase 1).
// One row per -KIT sales order: live Fishbowl facts (status, pick progress,
// backorders, shipments) joined with the human ops overlay (kit_orders).

export interface KitOpsFields {
  earliest_need_by: string | null
  absolute_need_by: string | null
  transit_days: number | null
  rep: string | null
  table_location: string | null
  kit_list_printed: boolean
  sub_kit_status: 'received' | 'pack_as_needed' | null
  notes: string | null
}

export interface KitBackorderLine {
  part: string
  desc: string | null
  short: number
  onOrder: boolean
  eta: string | null
}

export type KitUrgency =
  | 'overdue'
  | 'due_today'
  | 'this_week'
  | 'on_track'
  | 'no_dates'
  | 'shipped'

export interface KitRow {
  soNumber: string
  school: string
  status: 'waiting' | 'assembling' | 'shipped'
  poReceived: string | null
  kits: number
  lineItems: number
  units: number
  unitsDone: number
  pct: number
  ops: KitOpsFields
  /** need-by minus transit (workdays); null until dates are entered */
  earliestShipBy: string | null
  latestShipBy: string | null
  shippedAt: string | null
  /** workdays from PO received to ship */
  turnTimeDays: number | null
  onTime: boolean | null
  urgency: KitUrgency
  backorders: KitBackorderLine[]
  backordersNoPo: number
}

export interface KitWorkbench {
  generatedAt: string
  rows: KitRow[]
  totals: {
    open: number
    needsDates: number
    overdue: number
    dueThisWeek: number
    backorderNoPo: number
    shipped30d: number
  }
}

const EMPTY_OPS: KitOpsFields = {
  earliest_need_by: null,
  absolute_need_by: null,
  transit_days: null,
  rep: null,
  table_location: null,
  kit_list_printed: false,
  sub_kit_status: null,
  notes: null,
}

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

export async function getKitWorkbench(): Promise<KitWorkbench> {
  const supabase = createAdminClient()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString()

  type SoRow = {
    so_number: string
    customer_name: string | null
    status: string
    date_issued: string | null
    date_completed: string | null
  }
  const [openRes, doneRes, opsRes] = await Promise.all([
    supabase
      .from('fb_sales_orders')
      .select('so_number, customer_name, status, date_issued, date_completed')
      .ilike('so_number', '%-KIT%')
      .in('status', ['Issued', 'In Progress']),
    supabase
      .from('fb_sales_orders')
      .select('so_number, customer_name, status, date_issued, date_completed')
      .ilike('so_number', '%-KIT%')
      .in('status', ['Fulfilled', 'Closed Short'])
      .gte('date_completed', monthAgo),
    supabase.from('kit_orders').select('*'),
  ])
  if (openRes.error) throw openRes.error
  if (doneRes.error) throw doneRes.error
  if (opsRes.error) throw opsRes.error

  const soRows = [
    ...((openRes.data ?? []) as SoRow[]),
    ...((doneRes.data ?? []) as SoRow[]),
  ]
  const opsBySo = new Map<string, KitOpsFields>(
    (opsRes.data ?? []).map((r) => [
      r.so_number as string,
      {
        earliest_need_by: r.earliest_need_by,
        absolute_need_by: r.absolute_need_by,
        transit_days: r.transit_days,
        rep: r.rep,
        table_location: r.table_location,
        kit_list_printed: r.kit_list_printed,
        sub_kit_status: r.sub_kit_status,
        notes: r.notes,
      },
    ])
  )

  // shipments (ground truth for shipped date)
  const { data: shipRows, error: shipErr } = await supabase
    .from('fb_recent_shipments')
    .select('so_number, date_shipped')
    .in('so_number', soRows.map((r) => r.so_number))
  if (shipErr) throw shipErr
  const latestShip = new Map<string, string>()
  for (const row of shipRows ?? []) {
    const cur = latestShip.get(row.so_number as string)
    if (!cur || (row.date_shipped as string) > cur) {
      latestShip.set(row.so_number as string, row.date_shipped as string)
    }
  }

  // line items (Sale/Kit lines only)
  type ItemRow = {
    sales_order_number: string
    part_number: string | null
    quantity: number | null
    quantity_fulfilled: number | null
    line_type: string | null
    prod_desc: string | null
  }
  const itemsBySo = new Map<string, ItemRow[]>()
  const soNumbers = soRows.map((r) => r.so_number)
  for (let i = 0; i < soNumbers.length; i += 60) {
    const batch = soNumbers.slice(i, i + 60)
    const rows = await pageAll<ItemRow>((from, to) =>
      supabase
        .from('fb_sales_order_items')
        .select(
          'sales_order_number, part_number, quantity, quantity_fulfilled, line_type:raw_data->type->>name, prod_desc:raw_data->product->>description'
        )
        .in('sales_order_number', batch)
        .order('id')
        .range(from, to)
    )
    for (const row of rows) {
      if (row.line_type !== 'Sale' && row.line_type !== 'Kit') continue
      if (!row.part_number) continue
      ;(itemsBySo.get(row.sales_order_number) ??
        itemsBySo.set(row.sales_order_number, []).get(row.sales_order_number)!)
        .push(row)
    }
  }

  // stock + open-PO facts for backorder computation
  const parts = [
    ...new Set(
      [...itemsBySo.values()].flat().map((r) => r.part_number as string)
    ),
  ]
  const onHand = new Map<string, number>()
  for (let i = 0; i < parts.length; i += 100) {
    const batch = parts.slice(i, i + 100)
    const rows = await pageAll<{ part_number: string; qty_on_hand: number }>(
      (from, to) =>
        supabase
          .from('inventory_snapshot')
          .select('part_number, qty_on_hand')
          .in('part_number', batch)
          .order('id')
          .range(from, to)
    )
    for (const row of rows) {
      onHand.set(
        row.part_number,
        (onHand.get(row.part_number) ?? 0) + Number(row.qty_on_hand ?? 0)
      )
    }
  }
  const onOrder = new Map<string, { qty: number; eta: string | null }>()
  {
    const rows = await pageAll<{
      part_number: string
      qty_open: number
      expected_date: string | null
    }>((from, to) =>
      supabase
        .from('fb_open_po_lines')
        .select('part_number, qty_open, expected_date')
        .order('id')
        .range(from, to)
    )
    for (const row of rows) {
      const cur = onOrder.get(row.part_number) ?? { qty: 0, eta: null }
      cur.qty += Number(row.qty_open ?? 0)
      if (row.expected_date && (!cur.eta || row.expected_date < cur.eta)) {
        cur.eta = row.expected_date
      }
      onOrder.set(row.part_number, cur)
    }
  }

  const rows: KitRow[] = soRows.map((so) => {
    const items = itemsBySo.get(so.so_number) ?? []
    const units = items.reduce((s, x) => s + Number(x.quantity ?? 0), 0)
    const unitsDone = items.reduce(
      (s, x) =>
        s + Math.min(Number(x.quantity_fulfilled ?? 0), Number(x.quantity ?? 0)),
      0
    )
    const ops = opsBySo.get(so.so_number) ?? EMPTY_OPS
    const shippedAt =
      so.date_completed ?? latestShip.get(so.so_number) ?? null
    const isShipped =
      so.status === 'Fulfilled' ||
      so.status === 'Closed Short' ||
      latestShip.has(so.so_number)

    const backorders: KitBackorderLine[] = []
    for (const it of items) {
      const remaining = Number(it.quantity ?? 0) - Number(it.quantity_fulfilled ?? 0)
      if (remaining <= 0 || isShipped) continue
      const avail = onHand.get(it.part_number as string) ?? 0
      if (avail >= remaining) continue
      const po = onOrder.get(it.part_number as string)
      backorders.push({
        part: it.part_number as string,
        desc: it.prod_desc,
        short: remaining - avail,
        onOrder: Boolean(po && po.qty > 0),
        eta: po?.eta ?? null,
      })
    }

    const transit = ops.transit_days ?? 0
    const earliestShipBy =
      ops.earliest_need_by !== null
        ? shipDeadline(ops.earliest_need_by, transit)
        : null
    const latestShipBy =
      ops.absolute_need_by !== null
        ? shipDeadline(ops.absolute_need_by, transit)
        : null

    const poReceived = so.date_issued?.slice(0, 10) ?? null
    const shippedDay = shippedAt ? shippedAt.slice(0, 10) : null
    const turnTimeDays =
      poReceived && shippedDay ? workdaysBetween(poReceived, shippedDay) : null
    const onTime =
      shippedDay && latestShipBy ? shippedDay <= latestShipBy : null

    let urgency: KitUrgency
    if (isShipped) urgency = 'shipped'
    else if (!latestShipBy) urgency = 'no_dates'
    else if (latestShipBy < today) urgency = 'overdue'
    else if (latestShipBy === today) urgency = 'due_today'
    else if (workdaysBetween(today, latestShipBy) <= 5) urgency = 'this_week'
    else urgency = 'on_track'

    return {
      soNumber: so.so_number,
      school: so.customer_name?.trim() || 'Unassigned',
      status: isShipped
        ? 'shipped'
        : so.status === 'In Progress'
          ? 'assembling'
          : 'waiting',
      poReceived,
      kits: 0, // filled below from the kit master line heuristic
      lineItems: items.length,
      units,
      unitsDone,
      pct: units > 0 ? Math.min(100, Math.round((unitsDone / units) * 100)) : 0,
      ops,
      earliestShipBy,
      latestShipBy,
      shippedAt,
      turnTimeDays,
      onTime,
      urgency,
      backorders,
      backordersNoPo: backorders.filter((b) => !b.onOrder).length,
    }
  })

  // "KITS" count in the workbook = qty of the kit master line (the -KIT /
  // program part). Best heuristic: the largest Kit-type line qty, falling
  // back to the max line qty.
  for (const row of rows) {
    const items = itemsBySo.get(row.soNumber) ?? []
    const kitLines = items.filter((i) => i.line_type === 'Kit')
    const source = kitLines.length > 0 ? kitLines : items
    row.kits = source.reduce(
      (m, i) => Math.max(m, Number(i.quantity ?? 0)),
      0
    )
  }

  const open = rows.filter((r) => r.status !== 'shipped')
  const urgencyRank: Record<KitUrgency, number> = {
    overdue: 0,
    due_today: 1,
    this_week: 2,
    no_dates: 3,
    on_track: 4,
    shipped: 5,
  }
  rows.sort(
    (a, b) =>
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      (a.latestShipBy ?? '9999').localeCompare(b.latestShipBy ?? '9999') ||
      a.soNumber.localeCompare(b.soNumber)
  )

  return {
    generatedAt: now.toISOString(),
    rows,
    totals: {
      open: open.length,
      needsDates: open.filter((r) => r.urgency === 'no_dates').length,
      overdue: open.filter((r) => r.urgency === 'overdue').length,
      dueThisWeek: open.filter(
        (r) => r.urgency === 'due_today' || r.urgency === 'this_week'
      ).length,
      backorderNoPo: open.filter((r) => r.backordersNoPo > 0).length,
      shipped30d: rows.length - open.length,
    },
  }
}
