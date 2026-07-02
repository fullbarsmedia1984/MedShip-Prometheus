// =============================================================================
// Zeus Packaging Estimator — Fishbowl Sales Order fetch
// Pull-based for v1 (rep pastes an SO number). Structured as a service so an
// Inngest trigger can call it later. Filters out non-physical lines (shipping,
// discounts, subtotals, notes, tax) before estimating.
// =============================================================================

import { createFishbowlClient } from '@/lib/fishbowl/client'
import {
  getSalesOrderByNumber,
  getSalesOrderById,
  type FBRawSalesOrder,
  type FBRawSalesOrderItem,
} from '@/lib/fishbowl/sales-orders'
import type { AdvisoryDims, SoLineItem } from './types'

export class SalesOrderNotFoundError extends Error {
  constructor(soNumber: string) {
    super(`Sales Order ${soNumber} was not found in Fishbowl`)
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
        fishbowlDims: extractAdvisoryDims(item, productRecord),
      })
    }
  }

  return { lineItems: [...byPart.values()], excludedLineCount }
}

export interface FetchedSalesOrder {
  soNumber: string
  status: string | null
  customerName: string | null
  lineItems: SoLineItem[]
  excludedLineCount: number
}

/**
 * Fetch an SO by number and return its physical line items. Hydrates the
 * detail record when the search result has no line items.
 */
export async function fetchSalesOrderForEstimate(
  soNumber: string
): Promise<FetchedSalesOrder> {
  const client = createFishbowlClient()
  try {
    let raw = await getSalesOrderByNumber(client, soNumber)
    if (!raw) throw new SalesOrderNotFoundError(soNumber)

    let parsed = parseLineItems(raw)
    if (parsed.lineItems.length === 0 && raw.id !== undefined && raw.id !== null) {
      const detail = await getSalesOrderById(client, raw.id as string | number)
      if (detail) {
        raw = { ...raw, ...detail }
        parsed = parseLineItems(raw)
      }
    }

    const customerRecord = objectValue(valueAt(raw, ['customer']))
    return {
      soNumber: toText(valueAt(raw, ['number', 'soNumber', 'salesOrderNumber'])) ?? soNumber,
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
