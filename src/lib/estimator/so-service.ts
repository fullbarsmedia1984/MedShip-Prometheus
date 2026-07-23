// =============================================================================
// Zeus Packaging Estimator — Fishbowl Sales Order fetch
// Pull-based for v1 (rep pastes an SO number). Structured as a service so an
// Inngest trigger can call it later. Filters out non-physical lines (shipping,
// discounts, subtotals, notes, tax) before estimating.
// =============================================================================

import { createFishbowlClient } from '@/lib/fishbowl/client'
import type { FishbowlClient } from '@/lib/fishbowl/client'
import {
  findSalesOrderByNumberTailScan,
  getSalesOrderById,
  salesOrderMatchesNumber,
  soNumberCandidates,
  type FBRawSalesOrder,
  type FBRawSalesOrderItem,
} from '@/lib/fishbowl/sales-orders'
import { getProductDimsByIds } from '@/lib/fishbowl/product-dims'
import { getProductPartNumbersByIds } from '@/lib/fishbowl/product-parts'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdvisoryDims, SoLineItem } from './types'

export class SalesOrderNotFoundError extends Error {
  constructor(soNumber: string, hint?: string | null) {
    super(
      `Sales Order ${soNumber} was not found in Fishbowl${hint ? `. ${hint}` : ''}`
    )
    this.name = 'SalesOrderNotFoundError'
  }
}

function valueAt(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) return undefined
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function toText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return String(value)
}

