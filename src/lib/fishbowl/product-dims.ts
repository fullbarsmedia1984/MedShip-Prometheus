// =============================================================================
// Fishbowl product dimensions via the data-query endpoint
// The REST resource endpoints never expose dims (verified against the v25
// API docs and live), but the product table stores len/width/height/weight.
// These values are ADVISORY ONLY — granularity is inconsistent (some "box"
// products carry per-vial dims), so they feed the untrusted tier and the
// verification drawer prefill, never the verified layer.
// =============================================================================

import type { FishbowlClient } from './client'

export interface ProductDimsRow {
  id: number | string
  len?: number | string | null
  width?: number | string | null
  height?: number | string | null
  weight?: number | string | null
  sizeUom?: string | null
  weightUom?: string | null
}

export interface ProductAdvisoryDims {
  lengthIn: number | null
  widthIn: number | null
  heightIn: number | null
  weightLb: number | null
}

const SIZE_TO_INCHES: Record<string, number> = {
  in: 1,
  ft: 12,
  cm: 1 / 2.54,
  mm: 1 / 25.4,
  m: 39.3701,
}

const WEIGHT_TO_POUNDS: Record<string, number> = {
  lbs: 1,
  lb: 1,
  oz: 1 / 16,
  kg: 2.20462,
  g: 0.00220462,
}

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function convert(
  value: number | null,
  uom: string | null | undefined,
  table: Record<string, number>,
  defaultFactor: number
): number | null {
  if (value === null) return null
  const code = (uom ?? '').trim().toLowerCase()
  const factor = code ? table[code] : defaultFactor
  if (factor === undefined) return null // unknown unit — don't guess
  return round3(value * factor)
}

/**
 * Map a raw product row to inch/pound advisory dims. Zeroes (Fishbowl stores
 * 0E-9 for "not set") and unknown units become null.
 */
export function toAdvisoryDims(row: ProductDimsRow): ProductAdvisoryDims {
  return {
    lengthIn: convert(toPositiveNumber(row.len), row.sizeUom, SIZE_TO_INCHES, 1),
    widthIn: convert(toPositiveNumber(row.width), row.sizeUom, SIZE_TO_INCHES, 1),
    heightIn: convert(toPositiveNumber(row.height), row.sizeUom, SIZE_TO_INCHES, 1),
    weightLb: convert(toPositiveNumber(row.weight), row.weightUom, WEIGHT_TO_POUNDS, 1),
  }
}

/** SQL for a batched product dims lookup. Ids are numeric-validated. */
export function buildProductDimsQuery(productIds: Array<number | string>): string | null {
  const ids = [...new Set(productIds.map((id) => Number(id)))].filter(
    (id) => Number.isInteger(id) && id > 0
  )
  if (ids.length === 0) return null
  return (
    'SELECT p.id, p.len, p.width, p.height, p.weight, ' +
    'su.code AS sizeUom, wu.code AS weightUom ' +
    'FROM product p ' +
    'LEFT JOIN uom su ON su.id = p.sizeUomId ' +
    'LEFT JOIN uom wu ON wu.id = p.weightUomId ' +
    `WHERE p.id IN (${ids.join(',')})`
  )
}

/**
 * Fetch advisory dims for a set of Fishbowl product ids in one data query.
 * Returns a map keyed by product id; products without any usable values are
 * still present (all-null) so callers can distinguish "looked up, empty"
 * from "not looked up".
 */
export async function getProductDimsByIds(
  client: FishbowlClient,
  productIds: Array<number | string>
): Promise<Map<number, ProductAdvisoryDims>> {
  const sql = buildProductDimsQuery(productIds)
  if (!sql) return new Map()
  const rows = await client.dataQuery<ProductDimsRow[]>(sql)
  const byId = new Map<number, ProductAdvisoryDims>()
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = Number(row.id)
    if (Number.isInteger(id)) byId.set(id, toAdvisoryDims(row))
  }
  return byId
}
