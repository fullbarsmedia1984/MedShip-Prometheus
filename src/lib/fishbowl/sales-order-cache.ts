import type { SupabaseClient } from '@supabase/supabase-js'
import type { FBRawSalesOrder, FBRawSalesOrderItem } from './sales-orders'
import { classifySalesOrder, getSalesOrderQualityFlags } from './sales-order-quality'

type CanonicalState = 'quote' | 'order' | 'void' | 'unknown'

type NormalizeOptions = {
  sourcePageNumber?: number
  includeDetailStatus?: boolean
  detailStatus?: 'pending' | 'success' | 'failed'
  detailError?: string | null
  /**
   * Set when rawOrders are sparse LIST-endpoint rows (id, number, status,
   * customerPo, dateIssued, customerName, dateScheduled). Sparse rows must
   * only ever ADD data: normalizeSalesOrder maps every absent field to null,
   * and a full-row upsert overwrites salesperson / customer_id / totals /
   * dates / raw_data on already-hydrated records with those nulls. That
   * corrupted 15k+ orders on 2026-07-01..03.
   */
  sparse?: boolean
}

type UpsertSalesOrdersOptions = NormalizeOptions

type NormalizedSalesOrder = {
  header: Record<string, unknown> & {
    so_number: string
    status: string
    canonical_state: CanonicalState
  }
  items: Array<Record<string, unknown>>
}

function valueAt(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) return undefined
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function toText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return String(value)
}

function toNumber(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function toDate(value: unknown): string | null {
  return toText(value)
}

function toSalesperson(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'object' && 'name' in value) {
    return toText((value as { name?: unknown }).name)
  }
  return toText(value)
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function normalizeLineItem(
  soNumber: string,
  item: FBRawSalesOrderItem,
  index: number
): Record<string, unknown> {
  const productRecord = objectValue(valueAt(item, ['product', 'part', 'productItem']))
  const uomRecord = objectValue(valueAt(item, ['uom']))
  const partNumber = valueAt(item, ['partNumber', 'number', 'sku', 'productNumber']) ??
    valueAt(productRecord, ['partNumber', 'number', 'sku', 'name'])
  const quantity = valueAt(item, ['quantity', 'qty', 'quantityOrdered', 'productQuantity'])
  const unitPrice = valueAt(item, ['unitPrice', 'price', 'unitCost', 'productPrice'])
  const totalPrice = valueAt(item, ['totalPrice', 'total', 'amount', 'total'])

  return {
    sales_order_number: soNumber,
    fishbowl_line_id: toText(valueAt(item, ['id', 'lineId'])),
    line_number: toNumber(valueAt(item, ['lineNumber', 'line', 'sortOrder'])) ?? index + 1,
    part_number: toText(partNumber),
    part_description: toText(
      valueAt(item, ['partDescription', 'description', 'productName', 'name']) ??
        valueAt(productRecord, ['description', 'name'])
    ),
    quantity: toNumber(quantity) ?? 0,
    quantity_fulfilled: toNumber(valueAt(item, ['quantityFulfilled', 'qtyFulfilled'])),
    quantity_uom: toText(valueAt(item, ['uomCode']) ?? valueAt(uomRecord, ['abbreviation', 'name', 'code'])),
    unit_price: toNumber(unitPrice),
    total_price: toNumber(totalPrice) ?? (
      toNumber(quantity) !== null && toNumber(unitPrice) !== null
        ? Number(toNumber(quantity)) * Number(toNumber(unitPrice))
        : null
    ),
    raw_data: item,
    last_synced_at: new Date().toISOString(),
  }
}

export function normalizeSalesOrder(
  raw: FBRawSalesOrder,
  options: NormalizeOptions = {}
): NormalizedSalesOrder | null {
  const soNumber = toText(valueAt(raw, ['number', 'soNumber', 'salesOrderNumber']))
  if (!soNumber) return null

  const customer = valueAt(raw, ['customer'])
  const customerRecord = objectValue(customer)
  const shipTo = valueAt(raw, ['shipTo', 'shippingAddress', 'shipToAddress'])
  const shipToRecord = objectValue(shipTo)
  const status = toText(valueAt(raw, ['status', 'statusName'])) ?? 'Unknown'
  const rawItems = valueAt(raw, ['items', 'lines', 'salesOrderItems', 'soItems'])
  const items = Array.isArray(rawItems) ? rawItems as FBRawSalesOrderItem[] : []
  const normalizedItems = items.map((item, index) => normalizeLineItem(soNumber, item, index))
  const amount = toNumber(valueAt(raw, ['total', 'totalAmount', 'grandTotal', 'totalPrice']))
  const subtotalAmount = toNumber(valueAt(raw, ['subtotal', 'subTotal', 'subTotalPrice']))
  const dateCreated = toDate(valueAt(raw, ['dateCreated', 'createdDate', 'createdAt']))
  const lineTotal = normalizedItems.reduce(
    (sum, item) => sum + (toNumber(item.total_price) ?? 0),
    0
  )
  const header: NormalizedSalesOrder['header'] = {
    fishbowl_id: toText(valueAt(raw, ['id'])),
    so_number: soNumber,
    status,
    customer_name: toText(valueAt(raw, ['customerName']) ?? valueAt(customerRecord, ['name'])),
    customer_id: toText(valueAt(customerRecord, ['id'])),
    customer_po: toText(valueAt(raw, ['customerPO', 'customerPo', 'poNumber', 'customerPoNumber'])),
    salesperson: toSalesperson(valueAt(raw, ['salesperson', 'salesPerson'])),
    date_created: dateCreated,
    date_scheduled: toDate(valueAt(raw, ['dateScheduled', 'scheduledDate'])),
    date_issued: toDate(valueAt(raw, ['dateIssued', 'issuedDate'])),
    date_completed: toDate(valueAt(raw, ['dateCompleted', 'completedDate'])),
    total_amount: amount,
    subtotal_amount: subtotalAmount,
    tax_amount: toNumber(valueAt(raw, ['taxTotal', 'taxAmount'])),
    shipping_amount: toNumber(valueAt(raw, ['shippingTotal', 'shippingAmount', 'shippingCost'])),
    currency: toText(valueAt(raw, ['currency'])) ?? 'USD',
    ship_to_name: toText(valueAt(shipToRecord, ['name'])),
    ship_to_street: toText(valueAt(shipToRecord, ['address', 'street'])),
    ship_to_city: toText(valueAt(shipToRecord, ['city'])),
    ship_to_state: toText(valueAt(shipToRecord, ['state'])),
    ship_to_postal_code: toText(valueAt(shipToRecord, ['zip', 'postalCode'])),
    ship_to_country: toText(valueAt(shipToRecord, ['country'])),
    sf_opportunity_id: toText(valueAt(raw, ['sfOpportunityId', 'opportunityId'])),
    quote_status: status,
    canonical_state: classifySalesOrder(status) as CanonicalState,
    raw_data: raw,
    source_page_number: options.sourcePageNumber,
    source_last_seen_at: new Date().toISOString(),
    data_quality_flags: getSalesOrderQualityFlags({
      soNumber,
      status,
      customerName: toText(valueAt(raw, ['customerName']) ?? valueAt(customerRecord, ['name'])),
      salesperson: toSalesperson(valueAt(raw, ['salesperson', 'salesPerson'])),
      amount,
      subtotalAmount,
      dateCreated,
      lineCount: normalizedItems.length,
      lineTotal,
    }),
    last_synced_at: new Date().toISOString(),
  }

  if (options.includeDetailStatus) {
    header.detail_status = options.detailStatus ?? 'success'
    header.detail_attempted_at = new Date().toISOString()
    header.detail_hydrated_at = options.detailStatus === 'failed' ? null : new Date().toISOString()
    header.detail_error = options.detailError ?? null
  }

  return {
    header,
    items: normalizedItems,
  }
}

function compactSparseHeader(header: NormalizedSalesOrder['header']): NormalizedSalesOrder['header'] {
  const compact: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(header)) {
    // A sparse row's raw_data / quality flags describe the 7-key list row,
    // not the order — never let them replace the hydrated versions.
    if (key === 'raw_data' || key === 'data_quality_flags') continue
    if (value === null || value === undefined) continue
    compact[key] = value
  }
  return compact as NormalizedSalesOrder['header']
}

