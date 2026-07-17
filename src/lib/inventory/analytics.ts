import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { chicagoTodayIso } from '@/lib/business-days'

/**
 * Warehouse-manager analytics for /dashboard/inventory.
 *
 * The inventory_snapshot cache only carries on-hand quantities (P2 writes
 * qty_allocated = 0), so everything demand-side is computed live from the
 * fb_* caches instead: open Sale lines on Issued / In Progress SOs are the
 * real "committed" number, open PO lines are the inbound pipeline, and the
 * rolling shipments cache is outbound velocity.
 */

export type ShortageCoverage = 'full' | 'partial' | 'none'

export interface ShortagePart {
  part: string
  description: string | null
  /** open remaining units across Sale lines */
  demand: number
  onHand: number
  short: number
  onOrder: number
  /** earliest expected date among covering open PO lines, YYYY-MM-DD */
  eta: string | null
  /** open SOs touching this part */
  sos: number
  coverage: ShortageCoverage
}

export interface InboundBucket {
  key: 'overdue' | 'this_week' | 'next_week' | 'two_to_four' | 'later' | 'no_date'
  label: string
  units: number
  lines: number
}

export interface OutboundDay {
  /** YYYY-MM-DD (America/Chicago) */
  date: string
  /** e.g. "Mon 7/13" */
  label: string
  shipments: number
  cartons: number
  isToday: boolean
}

export interface InventoryAnalytics {
  generatedAt: string
  inventorySyncedAt: string | null
  stock: {
    skusOnHand: number
    unitsOnHand: number
    belowReorder: number
    trackedParts: number
  }
  demand: {
    openSos: number
    committedUnits: number
    committedParts: number
    shortParts: number
    shortUnits: number
    noPoParts: number
    affectedSos: number
    topShortages: ShortagePart[]
    /** assemble-to-order demand: Sale lines whose part number ends in -KIT.
     *  Kit products are built by the floor (Kit Assembly module), never
     *  stocked, so they are excluded from the shortage math above. */
    kitUnits: number
    kitParts: number
    kitSos: number
  }
  inbound: {
    poCount: number
    lineCount: number
    units: number
    overdueLines: number
    overdueUnits: number
    buckets: InboundBucket[]
  }
  outbound: {
    shippedToday: number
    shipped7d: number
    cartons7d: number
    daily: OutboundDay[]
  }
}

// PostgREST caps a response at 1,000 rows — page through anything that can
// exceed that.
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

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const CHICAGO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })
const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
})

