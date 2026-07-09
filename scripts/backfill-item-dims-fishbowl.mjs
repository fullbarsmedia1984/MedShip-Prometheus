// =============================================================================
// Backfill item_dims_catalog from the Fishbowl product table (pass 4).
//
// Fills parts the Hercules passes (scripts/backfill-item-dims-catalog.sql)
// missed, using the dims ~22% of Fishbowl products carry. These rows are
// stored with source_system='fishbowl_product' and LOW match confidence:
// Fishbowl dims granularity is inconsistent (some "box" products carry
// per-vial dims), so the estimator treats them as advisory-quality even
// though they live in the catalog table.
//
// Weight semantics: Fishbowl stores a single unlabeled product weight ->
// gross_weight_lb with weight_basis='unlabeled_assumed_gross'.
//
// Usage: node scripts/backfill-item-dims-fishbowl.mjs [--dry-run]
// =============================================================================

import envPkg from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'

const { loadEnvConfig } = envPkg
loadEnvConfig(process.cwd())

const dryRun = process.argv.includes('--dry-run')
const RUN_ID = 'fishbowl-product-backfill-2026-07-08'

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } }
)

// --- Fishbowl auth + data-query (mirrors src/lib/fishbowl/client.ts) --------

const FISHBOWL_BASE = requireEnv('FISHBOWL_API_URL').replace(/\/+$/, '')

function cfHeaders() {
  return {
    ...(process.env.FISHBOWL_CF_ACCESS_CLIENT_ID
      ? { 'CF-Access-Client-Id': process.env.FISHBOWL_CF_ACCESS_CLIENT_ID }
      : {}),
    ...(process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET
      ? { 'CF-Access-Client-Secret': process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET }
      : {}),
  }
}

async function fishbowlLogin() {
  const response = await fetch(`${FISHBOWL_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cfHeaders() },
    body: JSON.stringify({
      appName: process.env.FISHBOWL_APP_NAME ?? 'MedShip Prometheus',
      appDescription: 'Zeus dims backfill',
      appId: Number(process.env.FISHBOWL_APP_ID ?? 20260505),
      username: requireEnv('FISHBOWL_USERNAME'),
      password: requireEnv('FISHBOWL_PASSWORD'),
    }),
  })
  if (!response.ok) throw new Error(`Fishbowl login failed (${response.status})`)
  const data = await response.json()
  if (!data.token) throw new Error('Fishbowl login returned no token')
  return data.token
}

async function fishbowlLogout(token) {
  try {
    await fetch(`${FISHBOWL_BASE}/api/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...cfHeaders() },
    })
  } catch {
    // best effort
  }
}