function toNumber(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

/**
 * Fishbowl SO item types that represent physical product moving through the
 * warehouse. Everything else (shipping lines, discounts, subtotals, notes,
 * tax, misc credits) is excluded from packing.
 */
const NON_PHYSICAL_TYPE_IDS = new Set([20, 30, 31, 40, 50, 60, 70, 90])
const NON_PHYSICAL_TYPE_NAMES = [
  'shipping',
  'discount',
  'subtotal',
  'note',
  'tax',
  'misc',
  'credit',
  'assoc',
]

function isPhysicalLine(item: FBRawSalesOrderItem): boolean {
  const typeRecord = objectValue(valueAt(item, ['type', 'itemType', 'soItemType']))
  const typeId =
    toNumber(valueAt(item, ['typeId', 'itemTypeId', 'soItemTypeId'])) ??
    toNumber(valueAt(typeRecord, ['id']))
  if (typeId !== null && NON_PHYSICAL_TYPE_IDS.has(typeId)) return false

  const typeName = (
    toText(valueAt(item, ['typeName', 'itemTypeName'])) ??
    toText(valueAt(typeRecord, ['name'])) ??
    ''
  ).toLowerCase()
  if (typeName && NON_PHYSICAL_TYPE_NAMES.some((t) => typeName.includes(t))) return false

  return true
}

function extractAdvisoryDims(
  item: FBRawSalesOrderItem,
  productRecord: Record<string, unknown> | undefined
): AdvisoryDims {
  const partRecord =
    objectValue(valueAt(productRecord, ['part'])) ??
    objectValue(valueAt(item, ['part'])) ??
    productRecord
  const sizeRecord =
    objectValue(valueAt(partRecord, ['size', 'dimensions'])) ?? partRecord
  const weightRecord =
    objectValue(valueAt(partRecord, ['weight'])) ?? partRecord

  return {
    lengthIn: toNumber(valueAt(sizeRecord, ['length', 'len', 'lengthIn'])),
    widthIn: toNumber(valueAt(sizeRecord, ['width', 'widthIn'])),
    heightIn: toNumber(valueAt(sizeRecord, ['height', 'heightIn'])),
    weightLb: toNumber(
      valueAt(weightRecord, ['weight', 'weightLb', 'amount']) ??
        valueAt(partRecord, ['weight'])
    ),
  }
}

function parseLineItems(raw: FBRawSalesOrder): {
  lineItems: SoLineItem[]
  excludedLineCount: number
} {
  const rawItems =
    (valueAt(raw, ['items', 'lines', 'salesOrderItems', 'soItems']) as
      | FBRawSalesOrderItem[]
      | undefined) ?? []

  const byPart = new Map<string, SoLineItem>()
  let excludedLineCount = 0

  for (const item of rawItems) {
    const productRecord = objectValue(valueAt(item, ['product', 'part', 'productItem']))
    const partNumber = toText(
      valueAt(item, ['partNumber', 'number', 'sku', 'productNumber']) ??
        valueAt(productRecord, ['partNumber', 'number', 'sku', 'name'])
    )
    const quantity =
      toNumber(valueAt(item, ['quantity', 'qty', 'quantityOrdered', 'productQuantity'])) ?? 0

    if (!isPhysicalLine(item) || !partNumber || quantity <= 0) {
      excludedLineCount++
      continue
    }

    const description =
      toText(
        valueAt(item, ['partDescription', 'description', 'productName', 'name']) ??
          valueAt(productRecord, ['description', 'name'])
      ) ?? partNumber
    const uomRecord = objectValue(valueAt(item, ['uom']))
    const uom =
      toText(valueAt(item, ['uomCode']) ?? valueAt(uomRecord, ['abbreviation', 'name', 'code']))

    // Merge duplicate part lines so packing sees one quantity per SKU.
    const existing = byPart.get(partNumber)
    if (existing) {
      existing.quantity += quantity
    } else {
      byPart.set(partNumber, {
        partNumber,
        description,
        quantity,
        uom,
        productId: toNumber(valueAt(productRecord, ['id']) ?? valueAt(item, ['productId'])),
        resolvedPartNumber: null,
        fishbowlDims: extractAdvisoryDims(item, productRecord),
      })
    }
  }

  return { lineItems: [...byPart.values()], excludedLineCount }
}

/**
 * Fill missing advisory dims from the Fishbowl product table (data-query).
 * The SO payload itself never carries dims on this API version; the product
 * table does for ~20% of products. Values stay advisory ("Fishbowl —
 * untrusted") and only fill fields the payload left null. Best-effort: a
 * data-query failure never blocks the fetch.
 */
async function enrichLinesWithProductDims(
  client: FishbowlClient,
  lineItems: SoLineItem[]
): Promise<void> {
  const needy = lineItems.filter(
    (line) =>
      line.productId !== null &&
      (line.fishbowlDims.lengthIn === null ||
        line.fishbowlDims.widthIn === null ||
        line.fishbowlDims.heightIn === null ||
        line.fishbowlDims.weightLb === null)
  )
  if (needy.length === 0) return

  try {
    const dimsById = await getProductDimsByIds(
      client,
      needy.map((line) => line.productId as number)
    )
    for (const line of needy) {
      const dims = dimsById.get(line.productId as number)
      if (!dims) continue
      line.fishbowlDims = {
        lengthIn: line.fishbowlDims.lengthIn ?? dims.lengthIn,
        widthIn: line.fishbowlDims.widthIn ?? dims.widthIn,
        heightIn: line.fishbowlDims.heightIn ?? dims.heightIn,
        weightLb: line.fishbowlDims.weightLb ?? dims.weightLb,
      }
    }
  } catch {
    // Advisory enrichment only — the estimate proceeds without it.
  }
}

/**
 * Resolve each line's product to its underlying PART number (one data query).
 * SO lines carry product numbers ("130122bx"); the dims catalog is keyed by
 * part numbers ("00409-3977-03"), so this hop is what connects catalog dims
 * to real orders. Best-effort: a data-query failure never blocks the fetch.
 */
async function enrichLinesWithPartNumbers(
  client: FishbowlClient,
  lineItems: SoLineItem[]
): Promise<void> {
  const withIds = lineItems.filter((line) => line.productId !== null)
  if (withIds.length === 0) return
  try {
    const partById = await getProductPartNumbersByIds(
      client,
      withIds.map((line) => line.productId as number)
    )
    for (const line of withIds) {
      line.resolvedPartNumber = partById.get(line.productId as number) ?? null
    }
  } catch {
    // Resolution is an enrichment — the estimate proceeds without it.
  }
}

export interface FetchedSalesOrder {
  soNumber: string
  status: string | null
  customerName: string | null
  lineItems: SoLineItem[]
  excludedLineCount: number
}

/**
 * Fishbowl's `?number=` search filter is ignored by the server (it returns
 * the full unfiltered SO list), so SO numbers are resolved in two layers:
 *   1. The P7 sync cache (fb_sales_orders) maps so_number -> fishbowl_id,
 *      covering the entire order history; the order itself is then fetched
 *      fresh from Fishbowl by ID, so cached rows can never go stale.
 *   2. Orders created minutes ago that no sync has seen yet are found by
 *      scanning the live list backwards from its last page (Fishbowl returns
 *      orders oldest-first, so new orders sit at the tail).
 * A result is only ever accepted on an exact SO-number match.
 */
async function lookupCachedFishbowlId(candidate: string): Promise<string | null> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('fb_sales_orders')
      .select('fishbowl_id')
      .ilike('so_number', candidate)
      .not('fishbowl_id', 'is', null)
      .limit(1)
      .maybeSingle()
    return (data?.fishbowl_id as string | null) ?? null
  } catch {
    // Cache unavailable — fall through to the live tail scan.
    return null
  }
}

