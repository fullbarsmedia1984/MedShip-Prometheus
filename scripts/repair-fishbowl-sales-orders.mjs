// Repairs fb_sales_orders rows damaged by the sparse-payload overwrite bug
// (backfill-fishbowl-sales-orders.mjs before the compactSparseHeader fix):
// rows whose salesperson / customer_id / total_amount / date_created were
// nulled and raw_data replaced by a 7-key list-row object.
//
// Damaged rows are identified as date_created IS NULL with a fishbowl_id
// present, and repaired by re-fetching the FULL sales-order detail from the
// Fishbowl API and upserting the complete record (headers + line items).
//
// Usage:
//   node scripts/repair-fishbowl-sales-orders.mjs --dry-run
//   node scripts/repair-fishbowl-sales-orders.mjs --limit=5
//   node scripts/repair-fishbowl-sales-orders.mjs

import envPkg from '@next/env'
import { createClient } from '@supabase/supabase-js'

const { loadEnvConfig } = envPkg
loadEnvConfig(process.cwd())

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
const limitArg = argValues.has('limit') ? Number(argValues.get('limit')) : null
// --only=order  repairs just that canonical_state (e.g. prioritize orders,
// which feed the incentive/cohort engines, before the quote backlog).
const onlyStateArg = argValues.get('only') ?? null

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
  if (['issued', 'in progress', 'partial', 'fulfilled', 'completed', 'closed'].includes(status)) return 'order'
  if (['void', 'voided', 'cancelled', 'canceled', 'deleted'].includes(status)) return 'void'
  return 'quote'
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

async function fetchDamagedRows(supabase) {
  const damaged = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from('fb_sales_orders')
      .select('so_number, fishbowl_id, canonical_state')
      .is('date_created', null)
      .not('fishbowl_id', 'is', null)
      .order('so_number')
      .range(from, from + pageSize - 1)
    if (onlyStateArg) query = query.eq('canonical_state', onlyStateArg)
    const { data, error } = await query
    if (error) throw new Error(`damaged-row query failed: ${error.message}`)
    damaged.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return damaged
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Postgres rejects NUL-byte in both jsonb and text ("unsupported Unicode
// escape sequence") — some Fishbowl payloads contain NUL bytes. Strip them
// everywhere via a JSON text round-trip (stringify escapes real NULs to the
// literal 6-char NUL-byte sequence, so one regex catches both forms).
function stripNulBytes(value) {
  return JSON.parse(JSON.stringify(value).replace(/\\u0000/g, ''))
}

// The Supabase API intermittently drops out (Cloudflare 522s during heavy
// P7 load) — retry writes with backoff instead of killing the run. The
// script is idempotent/resumable either way (it re-scans damaged rows).
async function upsertWithRetry(supabase, table, chunk, onConflict, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { error } = await supabase.from(table).upsert(chunk, { onConflict })
      if (!error) return
      throw new Error(error.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Constraint violations are deterministic — backoff cannot fix them.
      if (message.includes('duplicate key') || attempt >= attempts) {
        throw new Error(`${table} upsert failed after ${attempt} attempt(s): ${message.slice(0, 300)}`)
      }
      const backoffMs = attempt * 15_000
      console.warn(JSON.stringify({ phase: 'retry', table, attempt, backoffMs, error: message.slice(0, 200) }))
      await sleep(backoffMs)
    }
  }
}

// The repair rewrites each SO's FULL item set from the authoritative
// Fishbowl detail. Stale cached items can hold the same fishbowl_line_id at
// a different line_number (Fishbowl renumbered lines since the cache was
// written), which makes an upsert on (sales_order_number, line_number)
// violate the (sales_order_number, fishbowl_line_id) unique constraint.
// Deleting the SO's items first makes the rewrite conflict-free.
async function deleteItemsForSalesOrders(supabase, soNumbers) {
  const unique = [...new Set(soNumbers)]
  for (let index = 0; index < unique.length; index += 100) {
    const slice = unique.slice(index, index + 100)
    const { error } = await supabase
      .from('fb_sales_order_items')
      .delete()
      .in('sales_order_number', slice)
    if (error) throw new Error(`item pre-delete failed: ${error.message.slice(0, 200)}`)
  }
}

async function upsertChunks(supabase, table, rows, onConflict, chunkSize = 500) {
  let written = 0
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    try {
      await upsertWithRetry(supabase, table, chunk, onConflict)
      written += chunk.length
    } catch (error) {
      // One poisoned row must not sink the batch: fall back to row-by-row,
      // log the stragglers, keep going.
      console.warn(JSON.stringify({
        phase: 'chunk-fallback', table, size: chunk.length,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      }))
      for (const row of chunk) {
        try {
          await upsertWithRetry(supabase, table, [row], onConflict, 2)
          written++
        } catch (rowError) {
          console.warn(JSON.stringify({
            phase: 'row-failed', table,
            key: row.so_number ?? row.sales_order_number ?? null,
            error: (rowError instanceof Error ? rowError.message : String(rowError)).slice(0, 200),
          }))
        }
      }
    }
  }
  return written
}

