import envPkg from '@next/env'
import { createClient } from '@supabase/supabase-js'

const { loadEnvConfig } = envPkg
loadEnvConfig(process.cwd())

const PAGE_SIZE = Number(process.env.FISHBOWL_SO_PAGE_SIZE ?? 100)
const DETAIL_LIMIT = Number(process.env.FISHBOWL_SO_DETAIL_LIMIT ?? 500)
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const argValues = new Map(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith('--') && arg.includes('='))
    .map((arg) => {
      const [key, value] = arg.slice(2).split('=', 2)
      return [key, value]
    })
)
const startPageArg = Number(argValues.get('start-page') ?? 1)
const maxPagesArg = argValues.has('max-pages') ? Number(argValues.get('max-pages')) : null

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function cfHeaders(includeJson = false) {
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    ...(process.env.FISHBOWL_CF_ACCESS_CLIENT_ID
      ? { 'CF-Access-Client-Id': process.env.FISHBOWL_CF_ACCESS_CLIENT_ID }
      : {}),
    ...(process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET
      ? { 'CF-Access-Client-Secret': process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET }
      : {}),
  }
}

function toText(value) {
  if (value === undefined || value === null || value === '') return null
  return String(value)
}

function toNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function valueAt(source, keys) {
  if (!source || typeof source !== 'object') return undefined
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function classifySalesOrder(statusValue) {
  const status = String(statusValue ?? '').trim().toLowerCase()
  if (!status) return 'unknown'
  if (['issued', 'in progress', 'partial', 'fulfilled', 'completed', 'closed', 'closed short'].includes(status)) return 'order'
  if (['void', 'voided', 'cancelled', 'canceled', 'deleted'].includes(status)) return 'void'
  return 'quote'
}

function timestamp(value) {
  if (!value) return 0
  const time = new Date(String(value)).getTime()
  return Number.isFinite(time) ? time : 0
}

function sortValue(order) {
  return Math.max(
    timestamp(order.dateCreated),
    timestamp(order.dateIssued),
    timestamp(order.dateCompleted),
    timestamp(order.lastModified?.dateLastModified),
    Number(order.id) || 0
  )
}

function normalizeLineItem(soNumber, item, index) {
  const product = objectValue(valueAt(item, ['product', 'part', 'productItem']))
  const uom = objectValue(valueAt(item, ['uom']))
  const quantity = valueAt(item, ['quantity', 'qty', 'quantityOrdered', 'productQuantity'])
  const unitPrice = valueAt(item, ['unitPrice', 'price', 'unitCost', 'productPrice'])
  const totalPrice = valueAt(item, ['totalPrice', 'total', 'amount'])
  const partNumber =
    valueAt(item, ['partNumber', 'number', 'sku', 'productNumber']) ??
    valueAt(product, ['partNumber', 'number', 'sku', 'name'])

  return {
    sales_order_number: soNumber,
    fishbowl_line_id: toText(valueAt(item, ['id', 'lineId'])),
    line_number: toNumber(valueAt(item, ['lineNumber', 'line', 'sortOrder'])) ?? index + 1,
    part_number: toText(partNumber),
    part_description: toText(
      valueAt(item, ['partDescription', 'description', 'productName', 'name']) ??
        valueAt(product, ['description', 'name'])
    ),
    quantity: toNumber(quantity) ?? 0,
    quantity_fulfilled: toNumber(valueAt(item, ['quantityFulfilled', 'qtyFulfilled'])),
    quantity_uom: toText(valueAt(item, ['uomCode']) ?? valueAt(uom, ['abbreviation', 'name', 'code'])),
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

// Mirrors src/lib/fishbowl/sales-order-quality.ts. This script MUST write
// data_quality_flags on every upsert: omitting the column preserves whatever
// flags were stored before, which left stale zero_value/missing_line_items
// flags on ~64k rows and suppressed months of dashboard revenue.
const TEST_RECORD_PATTERN = /(^|\b)(test|testing|do not use|sample|warehouse)/i
const STALE_QUOTE_DAYS = 365

function getQualityFlags({ soNumber, status, customerName, salesperson, amount, subtotalAmount, dateCreated, lineCount, lineTotal }) {
  const flags = new Set()
  const effectiveAmount = Number(amount ?? subtotalAmount ?? 0)
  if ([soNumber, customerName, salesperson].some((v) => v && TEST_RECORD_PATTERN.test(v))) flags.add('likely_test')
  if ((lineCount ?? 0) === 0) flags.add('missing_line_items')
  if (effectiveAmount <= 0) flags.add('zero_value')
  const createdTime = dateCreated ? new Date(dateCreated).getTime() : NaN
  if (Number.isFinite(createdTime) && (Date.now() - createdTime) / 86_400_000 > STALE_QUOTE_DAYS) flags.add('historical')
  if ((lineCount ?? 0) > 0 && effectiveAmount > 0 && Math.abs(effectiveAmount - Number(lineTotal ?? 0)) > 1) flags.add('line_total_mismatch')
  if (classifySalesOrder(status) === 'unknown') flags.add('unknown_state')
  return [...flags]
}

function normalizeSalesOrder(raw) {
  const soNumber = toText(valueAt(raw, ['number', 'soNumber', 'salesOrderNumber']))
  if (!soNumber) return null

  const customer = objectValue(valueAt(raw, ['customer']))
  const shipTo = objectValue(valueAt(raw, ['shipTo', 'shippingAddress', 'shipToAddress']))
  const status = toText(valueAt(raw, ['status', 'statusName'])) ?? 'Unknown'
  const rawItems = valueAt(raw, ['items', 'lines', 'salesOrderItems', 'soItems'])
  const items = Array.isArray(rawItems) ? rawItems : []
  const normalizedItems = items.map((item, index) => normalizeLineItem(soNumber, item, index))
  const totalAmount = toNumber(valueAt(raw, ['total', 'totalAmount', 'grandTotal', 'totalPrice']))
  const subtotalAmount = toNumber(valueAt(raw, ['subtotal', 'subTotal', 'subTotalPrice']))

  return {
    header: {
      fishbowl_id: toText(valueAt(raw, ['id'])),
      so_number: soNumber,
      status,
      customer_name: toText(valueAt(raw, ['customerName']) ?? valueAt(customer, ['name'])),
      customer_id: toText(valueAt(customer, ['id'])),
      customer_po: toText(valueAt(raw, ['customerPO', 'customerPo', 'poNumber', 'customerPoNumber'])),
      salesperson: toText(valueAt(objectValue(valueAt(raw, ['salesperson', 'salesPerson'])), ['name']) ?? valueAt(raw, ['salesperson', 'salesPerson'])),
      date_created: toText(valueAt(raw, ['dateCreated', 'createdDate', 'createdAt'])),
      date_scheduled: toText(valueAt(raw, ['dateScheduled', 'scheduledDate'])),
      date_issued: toText(valueAt(raw, ['dateIssued', 'issuedDate'])),
      date_completed: toText(valueAt(raw, ['dateCompleted', 'completedDate'])),
      total_amount: totalAmount,
      subtotal_amount: subtotalAmount,
      tax_amount: toNumber(valueAt(raw, ['taxTotal', 'taxAmount', 'totalTax'])),
      shipping_amount: toNumber(valueAt(raw, ['shippingTotal', 'shippingAmount', 'shippingCost'])),
      currency: toText(valueAt(raw, ['currency'])) ?? 'USD',
      ship_to_name: toText(valueAt(shipTo, ['name'])),
      ship_to_street: toText(valueAt(shipTo, ['address', 'street'])),
      ship_to_city: toText(valueAt(shipTo, ['city'])),
      ship_to_state: toText(valueAt(shipTo, ['state'])),
      ship_to_postal_code: toText(valueAt(shipTo, ['zip', 'postalCode'])),
      ship_to_country: toText(valueAt(shipTo, ['country'])),
      sf_opportunity_id: toText(valueAt(raw, ['sfOpportunityId', 'opportunityId'])),
      quote_status: status,
      canonical_state: classifySalesOrder(status),
      raw_data: raw,
      data_quality_flags: getQualityFlags({
        soNumber,
        status,
        customerName: toText(valueAt(raw, ['customerName']) ?? valueAt(customer, ['name'])),
        salesperson: toText(valueAt(objectValue(valueAt(raw, ['salesperson', 'salesPerson'])), ['name']) ?? valueAt(raw, ['salesperson', 'salesPerson'])),
        amount: totalAmount,
        subtotalAmount,
        dateCreated: toText(valueAt(raw, ['dateCreated', 'createdDate', 'createdAt'])),
        lineCount: normalizedItems.length,
        lineTotal: normalizedItems.reduce((sum, item) => sum + (toNumber(item.total_price) ?? 0), 0),
      }),
      last_synced_at: new Date().toISOString(),
    },
    items: normalizedItems,
    hadItemsArray: Array.isArray(rawItems),
  }
}

// List payloads omit detail-only fields (notably dateIssued); writing them as
// null clobbers hydrated values, so prune null volatile fields before upsert.
const VOLATILE_HEADER_FIELDS = [
  'date_issued', 'date_completed', 'total_amount', 'subtotal_amount',
  'tax_amount', 'shipping_amount', 'salesperson',
]

function pruneHeader(header, hadItemsArray) {
  for (const key of VOLATILE_HEADER_FIELDS) {
    if (header[key] === null || header[key] === undefined) delete header[key]
  }
  if (!hadItemsArray) delete header.data_quality_flags
  return header
}

// PostgREST bulk upserts need uniform keys per request; pruning makes header
// shapes heterogeneous, so group them by key signature.
function groupBySignature(rows) {
  const groups = new Map()
  for (const row of rows) {
    const signature = Object.keys(row).sort().join(',')
    if (!groups.has(signature)) groups.set(signature, [])
    groups.get(signature).push(row)
  }
  return [...groups.values()]
}

async function fishbowlLogin(baseUrl) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: cfHeaders(true),
    body: JSON.stringify({
      appName: process.env.FISHBOWL_APP_NAME ?? 'MedShip Prometheus',
      appDescription: process.env.FISHBOWL_APP_DESCRIPTION ?? 'Medical Shipment internal Zeus integration',
      appId: Number(process.env.FISHBOWL_APP_ID ?? 20260505),
      username: requireEnv('FISHBOWL_USERNAME'),
      password: requireEnv('FISHBOWL_PASSWORD'),
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) throw new Error(`Fishbowl login failed ${response.status}: ${await response.text()}`)
  return response.json()
}

async function fishbowlGet(baseUrl, token, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      ...cfHeaders(false),
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) throw new Error(`Fishbowl GET ${path} failed ${response.status}: ${await response.text()}`)
  return response.json()
}

async function logout(baseUrl, token) {
  if (!token) return
  await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: {
      ...cfHeaders(false),
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {})
}

async function upsertChunks(supabase, table, rows, onConflict, chunkSize = 500) {
  let written = 0
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    const { error } = await supabase.from(table).upsert(chunk, { onConflict })
    if (error) throw new Error(`${table} upsert failed: ${error.message}`)
    written += chunk.length
  }
  return written
}

async function main() {
  const baseUrl = requireEnv('FISHBOWL_API_URL').replace(/\/+$/, '')
  const startedAt = Date.now()
  let token = null

  try {
    const auth = await fishbowlLogin(baseUrl)
    token = auth.token

    const orders = []
    let pageNumber = Number.isFinite(startPageArg) && startPageArg > 0 ? startPageArg : 1
    let totalPages = pageNumber
    let pagesFetched = 0

    while (pageNumber <= totalPages) {
      const page = await fishbowlGet(
        baseUrl,
        token,
        `/api/sales-orders?pageNumber=${pageNumber}&pageSize=${PAGE_SIZE}`
      )
      totalPages = Number(page.totalPages ?? 1)
      orders.push(...(page.results ?? page.salesOrders ?? page.data ?? []))
      pagesFetched++
      if (pageNumber % 50 === 0 || pageNumber === totalPages) {
        console.log(JSON.stringify({ phase: 'headers', pageNumber, totalPages, pagesFetched, orders: orders.length }))
      }
      pageNumber++
      if (maxPagesArg !== null && pagesFetched >= maxPagesArg) break
    }

    const detailCandidates = [...orders]
      .filter((order) => order.id !== undefined && order.id !== null)
      .sort((a, b) => sortValue(b) - sortValue(a))
      .slice(0, DETAIL_LIMIT)

    const detailById = new Map()
    for (let index = 0; index < detailCandidates.length; index++) {
      const order = detailCandidates[index]
      try {
        const detail = await fishbowlGet(baseUrl, token, `/api/sales-orders/${encodeURIComponent(String(order.id))}`)
        detailById.set(String(order.id), detail)
      } catch (error) {
        console.warn(`detail failed for ${order.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
      if ((index + 1) % 50 === 0 || index + 1 === detailCandidates.length) {
        console.log(JSON.stringify({ phase: 'details', processed: index + 1, total: detailCandidates.length }))
      }
    }

    const normalized = orders
      .map((order) => {
        const detail = detailById.get(String(order.id))
        return normalizeSalesOrder(detail ? { ...order, ...detail } : order)
      })
      .filter(Boolean)

    const headers = normalized.map((order) => pruneHeader(order.header, order.hadItemsArray))
    const items = normalized.flatMap((order) => order.items)
    const summary = {
      dryRun,
      headers: headers.length,
      items: items.length,
      detailRows: detailById.size,
      startPage: startPageArg,
      maxPages: maxPagesArg,
      durationMs: Date.now() - startedAt,
    }

    if (dryRun) {
      console.log(JSON.stringify({ phase: 'dry-run', ...summary }, null, 2))
      return
    }

    const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    let writtenHeaders = 0
    for (const headerGroup of groupBySignature(headers)) {
      writtenHeaders += await upsertChunks(supabase, 'fb_sales_orders', headerGroup, 'so_number')
    }
    const writtenItems = items.length > 0
      ? await upsertChunks(supabase, 'fb_sales_order_items', items, 'sales_order_number,line_number')
      : 0

    await supabase.from('sync_events').insert({
      automation: 'P7_FB_SO_SYNC',
      source_system: 'fishbowl',
      target_system: 'prometheus',
      status: 'success',
      payload: { triggeredBy: 'local-backfill', detailLimit: DETAIL_LIMIT },
      response: { ...summary, writtenHeaders, writtenItems },
      completed_at: new Date().toISOString(),
    })

    await supabase
      .from('sync_schedules')
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: writtenItems > 0 ? 'partial' : 'success',
        last_run_duration_ms: Date.now() - startedAt,
        records_processed: writtenHeaders,
      })
      .eq('automation', 'P7_FB_SO_SYNC')

    console.log(JSON.stringify({ phase: 'complete', ...summary, writtenHeaders, writtenItems }, null, 2))
  } finally {
    await logout(baseUrl, token)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