export async function upsertSalesOrdersToCache(
  supabase: SupabaseClient,
  rawOrders: FBRawSalesOrder[],
  options: UpsertSalesOrdersOptions = {}
): Promise<{ orders: number; items: number; skipped: number }> {
  const normalized = rawOrders
    .map((order) => normalizeSalesOrder(order, options))
    .filter((order): order is NormalizedSalesOrder => Boolean(order))

  if (normalized.length === 0) {
    return { orders: 0, items: 0, skipped: rawOrders.length }
  }

  const headers = normalized.map((order) => {
    if (options.sparse) return compactSparseHeader(order.header)
    // The DETAIL endpoint never returns dateIssued (only the list endpoint
    // does) — a null here means "not in this payload", not "un-issued".
    // Omit the key so upserts leave the stored value untouched.
    if (order.header.date_issued === null) {
      const { date_issued: _omitted, ...rest } = order.header
      return rest as NormalizedSalesOrder['header']
    }
    return order.header
  })

  // PostgREST null-fills missing keys when rows in one upsert payload have
  // different shapes — batch rows by key signature so a compacted row can
  // never re-null a fuller row's columns.
  const headerGroups = new Map<string, Array<NormalizedSalesOrder['header']>>()
  for (const header of headers) {
    const signature = Object.keys(header).sort().join(',')
    const group = headerGroups.get(signature)
    if (group) group.push(header)
    else headerGroups.set(signature, [header])
  }

  for (const group of headerGroups.values()) {
    const { error: orderError } = await supabase
      .from('fb_sales_orders')
      .upsert(group, { onConflict: 'so_number' })

    if (orderError) throw new Error(`Supabase upsert error on fb_sales_orders: ${orderError.message}`)
  }

  const items = normalized.flatMap((order) => order.items)
  if (items.length > 0) {
    const { error: itemError } = await supabase
      .from('fb_sales_order_items')
      .upsert(items, { onConflict: 'sales_order_number,line_number' })

    if (itemError) {
      throw new Error(`Supabase upsert error on fb_sales_order_items: ${itemError.message}`)
    }
  }

  return {
    orders: normalized.length,
    items: items.length,
    skipped: rawOrders.length - normalized.length,
  }
}