/** "Did you mean …" — near matches from the cache for a failed lookup. */
async function findNearMatchHint(soNumber: string): Promise<string | null> {
  const digits = soNumber.replace(/\D/g, '')
  if (digits.length < 4) return null
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('fb_sales_orders')
      .select('so_number')
      .ilike('so_number', `%${digits}%`)
      .limit(3)
    const numbers = (data ?? [])
      .map((row) => row.so_number as string)
      .filter(Boolean)
    return numbers.length > 0 ? `Did you mean: ${numbers.join(', ')}?` : null
  } catch {
    return null
  }
}

async function resolveSalesOrder(
  client: FishbowlClient,
  soNumber: string
): Promise<FBRawSalesOrder | null> {
  const candidates = soNumberCandidates(soNumber)

  // Layer 1: cache lookup (so_number -> fishbowl_id), fresh fetch by ID.
  for (const candidate of candidates) {
    const cachedId = await lookupCachedFishbowlId(candidate)
    if (!cachedId) continue
    const byId = await getSalesOrderById(client, cachedId)
    // Guard against cache drift: only trust the row if the number matches.
    if (byId && salesOrderMatchesNumber(byId, candidate)) return byId
  }

  // Layer 2: live tail scan for orders too new to be cached.
  for (const candidate of candidates) {
    const match = await findSalesOrderByNumberTailScan(client, candidate)
    if (match) return match
  }

  return null
}

/**
 * Fetch an SO by number and return its physical line items. Hydrates the
 * detail record when the search result has no line items.
 */
export async function fetchSalesOrderForEstimate(
  soNumber: string
): Promise<FetchedSalesOrder> {
  const requested = soNumber.trim()
  const client = createFishbowlClient()
  try {
    let raw = await resolveSalesOrder(client, requested)
    if (!raw) {
      throw new SalesOrderNotFoundError(requested, await findNearMatchHint(requested))
    }

    let parsed = parseLineItems(raw)
    if (parsed.lineItems.length === 0 && raw.id !== undefined && raw.id !== null) {
      const detail = await getSalesOrderById(client, raw.id as string | number)
      if (detail) {
        raw = { ...raw, ...detail }
        parsed = parseLineItems(raw)
      }
    }

    await Promise.all([
      enrichLinesWithProductDims(client, parsed.lineItems),
      enrichLinesWithPartNumbers(client, parsed.lineItems),
    ])

    const customerRecord = objectValue(valueAt(raw, ['customer']))
    return {
      soNumber: toText(valueAt(raw, ['number', 'soNumber', 'salesOrderNumber'])) ?? requested,
      status: toText(valueAt(raw, ['status', 'statusName'])),
      customerName:
        toText(valueAt(raw, ['customerName'])) ?? toText(valueAt(customerRecord, ['name'])),
      lineItems: parsed.lineItems,
      excludedLineCount: parsed.excludedLineCount,
    }
  } finally {
    await client.logout()
  }
}