async function main() {
  const baseUrl = requireEnv('FISHBOWL_API_URL').replace(/\/+$/, '')
  const startedAt = Date.now()
  const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let damaged = await fetchDamagedRows(supabase)
  if (limitArg !== null && Number.isFinite(limitArg)) damaged = damaged.slice(0, limitArg)

  console.log(JSON.stringify({ phase: 'scan', damagedRows: damaged.length, dryRun, limit: limitArg }))
  if (damaged.length === 0) return
  if (dryRun) {
    console.log(JSON.stringify({ phase: 'dry-run', sample: damaged.slice(0, 10) }, null, 2))
    return
  }

  let token = null
  const failures = []
  let repaired = 0
  let itemsWritten = 0

  try {
    const auth = await fishbowlLogin(baseUrl)
    token = auth.token

    const headerBatch = []
    const itemBatch = []

    for (let index = 0; index < damaged.length; index++) {
      const row = damaged[index]
      try {
        const detail = await fishbowlGet(
          baseUrl,
          token,
          `/api/sales-orders/${encodeURIComponent(String(row.fishbowl_id))}`
        )
        const normalized = normalizeSalesOrder(detail)
        if (!normalized) {
          failures.push({ so: row.so_number, error: 'detail payload had no SO number' })
          continue
        }
        if (normalized.header.so_number !== row.so_number) {
          failures.push({
            so: row.so_number,
            error: `fishbowl id ${row.fishbowl_id} returned SO ${normalized.header.so_number}; skipped`,
          })
          continue
        }
        // The DETAIL endpoint never returns dateIssued (only the LIST
        // endpoint does). A null here means "not in this payload" — drop the
        // key so the upsert preserves the stored date_issued instead of
        // wiping it. Uniform across all rows, so chunk shapes stay identical.
        if (normalized.header.date_issued === null) delete normalized.header.date_issued
        headerBatch.push(stripNulBytes(normalized.header))
        itemBatch.push(...normalized.items.map(stripNulBytes))
      } catch (error) {
        failures.push({ so: row.so_number, error: error instanceof Error ? error.message : String(error) })
      }

      // Flush periodically so progress survives interruption.
      if (headerBatch.length >= 200 || index + 1 === damaged.length) {
        if (headerBatch.length > 0) {
          const headers = headerBatch.splice(0)
          repaired += await upsertChunks(supabase, 'fb_sales_orders', headers, 'so_number')
          // Authoritative rewrite: clear items for EVERY repaired SO (an SO
          // whose detail now has zero items must not keep stale lines).
          await deleteItemsForSalesOrders(supabase, headers.map((header) => header.so_number))
        }
        if (itemBatch.length > 0) {
          itemsWritten += await upsertChunks(
            supabase,
            'fb_sales_order_items',
            itemBatch.splice(0),
            'sales_order_number,line_number'
          )
        }
        console.log(JSON.stringify({
          phase: 'progress',
          processed: index + 1,
          total: damaged.length,
          repaired,
          itemsWritten,
          failures: failures.length,
        }))
      }
    }
  } finally {
    await logout(baseUrl, token)
  }

  const summary = {
    phase: 'complete',
    damagedRows: damaged.length,
    repaired,
    itemsWritten,
    failures: failures.length,
    failureSample: failures.slice(0, 10),
    durationMs: Date.now() - startedAt,
  }

  await supabase.from('sync_events').insert({
    automation: 'P7_FB_SO_SYNC',
    source_system: 'fishbowl',
    target_system: 'prometheus',
    status: failures.length > 0 ? 'partial' : 'success',
    payload: { triggeredBy: 'repair-sparse-overwrite', limit: limitArg },
    response: { ...summary, failureSample: failures.slice(0, 25) },
    completed_at: new Date().toISOString(),
  }).then(({ error }) => {
    if (error) console.warn(`sync_events log failed: ${error.message}`)
  })

  console.log(JSON.stringify(summary, null, 2))
  if (failures.length > 0) process.exitCode = 2
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