// Fishbowl requires GET with an SQL body (fetch forbids that) -> node http(s).
function dataQuery(token, sql) {
  const url = new URL(`${FISHBOWL_BASE}/api/data-query`)
  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = requestFn(
      url,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/sql',
          'Content-Length': Buffer.byteLength(sql),
          Authorization: `Bearer ${token}`,
          ...cfHeaders(),
        },
        timeout: 120_000,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`data-query error ${res.statusCode}: ${body.slice(0, 300)}`))
            return
          }
          try {
            resolve(JSON.parse(body))
          } catch {
            reject(new Error(`data-query returned non-JSON: ${body.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('data-query timed out')))
    req.on('error', reject)
    req.write(sql)
    req.end()
  })
}

// --- Unit conversion (mirrors src/lib/fishbowl/product-dims.ts) -------------

const SIZE_TO_INCHES = { in: 1, ft: 12, cm: 1 / 2.54, mm: 1 / 25.4, m: 39.3701 }
const WEIGHT_TO_POUNDS = { lbs: 1, lb: 1, oz: 1 / 16, kg: 2.20462, g: 0.00220462 }

function convert(value, uom, table) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  const code = String(uom ?? '').trim().toLowerCase()
  const factor = code ? table[code] : 1
  if (factor === undefined) return null // unknown unit — don't guess
  return Math.round(n * factor * 1000) / 1000
}

function plausible(len, wid, hgt, wt) {
  const dims = [len, wid, hgt]
  if (dims.some((d) => d === null || d < 0.05 || d > 120)) return false
  if (wt === null || wt < 0.005 || wt > 500) return false
  if (wt / (len * wid * hgt) > 0.5) return false
  return true
}

// --- Main --------------------------------------------------------------------

async function main() {
  // 1. Parts that still need dims: in inventory_snapshot, not in catalog/verified.
  const snapshotParts = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('inventory_snapshot')
      .select('part_number')
      .not('part_number', 'is', null)
      .range(from, from + 999)
    if (error) throw new Error(`inventory_snapshot read failed: ${error.message}`)
    snapshotParts.push(...data)
    if (data.length < 1000) break
  }
  const allParts = [...new Set(snapshotParts.map((r) => r.part_number))]

  const covered = new Set()
  for (const table of ['item_dims_catalog', 'item_dims_verified']) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from(table)
        .select('fishbowl_part_number')
        .range(from, from + 999)
      if (error) throw new Error(`${table} read failed: ${error.message}`)
      for (const row of data) covered.add(row.fishbowl_part_number)
      if (data.length < 1000) break
    }
  }
  const missing = new Set(allParts.filter((pn) => !covered.has(pn)))
  console.log(
    `${allParts.length} snapshot parts, ${covered.size} already covered, ${missing.size} missing`
  )

  // 2. Pull every product with usable dims from Fishbowl in one data query.
  const token = await fishbowlLogin()
  let rows
  try {
    rows = await dataQuery(
      token,
      'SELECT p.num, p.len, p.width, p.height, p.weight, ' +
        'su.code AS sizeUom, wu.code AS weightUom ' +
        'FROM product p ' +
        'LEFT JOIN uom su ON su.id = p.sizeUomId ' +
        'LEFT JOIN uom wu ON wu.id = p.weightUomId ' +
        'WHERE p.len > 0 AND p.width > 0 AND p.height > 0 AND p.weight > 0'
    )
  } finally {
    await fishbowlLogout(token)
  }
  if (!Array.isArray(rows)) throw new Error('Unexpected data-query response shape')
  console.log(`Fishbowl returned ${rows.length} products with dims`)

  // 3. Convert, guard, and keep only missing parts.
  const inserts = []
  let implausible = 0
  for (const row of rows) {
    const pn = row.num === undefined || row.num === null ? null : String(row.num)
    if (!pn || !missing.has(pn)) continue
    const len = convert(row.len, row.sizeUom, SIZE_TO_INCHES)
    const wid = convert(row.width, row.sizeUom, SIZE_TO_INCHES)
    const hgt = convert(row.height, row.sizeUom, SIZE_TO_INCHES)
    const wt = convert(row.weight, row.weightUom, WEIGHT_TO_POUNDS)
    if (!plausible(len, wid, hgt, wt)) {
      implausible++
      continue
    }
    inserts.push({
      fishbowl_part_number: pn,
      uom_code: 'EA',
      length_in: len,
      width_in: wid,
      height_in: hgt,
      gross_weight_lb: wt,
      net_weight_lb: null,
      weight_basis: 'unlabeled_assumed_gross',
      source_system: 'fishbowl_product',
      source_vendor: null,
      gtin: null,
      match_method: 'fishbowl_product',
      match_confidence: 0.5,
      backfill_run_id: RUN_ID,
    })
  }
  console.log(`${inserts.length} parts to insert (${implausible} rejected as implausible)`)

  if (dryRun) {
    console.log('[dry-run] sample:', inserts.slice(0, 5))
    return
  }

  // 4. Upsert in chunks.
  let written = 0
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500)
    const { error } = await supabase
      .from('item_dims_catalog')
      .upsert(chunk, { onConflict: 'fishbowl_part_number,uom_code', ignoreDuplicates: true })
    if (error) throw new Error(`upsert failed at chunk ${i}: ${error.message}`)
    written += chunk.length
    console.log(`upserted ${written}/${inserts.length}`)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
