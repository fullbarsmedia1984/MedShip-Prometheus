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

function normalizeSalesOrder(raw) {
  const soNumber = toText(valueAt(raw, ['number', 'soNumber', 'salesOrderNumber']))
  if (!soNumber) return null

  const customer = objectValue(valueAt(raw, ['customer']))
  const shipTo = objectValue(valueAt(raw, ['shipTo', 'shippingAddress', 'shipToAddress']))
  const status = toText(valueAt(raw, ['status', 'statusName'])) ?? 'Unknown'
  const rawItems = valueAt(raw, ['items', 'lines', 'salesOrderItems', 'soItems'])
  const items = Array.isArray(rawItems) ? rawItems : []

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
      total_amount: toNumber(valueAt(raw, ['total', 'totalAmount', 'grandTotal', 'totalPrice'])),
      subtotal_amount: toNumber(valueAt(raw, ['subtotal', 'subTotal', 'subTotalPrice'])),
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
      last_synced_at: new Date().toISOString(),
    },
    items: items.map((item, index) => normalizeLineItem(soNumber, item, index)),
  }
}

function compactSparseHeader(header) {
  const compact = {}
  for (const [key, value] of Object.entries(header)) {
    // raw_data from a sparse row must never replace a full stored payload.
    if (key === 'raw_data') continue
    if (value === null || value === undefined) continue
    compact[key] = value
  }
  return compact
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
        const result = normalizeSalesOrder(detail ? { ...order, ...detail } : order)
        if (!result) return null
        if (!detail) {
          // The list endpoint returns a sparse row (id, number, status,
          // customerPo, dateIssued, customerName, dateScheduled). Without
          // the detail fetch, normalizeSalesOrder maps every missing field
          // to null — and a full-row upsert would OVERWRITE existing values
          // (salesperson, customer_id, totals, dates, raw_data) with nulls.
          // That corrupted 1,866 orders on 2026-07-01/02. For sparse rows,
          // only upsert the fields the payload actually carries.
          result.header = compactSparseHeader(result.header)
        }
        return result
      })
      .filter(Boolean)

    const headers = normalized.map((order) => order.header)
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
    // PostgREST bulk upserts null-fill missing keys when rows in one payload
    // have different shapes — batching sparse and full headers together would
    // reintroduce the null-overwrite corruption. Group rows by key signature
    // so every batch is uniform.
    const headerGroups = new Map()
    for (const header of headers) {
      const signature = Object.keys(header).sort().join(',')
      if (!headerGroups.has(signature)) headerGroups.set(signature, [])
      headerGroups.get(signature).push(header)
    }
    let writtenHeaders = 0
    for (const group of headerGroups.values()) {
      writtenHeaders += await upsertChunks(supabase, 'fb_sales_orders', group, 'so_number')
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
