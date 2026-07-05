// Parity audit: verifies the fb_sales_orders cache against the Fishbowl API.
//
// 1. Volume parity — Fishbowl's list-endpoint totalResults vs cached row count.
// 2. Damage scan — rows still showing the sparse-overwrite signature.
// 3. Field parity — random sample of rows compared field-by-field against the
//    Fishbowl DETAIL endpoint (status, customer, salesperson, totals, dates,
//    line-item count). date_issued is EXCLUDED: the detail endpoint never
//    returns it (only the list endpoint does).
//
// Usage: node scripts/audit-fishbowl-parity.mjs [--sample=40]

import envPkg from '@next/env'
import { createClient } from '@supabase/supabase-js'

const { loadEnvConfig } = envPkg
loadEnvConfig(process.cwd())

const argValues = new Map(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith('--') && arg.includes('='))
    .map((arg) => arg.slice(2).split('=', 2))
)
const sampleSize = Number(argValues.get('sample') ?? 40)

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
  if (!response.ok) throw new Error(`Fishbowl login failed ${response.status}`)
  return response.json()
}

async function fishbowlGet(baseUrl, token, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { ...cfHeaders(false), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Fishbowl GET ${path} failed ${response.status}`)
  return response.json()
}

const text = (value) => (value === undefined || value === null || value === '' ? null : String(value))
const num = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
const datePart = (value) => (value ? String(value).slice(0, 10) : null)

function salespersonOf(raw) {
  const value = raw.salesperson ?? raw.salesPerson
  if (value && typeof value === 'object' && 'name' in value) return text(value.name)
  return text(value)
}

function compareRow(dbRow, detail) {
  const items = Array.isArray(detail.items ?? detail.lines ?? detail.salesOrderItems ?? detail.soItems)
    ? (detail.items ?? detail.lines ?? detail.salesOrderItems ?? detail.soItems)
    : []
  const checks = {
    status: [text(dbRow.status), text(detail.status ?? detail.statusName) ?? 'Unknown'],
    customer_name: [text(dbRow.customer_name), text(detail.customerName ?? detail.customer?.name)],
    customer_id: [text(dbRow.customer_id), text(detail.customer?.id)],
    salesperson: [text(dbRow.salesperson), salespersonOf(detail)],
    total_amount: [num(dbRow.total_amount), num(detail.total ?? detail.totalAmount ?? detail.grandTotal ?? detail.totalPrice)],
    date_created: [datePart(dbRow.date_created), datePart(detail.dateCreated ?? detail.createdDate ?? detail.createdAt)],
    date_completed: [datePart(dbRow.date_completed), datePart(detail.dateCompleted ?? detail.completedDate)],
    item_count: [num(dbRow.item_count), items.length],
  }
  const mismatches = []
  for (const [field, [dbValue, fbValue]] of Object.entries(checks)) {
    const same = field === 'total_amount'
      ? (dbValue === null && fbValue === null) || (dbValue !== null && fbValue !== null && Math.abs(dbValue - fbValue) < 0.01)
      : String(dbValue) === String(fbValue)
    if (!same) mismatches.push({ field, db: dbValue, fishbowl: fbValue })
  }
  return mismatches
}

async function main() {
  const baseUrl = requireEnv('FISHBOWL_API_URL').replace(/\/+$/, '')
  const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { count: cachedTotal, error: countError } = await supabase
    .from('fb_sales_orders')
    .select('so_number', { count: 'exact', head: true })
  if (countError) throw new Error(countError.message)

  const { count: damagedTotal, error: damageError } = await supabase
    .from('fb_sales_orders')
    .select('so_number', { count: 'exact', head: true })
    .is('date_created', null)
    .not('fishbowl_id', 'is', null)
  if (damageError) throw new Error(damageError.message)

  const auth = await fishbowlLogin(baseUrl)
  const token = auth.token

  try {
    const page = await fishbowlGet(baseUrl, token, '/api/sales-orders?pageNumber=1&pageSize=1')
    const fishbowlTotal = Number(page.totalResults ?? page.totalCount ?? page.total ?? NaN)

    // Random sample across the id space for the field audit.
    const { data: sampleRows, error: sampleError } = await supabase
      .rpc('random_fb_sales_orders_sample', { sample_count: sampleSize })
      .select()
    let rows = sampleRows
    if (sampleError) {
      // No helper function in the DB — fall back to a client-side sample.
      const { data: allIds, error: idError } = await supabase
        .from('fb_sales_orders')
        .select('so_number')
        .not('fishbowl_id', 'is', null)
        .limit(20000)
      if (idError) throw new Error(idError.message)
      const picked = new Set()
      while (picked.size < Math.min(sampleSize, allIds.length)) {
        picked.add(allIds[Math.floor(Math.random() * allIds.length)].so_number)
      }
      const { data: fetched, error: fetchError } = await supabase
        .from('fb_sales_orders')
        .select('so_number, fishbowl_id, status, customer_name, customer_id, salesperson, total_amount, date_created, date_completed')
        .in('so_number', [...picked])
      if (fetchError) throw new Error(fetchError.message)
      rows = fetched
    }

    const results = []
    for (const row of rows ?? []) {
      const { count: itemCount } = await supabase
        .from('fb_sales_order_items')
        .select('id', { count: 'exact', head: true })
        .eq('sales_order_number', row.so_number)
      try {
        const detail = await fishbowlGet(
          baseUrl, token, `/api/sales-orders/${encodeURIComponent(String(row.fishbowl_id))}`
        )
        const mismatches = compareRow({ ...row, item_count: itemCount ?? 0 }, detail)
        results.push({ so: row.so_number, ok: mismatches.length === 0, mismatches })
      } catch (error) {
        results.push({ so: row.so_number, ok: false, error: String(error).slice(0, 150) })
      }
    }

    const clean = results.filter((r) => r.ok).length
    console.log(JSON.stringify({
      volume: {
        fishbowlTotalSalesOrders: fishbowlTotal,
        cachedRows: cachedTotal,
        difference: Number.isFinite(fishbowlTotal) ? fishbowlTotal - (cachedTotal ?? 0) : null,
      },
      damage: { rowsWithSparseSignature: damagedTotal },
      fieldAudit: {
        sampled: results.length,
        clean,
        withMismatches: results.length - clean,
        details: results.filter((r) => !r.ok),
      },
    }, null, 2))
  } finally {
    await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: { ...cfHeaders(false), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {})
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