export async function getInventoryAnalytics(): Promise<InventoryAnalytics> {
  const supabase = createAdminClient()
  const today = chicagoTodayIso()

  // ---- On-hand stock, aggregated per part across locations -----------------
  type SnapshotRow = {
    part_number: string
    part_description: string | null
    qty_on_hand: number | string | null
    last_synced_at: string | null
  }
  const snapshot = await pageAll<SnapshotRow>((from, to) =>
    supabase
      .from('inventory_snapshot')
      .select('part_number, part_description, qty_on_hand, last_synced_at')
      .order('id')
      .range(from, to)
  )

  const onHand = new Map<string, number>()
  const descriptions = new Map<string, string | null>()
  let inventorySyncedAt: string | null = null
  for (const row of snapshot) {
    const qty = Number(row.qty_on_hand ?? 0)
    onHand.set(row.part_number, (onHand.get(row.part_number) ?? 0) + qty)
    if (!descriptions.has(row.part_number)) {
      descriptions.set(row.part_number, row.part_description)
    }
    if (row.last_synced_at && (!inventorySyncedAt || row.last_synced_at > inventorySyncedAt)) {
      inventorySyncedAt = row.last_synced_at
    }
  }

  let skusOnHand = 0
  let unitsOnHand = 0
  for (const qty of onHand.values()) {
    if (qty > 0) {
      skusOnHand += 1
      unitsOnHand += qty
    }
  }

  // ---- Reorder-point posture ----------------------------------------------
  type ReorderRow = { part_number: string; reorder_point: number | string | null; is_active: boolean | null }
  let belowReorder = 0
  let trackedParts = 0
  try {
    const rules = await pageAll<ReorderRow>((from, to) =>
      supabase
        .from('reorder_rules')
        .select('part_number, reorder_point, is_active')
        .order('part_number')
        .range(from, to)
    )
    for (const rule of rules) {
      if (rule.is_active === false) continue
      const point = Number(rule.reorder_point ?? 0)
      if (point <= 0) continue
      trackedParts += 1
      if ((onHand.get(rule.part_number) ?? 0) <= point) belowReorder += 1
    }
  } catch (error) {
    console.warn('reorder_rules unavailable for inventory analytics:', error)
  }

  // ---- Committed demand: open Sale lines on Issued / In Progress SOs ------
  const { data: openSoRows, error: soError } = await supabase
    .from('fb_sales_orders')
    .select('so_number')
    .in('status', ['Issued', 'In Progress'])
  if (soError) throw soError
  const soNumbers = (openSoRows ?? []).map((r) => r.so_number as string)

  type ItemRow = {
    sales_order_number: string
    part_number: string | null
    quantity: number | string | null
    quantity_fulfilled: number | string | null
    quantity_picked: number | string | null
    line_type: string | null
  }
  // Kit products (numbers ending in -KIT) are assembled to order by the
  // floor — they never carry stock, so counting them as "short" would flood
  // the shortage view. They get their own assemble-to-order tally instead;
  // their component demand still flows through as regular Sale lines.
  const isKitProduct = (num: string) => /-kit$/i.test(num)
  const openLines: { so: string; product: string; remaining: number }[] = []
  const kitParts = new Set<string>()
  const kitSos = new Set<string>()
  let kitUnits = 0
  for (let i = 0; i < soNumbers.length; i += 100) {
    const batch = soNumbers.slice(i, i + 100)
    const rows = await pageAll<ItemRow>((from, to) =>
      supabase
        .from('fb_sales_order_items')
        .select(
          'sales_order_number, part_number, quantity, quantity_fulfilled, quantity_picked:raw_data->>quantityPicked, line_type:raw_data->type->>name'
        )
        .in('sales_order_number', batch)
        .order('id')
        .range(from, to)
    )
    for (const row of rows) {
      if (row.line_type !== 'Sale' || !row.part_number) continue
      const q = Number(row.quantity ?? 0)
      const f = Number(row.quantity_picked ?? row.quantity_fulfilled ?? 0)
      const remaining = q - f
      if (remaining <= 0) continue
      if (isKitProduct(row.part_number)) {
        kitUnits += remaining
        kitParts.add(row.part_number)
        kitSos.add(row.sales_order_number)
        continue
      }
      openLines.push({ so: row.sales_order_number, product: row.part_number, remaining })
    }
  }

  // SO lines are keyed by PRODUCT number (selling SKU); inventory and PO
  // lines are keyed by PART number (stocked SKU). Bridge through the
  // fb_product_parts cache (P15) and convert case/bag quantities to eaches.
  // Unmapped products fall back to their own number at factor 1.
  type MappingRow = { product_num: string; part_num: string; factor: number | string | null }
  const productToPart = new Map<string, { part: string; factor: number }>()
  {
    const productNums = [...new Set(openLines.map((l) => l.product))]
    for (let i = 0; i < productNums.length; i += 100) {
      const batch = productNums.slice(i, i + 100)
      const rows = await pageAll<MappingRow>((from, to) =>
        supabase
          .from('fb_product_parts')
          .select('product_num, part_num, factor')
          .in('product_num', batch)
          .order('product_num')
          .range(from, to)
      )
      for (const row of rows) {
        productToPart.set(row.product_num, {
          part: row.part_num,
          factor: Number(row.factor ?? 1) || 1,
        })
      }
    }
  }

  const demand = new Map<string, { units: number; sos: Set<string> }>()
  for (const line of openLines) {
    const mapping = productToPart.get(line.product) ?? { part: line.product, factor: 1 }
    const entry = demand.get(mapping.part) ?? { units: 0, sos: new Set<string>() }
    entry.units += line.remaining * mapping.factor
    entry.sos.add(line.so)
    demand.set(mapping.part, entry)
  }

  let committedUnits = 0
  const committedSos = new Set<string>()
  for (const entry of demand.values()) {
    committedUnits += entry.units
    for (const so of entry.sos) committedSos.add(so)
  }

  // ---- Inbound pipeline: open PO lines ------------------------------------
  type PoLineRow = {
    po_number: string
    part_number: string
    qty_open: number | string | null
    expected_date: string | null
  }
  const poLines = await pageAll<PoLineRow>((from, to) =>
    supabase
      .from('fb_open_po_lines')
      .select('po_number, part_number, qty_open, expected_date')
      .order('id')
      .range(from, to)
  )

  const onOrder = new Map<string, { qty: number; eta: string | null }>()
  const poNumbers = new Set<string>()
  const bucketDefs: { key: InboundBucket['key']; label: string }[] = [
    { key: 'overdue', label: 'Overdue' },
    { key: 'this_week', label: 'This week' },
    { key: 'next_week', label: 'Next week' },
    { key: 'two_to_four', label: '2–4 wks' },
    { key: 'later', label: 'Later' },
    { key: 'no_date', label: 'No date' },
  ]
  const buckets = new Map<InboundBucket['key'], InboundBucket>(
    bucketDefs.map((b) => [b.key, { ...b, units: 0, lines: 0 }])
  )
  const weekEnd = addDaysIso(today, 6)
  const fortnightEnd = addDaysIso(today, 13)
  const monthEnd = addDaysIso(today, 27)

  let inboundUnits = 0
  for (const row of poLines) {
    const qty = Number(row.qty_open ?? 0)
    if (qty <= 0) continue
    poNumbers.add(row.po_number)
    inboundUnits += qty

    const cur = onOrder.get(row.part_number) ?? { qty: 0, eta: null }
    cur.qty += qty
    if (row.expected_date && (!cur.eta || row.expected_date < cur.eta)) {
      cur.eta = row.expected_date
    }
    onOrder.set(row.part_number, cur)

    const key: InboundBucket['key'] = !row.expected_date
      ? 'no_date'
      : row.expected_date < today
        ? 'overdue'
        : row.expected_date <= weekEnd
          ? 'this_week'
          : row.expected_date <= fortnightEnd
            ? 'next_week'
            : row.expected_date <= monthEnd
              ? 'two_to_four'
              : 'later'
    const bucket = buckets.get(key)!
    bucket.units += qty
    bucket.lines += 1
  }
  const overdueBucket = buckets.get('overdue')!

  // ---- Shortages: demand vs on hand, with PO coverage ---------------------
  const shortages: ShortagePart[] = []
  const affectedSos = new Set<string>()
  let shortUnits = 0
  let noPoParts = 0
  for (const [part, entry] of demand) {
    const held = onHand.get(part) ?? 0
    const short = entry.units - held
    if (short <= 0) continue
    const po = onOrder.get(part)
    const coverage: ShortageCoverage =
      po && po.qty >= short ? 'full' : po && po.qty > 0 ? 'partial' : 'none'
    if (coverage === 'none') noPoParts += 1
    shortUnits += short
    for (const so of entry.sos) affectedSos.add(so)
    shortages.push({
      part,
      description: descriptions.get(part) ?? null,
      demand: entry.units,
      onHand: held,
      short,
      onOrder: po?.qty ?? 0,
      eta: po?.eta ?? null,
      sos: entry.sos.size,
      coverage,
    })
  }
  shortages.sort((a, b) => b.short - a.short)

  // ---- Outbound velocity: rolling shipments cache -------------------------
  type ShipmentRow = { date_shipped: string; carton_count: number | null }
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString()
  const shipments = await pageAll<ShipmentRow>((from, to) =>
    supabase
      .from('fb_recent_shipments')
      .select('date_shipped, carton_count')
      .gte('date_shipped', tenDaysAgo)
      .order('date_shipped')
      .range(from, to)
  )

  const perDay = new Map<string, { shipments: number; cartons: number }>()
  for (const row of shipments) {
    const day = CHICAGO_DAY.format(new Date(row.date_shipped))
    const entry = perDay.get(day) ?? { shipments: 0, cartons: 0 }
    entry.shipments += 1
    entry.cartons += Number(row.carton_count ?? 0)
    perDay.set(day, entry)
  }

  const daily: OutboundDay[] = []
  let shippedToday = 0
  let shipped7d = 0
  let cartons7d = 0
  const sevenDaysAgo = addDaysIso(today, -6)
  for (let i = 9; i >= 0; i--) {
    const date = addDaysIso(today, -i)
    const entry = perDay.get(date) ?? { shipments: 0, cartons: 0 }
    daily.push({
      date,
      label: DAY_LABEL.format(new Date(`${date}T12:00:00Z`)),
      shipments: entry.shipments,
      cartons: entry.cartons,
      isToday: date === today,
    })
    if (date === today) shippedToday = entry.shipments
    if (date >= sevenDaysAgo) {
      shipped7d += entry.shipments
      cartons7d += entry.cartons
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    inventorySyncedAt,
    stock: {
      skusOnHand,
      unitsOnHand: Math.round(unitsOnHand),
      belowReorder,
      trackedParts,
    },
    demand: {
      openSos: committedSos.size,
      committedUnits: Math.round(committedUnits),
      committedParts: demand.size,
      shortParts: shortages.length,
      shortUnits: Math.round(shortUnits),
      noPoParts,
      affectedSos: affectedSos.size,
      topShortages: shortages.slice(0, 8),
      kitUnits: Math.round(kitUnits),
      kitParts: kitParts.size,
      kitSos: kitSos.size,
    },
    inbound: {
      poCount: poNumbers.size,
      lineCount: poLines.filter((l) => Number(l.qty_open ?? 0) > 0).length,
      units: Math.round(inboundUnits),
      overdueLines: overdueBucket.lines,
      overdueUnits: Math.round(overdueBucket.units),
      buckets: bucketDefs.map((b) => {
        const bucket = buckets.get(b.key)!
        return { ...bucket, units: Math.round(bucket.units) }
      }),
    },
    outbound: {
      shippedToday,
      shipped7d,
      cartons7d,
      daily,
    },
  }
}
