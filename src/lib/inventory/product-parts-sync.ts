import 'server-only'
import type { FishbowlClient } from '@/lib/fishbowl/client'
import { createAdminClient } from '@/lib/supabase/admin'

// Product -> part bridge for demand/stock joins (see migration 052). The
// catalog is ~44k products and changes slowly, so a daily full refresh is
// plenty. factor converts one product unit into part units: Fishbowl's
// uomconversion row (from product UOM, to part UOM) says
// partQty = productQty * multiply / factor; same-UOM products have no
// conversion row and fall back to 1.
const PRODUCT_PARTS_SQL = (limit: number, offset: number) => `
  SELECT p.num AS productNum, pt.num AS partNum,
         COALESCE(uc.multiply / uc.factor, 1) AS factor
  FROM product p
  JOIN part pt ON pt.id = p.partId
  LEFT JOIN uomconversion uc
    ON uc.fromUomId = p.uomId AND uc.toUomId = pt.uomId
  ORDER BY p.id
  LIMIT ${limit} OFFSET ${offset}
`

type ProductPartRow = {
  productNum: string | null
  partNum: string | null
  factor: number | string | null
}

// Callers own the Fishbowl session (withFishbowlSession) so every login is
// paired with a logout — an unclosed session holds a license seat.
export async function syncProductParts(client: FishbowlClient): Promise<number> {
  const supabase = createAdminClient()
  const syncedAt = new Date().toISOString()
  const PAGE = 5000
  let total = 0

  for (let offset = 0; ; offset += PAGE) {
    const rows = await client.dataQuery<ProductPartRow[]>(PRODUCT_PARTS_SQL(PAGE, offset))
    if (!Array.isArray(rows) || rows.length === 0) break

    const mapped = rows
      .filter((r) => r.productNum && r.partNum)
      .map((r) => ({
        product_num: String(r.productNum),
        part_num: String(r.partNum),
        factor: Number(r.factor ?? 1) || 1,
        synced_at: syncedAt,
      }))

    for (let i = 0; i < mapped.length; i += 500) {
      const { error } = await supabase
        .from('fb_product_parts')
        .upsert(mapped.slice(i, i + 500), { onConflict: 'product_num' })
      if (error) throw error
    }

    total += mapped.length
    if (rows.length < PAGE) break
  }

  // Drop mappings for products deleted from Fishbowl.
  if (total > 0) {
    const { error } = await supabase
      .from('fb_product_parts')
      .delete()
      .lt('synced_at', syncedAt)
    if (error) throw error
  }

  return total
}
