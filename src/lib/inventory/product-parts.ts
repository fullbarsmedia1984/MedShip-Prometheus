import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Product -> part bridge lookups over the fb_product_parts cache (P15).
// Fishbowl SO lines are keyed by PRODUCT number (the selling SKU, e.g.
// "130306cs") while inventory_snapshot and fb_open_po_lines are keyed by
// PART number (the stocked SKU, e.g. "2C8537") — only ~3% coincide. Any
// demand-vs-stock join must map product_num -> part_num and multiply by
// factor (case/bag -> eaches). Products missing from the cache fall back
// to their own number at factor 1.

export interface ProductPartMapping {
  part: string
  factor: number
}

type MappingRow = {
  product_num: string
  part_num: string
  factor: number | string | null
}

export async function loadProductPartMap(
  supabase: SupabaseClient,
  productNums: Iterable<string>
): Promise<Map<string, ProductPartMapping>> {
  const distinct = [...new Set(productNums)]
  const map = new Map<string, ProductPartMapping>()
  // product_num is the table's primary key, so a batch of N returns at most
  // N rows — batches of 100 stay well under the PostgREST 1,000-row cap.
  for (let i = 0; i < distinct.length; i += 100) {
    const batch = distinct.slice(i, i + 100)
    const { data, error } = await supabase
      .from('fb_product_parts')
      .select('product_num, part_num, factor')
      .in('product_num', batch)
    if (error) throw error
    for (const row of (data ?? []) as MappingRow[]) {
      map.set(row.product_num, {
        part: row.part_num,
        factor: Number(row.factor ?? 1) || 1,
      })
    }
  }
  return map
}

/** Convert a product-keyed demand line into part space (eaches). */
export function toPartUnits(
  map: Map<string, ProductPartMapping>,
  productNum: string,
  qty: number
): { part: string; units: number } {
  const mapping = map.get(productNum) ?? { part: productNum, factor: 1 }
  return { part: mapping.part, units: qty * mapping.factor }
}
