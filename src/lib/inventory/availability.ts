import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadProductPartMap, toPartUnits } from './product-parts'

// True part availability = snapshot on-hand minus stock that is physically
// present but already spoken for. Fishbowl keeps picked units in qty-on-hand
// until the order SHIPS, so raw snapshot numbers overstate what a new pick
// can grab — validated against Fishbowl pick data (SO 138717-KIT, 2026-07-17)
// where every shortage was off by exactly the picked-not-shipped quantity.

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

/** Units picked (staged) but not yet shipped on open SOs, in part eaches.
 *  Subtract from snapshot on-hand before any shortage computation. */
export async function loadPickedByPart(
  supabase: SupabaseClient
): Promise<Map<string, number>> {
  const { data: soRows, error } = await supabase
    .from('fb_sales_orders')
    .select('so_number')
    .in('status', ['Issued', 'In Progress'])
  if (error) throw error
  const soNumbers = (soRows ?? []).map((r) => r.so_number as string)

  type ItemRow = {
    part_number: string | null
    quantity: number | string | null
    quantity_fulfilled: number | string | null
    quantity_picked: number | string | null
    line_type: string | null
  }
  const staged: { product: string; units: number }[] = []
  for (let i = 0; i < soNumbers.length; i += 100) {
    const batch = soNumbers.slice(i, i + 100)
    const rows = await pageAll<ItemRow>((from, to) =>
      supabase
        .from('fb_sales_order_items')
        .select(
          'part_number, quantity, quantity_fulfilled, quantity_picked:raw_data->>quantityPicked, line_type:raw_data->type->>name'
        )
        .in('sales_order_number', batch)
        .order('id')
        .range(from, to)
    )
    for (const row of rows) {
      // Only Sale lines consume warehouse stock; Kit master lines are never
      // picked and Drop Ship lines never touch our shelves. Fulfilled units
      // have already left on-hand, so only picked-beyond-fulfilled is staged.
      if (row.line_type !== 'Sale' || !row.part_number) continue
      const qty = Number(row.quantity ?? 0)
      const picked = Math.min(Number(row.quantity_picked ?? 0), qty)
      const stagedUnits = picked - Number(row.quantity_fulfilled ?? 0)
      if (stagedUnits <= 0) continue
      staged.push({ product: row.part_number, units: stagedUnits })
    }
  }

  const productMap = await loadProductPartMap(
    supabase,
    staged.map((s) => s.product)
  )
  const byPart = new Map<string, number>()
  for (const s of staged) {
    const { part, units } = toPartUnits(productMap, s.product, s.units)
    byPart.set(part, (byPart.get(part) ?? 0) + units)
  }
  return byPart
}

/** Cutoff timestamp separating the latest P2 run's rows from stale leftovers.
 *  P2 re-upserts every part Fishbowl still reports each run but historically
 *  never deleted drop-outs, so a row whose last_synced_at predates the most
 *  recent run means the part fell to zero (e.g. 14242-28 stuck at "10 on
 *  hand" since June). One hour of slack covers the run's own write window. */
export async function getSnapshotFreshCutoff(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data, error } = await supabase
    .from('inventory_snapshot')
    .select('last_synced_at')
    .order('last_synced_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const max = data?.[0]?.last_synced_at as string | undefined
  if (!max) return null
  return new Date(new Date(max).getTime() - 3600_000).toISOString()
}
