// =============================================================================
// Fishbowl product -> part resolution via the data-query endpoint
// SO lines carry PRODUCT numbers (sellable pack variants like "130122bx");
// dims enrichment is keyed by PART numbers (often real manufacturer part
// numbers like "00409-3977-03"). One batched query resolves the hop.
// =============================================================================

import type { FishbowlClient } from './client'

interface ProductPartRow {
  id: number | string
  partNum?: string | null
}

/** SQL for a batched product -> part number lookup. Ids are numeric-validated. */
export function buildProductPartQuery(productIds: Array<number | string>): string | null {
  const ids = [...new Set(productIds.map((id) => Number(id)))].filter(
    (id) => Number.isInteger(id) && id > 0
  )
  if (ids.length === 0) return null
  return (
    'SELECT p.id, pt.num AS partNum ' +
    'FROM product p JOIN part pt ON pt.id = p.partId ' +
    `WHERE p.id IN (${ids.join(',')})`
  )
}

/** Resolve Fishbowl product ids to their part numbers in one data query. */
export async function getProductPartNumbersByIds(
  client: FishbowlClient,
  productIds: Array<number | string>
): Promise<Map<number, string>> {
  const sql = buildProductPartQuery(productIds)
  if (!sql) return new Map()
  const rows = await client.dataQuery<ProductPartRow[]>(sql)
  const byId = new Map<number, string>()
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = Number(row.id)
    const partNum = typeof row.partNum === 'string' ? row.partNum.trim() : ''
    if (Number.isInteger(id) && partNum) byId.set(id, partNum)
  }
  return byId
}
