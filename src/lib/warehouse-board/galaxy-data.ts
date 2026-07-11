import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { LaneSeverity } from './data'

// Kit Galaxy: -KIT sales orders rendered as a solar-system graph.
// Schools (customers) are suns, kit orders are planets, kit component
// lines are moons. Scope: open kit orders plus kits shipped in the
// last 30 days.

export interface GalaxyItem {
  part: string
  desc: string | null
  qty: number
  fulfilled: number
}

export type KitStatus = 'waiting' | 'assembling' | 'shipped'

export interface GalaxyKit {
  soNumber: string
  status: KitStatus
  ageDays: number
  severity: LaneSeverity
  pct: number
  units: number
  unitsDone: number
  shippedAt: string | null
  items: GalaxyItem[]
}

export interface GalaxySchool {
  name: string
  kits: GalaxyKit[]
}

export interface KitGalaxyData {
  generatedAt: string
  schools: GalaxySchool[]
  totals: { waiting: number; assembling: number; shipped: number; items: number }
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

function dayDiff(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000))
}

export async function getKitGalaxyData(): Promise<KitGalaxyData> {
  const supabase = createAdminClient()
  const now = new Date()
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString()

  type KitSoRow = {
    so_number: string
    customer_name: string | null
    status: string
    date_issued: string | null
    date_completed: string | null
  }

  const [openRes, doneRes] = await Promise.all([
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
  ])
  if (openRes.error) throw openRes.error
  if (doneRes.error) throw doneRes.error
  const soRows = [
    ...((openRes.data ?? []) as KitSoRow[]),
    ...((doneRes.data ?? []) as KitSoRow[]),
  ]

  // Recent shipments make an open kit "shipped" even before status flips.
  const { data: shipRows } = await supabase
    .from('fb_recent_shipments')
    .select('so_number, date_shipped')
    .in('so_number', soRows.map((r) => r.so_number))
  const latestShip = new Map<string, string>()
  for (const row of shipRows ?? []) {
    const cur = latestShip.get(row.so_number as string)
    if (!cur || (row.date_shipped as string) > cur) {
      latestShip.set(row.so_number as string, row.date_shipped as string)
    }
  }

  type ItemRow = {
    sales_order_number: string
    part_number: string | null
    quantity: number | null
    quantity_fulfilled: number | null
    line_type: string | null
    prod_desc: string | null
  }
  const itemsBySo = new Map<string, GalaxyItem[]>()
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
      const list = itemsBySo.get(row.sales_order_number) ?? []
      list.push({
        part: row.part_number,
        desc: row.prod_desc,
        qty: Number(row.quantity ?? 0),
        fulfilled: Number(row.quantity_fulfilled ?? 0),
      })
      itemsBySo.set(row.sales_order_number, list)
    }
  }

  const bySchool = new Map<string, GalaxyKit[]>()
  const totals = { waiting: 0, assembling: 0, shipped: 0, items: 0 }

  for (const row of soRows) {
    const items = itemsBySo.get(row.so_number) ?? []
    const units = items.reduce((s, x) => s + x.qty, 0)
    const unitsDone = items.reduce((s, x) => s + Math.min(x.fulfilled, x.qty), 0)
    const shippedAt =
      row.date_completed ?? latestShip.get(row.so_number) ?? null
    const isShipped =
      row.status === 'Fulfilled' ||
      row.status === 'Closed Short' ||
      latestShip.has(row.so_number)
    const status: KitStatus = isShipped
      ? 'shipped'
      : row.status === 'In Progress'
        ? 'assembling'
        : 'waiting'
    const ageDays = row.date_issued
      ? dayDiff(new Date(row.date_issued), now)
      : 0
    const severity: LaneSeverity =
      status === 'shipped'
        ? 'ok'
        : status === 'waiting'
          ? ageDays > 7
            ? 'critical'
            : ageDays > 3
              ? 'warn'
              : 'ok'
          : ageDays > 14
            ? 'critical'
            : ageDays > 7
              ? 'warn'
              : 'ok'

    totals[status] += 1
    totals.items += items.length

    const kit: GalaxyKit = {
      soNumber: row.so_number,
      status,
      ageDays,
      severity,
      pct: units > 0 ? Math.min(100, Math.round((unitsDone / units) * 100)) : 0,
      units,
      unitsDone,
      shippedAt: isShipped ? shippedAt : null,
      items,
    }
    const school = row.customer_name?.trim() || 'Unassigned'
    ;(bySchool.get(school) ?? bySchool.set(school, []).get(school)!).push(kit)
  }

  const schools: GalaxySchool[] = [...bySchool.entries()]
    .map(([name, kits]) => ({
      name,
      kits: kits.sort((a, b) => b.ageDays - a.ageDays),
    }))
    .sort((a, b) => b.kits.length - a.kits.length)

  return { generatedAt: now.toISOString(), schools, totals }
}
