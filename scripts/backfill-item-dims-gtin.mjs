// =============================================================================
// Backfill item_dims_catalog via UPC/GTIN matching (pass 5).
//
// For snapshot parts still missing dims after the MPN/vendor-part-number and
// Fishbowl-product passes: pull each part's UPC from the Fishbowl product
// table and match it against hercules_offer_uoms.gtin (283k rows carry one).
// UPC-A (12) vs GTIN-13/14 differ only by leading zeros, so both sides are
// compared zero-stripped.
//
// A GTIN identifies one exact trade item + pack level, so the matched UOM
// row's dims are used directly (match_method='gtin', confidence 0.85) with
// the same plausibility guards as the other passes.
//
// Weight semantics: unlabeled catalog pack weight -> gross_weight_lb,
// weight_basis='unlabeled_assumed_gross'; net_weight_lb stays NULL.
//
// Usage: node scripts/backfill-item-dims-gtin.mjs [--dry-run]
// =============================================================================

import envPkg from '@next/env'
import pg from 'pg'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'

const { loadEnvConfig } = envPkg
loadEnvConfig(process.cwd())

const dryRun = process.argv.includes('--dry-run')
const RUN_ID = 'gtin-backfill-2026-07-09'
const UOM_CODES = new Set(['EA', 'CS', 'BX', 'PK'])

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const client = new pg.Client({
  connectionString: requireEnv('DG_URL'),
  ssl: { rejectUnauthorized: false },
})

// --- Fishbowl auth + data-query (mirrors scripts/backfill-item-dims-fishbowl) -

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
      appDescription: 'Zeus dims backfill (GTIN pass)',
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

// --- Normalization + guards (mirrors backfill-item-dims-hercules) ------------

const DIM_FACTOR = { IN: 1, CM: 1 / 2.54, MM: 1 / 25.4 }
const WT_FACTOR = { LB: 1, LBS: 1, KG: 2.20462, G: 0.00220462, OZ: 1 / 16 }

function toInches(value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  const factor = DIM_FACTOR[String(unit ?? 'IN').trim().toUpperCase() || 'IN']
  if (factor === undefined) return null
  return Math.round(n * factor * 1000) / 1000
}

function toPounds(value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  const factor = WT_FACTOR[String(unit ?? 'LB').trim().toUpperCase() || 'LB']
  if (factor === undefined) return null
  return Math.round(n * factor * 1000) / 1000
}

/** GTIN-12/13/14 differ by leading zeros; compare zero-stripped digit strings. */
function normalizeGtin(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 14) return null
  const stripped = digits.replace(/^0+/, '')
  return stripped.length >= 8 ? stripped : null
}

// --- Main ---------------------------------------------------------------------

async function main() {
  await client.connect()
  await client.query("SET statement_timeout = '300s'")

  // 1. Snapshot parts still missing dims.
  const { rows: missingRows } = await client.query(
    `SELECT DISTINCT s.part_number AS pn
     FROM inventory_snapshot s
     WHERE s.part_number IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM item_dims_catalog c WHERE c.fishbowl_part_number = s.part_number)
       AND NOT EXISTS (SELECT 1 FROM item_dims_verified v WHERE v.fishbowl_part_number = s.part_number)`
  )
  const missing = new Set(missingRows.map((r) => r.pn))
  console.log(`${missing.size} parts still missing dims`)

  // 2. UPCs for those parts from the Fishbowl product table.
  const token = await fishbowlLogin()
  let fbRows
  try {
    fbRows = await dataQuery(
      token,
      "SELECT p.num, p.upc FROM product p WHERE p.upc IS NOT NULL AND p.upc <> ''"
    )
  } finally {
    await fishbowlLogout(token)
  }
  const upcByPart = new Map()
  for (const row of fbRows) {
    const pn = row.num ?? row.NUM
    const gtin = normalizeGtin(row.upc ?? row.UPC)
    if (pn && gtin && missing.has(pn)) upcByPart.set(pn, gtin)
  }
  console.log(`${fbRows.length} Fishbowl products carry a UPC; ${upcByPart.size} of them are missing-dims parts`)
  if (upcByPart.size === 0) {
    console.log('Nothing to match.')
    return
  }

  // 3. Match against hercules_offer_uoms.gtin (indexed), zero-stripped.
  const gtins = [...new Set(upcByPart.values())]
  const candidates = []
  for (let i = 0; i < gtins.length; i += 200) {
    const { rows } = await client.query(
      `SELECT hou.id, hou.gtin, hou.uom_code, hou.length, hou.width, hou.height,
              hou.weight, hou.dimension_unit, hou.weight_unit,
              hvo.vendor_name, hvo.hercules_catalog_item_id
       FROM hercules_offer_uoms hou
       JOIN hercules_vendor_offers hvo ON hvo.id = hou.hercules_vendor_offer_id
       WHERE ltrim(regexp_replace(hou.gtin, '\\D', '', 'g'), '0') = ANY($1)
         AND hou.length > 0 AND hou.width > 0 AND hou.height > 0 AND hou.weight > 0`,
      [gtins.slice(i, i + 200)]
    )
    candidates.push(...rows)
  }
  console.log(`${candidates.length} Hercules UOM rows matched by GTIN`)

  const byGtin = new Map()
  for (const row of candidates) {
    const key = normalizeGtin(row.gtin)
    if (!key) continue
    const list = byGtin.get(key) ?? []
    list.push(row)
    byGtin.set(key, list)
  }

  const rows = []
  for (const [pn, gtin] of upcByPart) {
    const matches = byGtin.get(gtin)
    if (!matches || matches.length === 0) continue
    const parsed = matches
      .map((m) => {
        const len = toInches(m.length, m.dimension_unit)
        const wid = toInches(m.width, m.dimension_unit)
        const hgt = toInches(m.height, m.dimension_unit)
        const wt = toPounds(m.weight, m.weight_unit)
        if ([len, wid, hgt].some((d) => d === null || d < 0.05 || d > 120)) return null
        if (wt === null || wt < 0.005 || wt > 500) return null
        if (wt / (len * wid * hgt) > 0.5) return null
        const uomCode = String(m.uom_code ?? 'EA').trim().toUpperCase()
        return { ...m, len, wid, hgt, wt, vol: len * wid * hgt, uomCode: UOM_CODES.has(uomCode) ? uomCode : 'EA' }
      })
      .filter(Boolean)
    if (parsed.length === 0) continue
    const sorted = parsed.sort((a, b) => a.vol - b.vol)
    if (sorted.length > 1 && sorted[sorted.length - 1].vol / sorted[0].vol > 6) continue
    const rep = sorted[Math.floor((sorted.length - 1) / 2)]
    rows.push({
      fishbowl_part_number: pn,
      uom_code: rep.uomCode,
      length_in: rep.len,
      width_in: rep.wid,
      height_in: rep.hgt,
      gross_weight_lb: rep.wt,
      net_weight_lb: null,
      weight_basis: 'unlabeled_assumed_gross',
      source_system: 'hercules',
      source_vendor: rep.vendor_name ?? null,
      gtin: rep.gtin ?? null,
      hercules_catalog_item_id: rep.hercules_catalog_item_id ?? null,
      hercules_offer_uom_id: rep.id,
      match_method: 'gtin',
      match_confidence: 0.85,
      backfill_run_id: RUN_ID,
    })
  }
  console.log(`${rows.length} parts matched via GTIN`)

  if (dryRun) {
    console.log('[dry-run] sample:', rows.slice(0, 5))
    return
  }

  const COLS = [
    'fishbowl_part_number', 'uom_code', 'length_in', 'width_in', 'height_in',
    'gross_weight_lb', 'net_weight_lb', 'weight_basis', 'source_system',
    'source_vendor', 'gtin', 'hercules_catalog_item_id', 'hercules_offer_uom_id',
    'match_method', 'match_confidence', 'backfill_run_id',
  ]
  let written = 0
  for (let i = 0; i < rows.length; i += 300) {
    const batch = rows.slice(i, i + 300)
    const params = []
    const tuples = batch.map((row, j) => {
      const base = j * COLS.length
      params.push(...COLS.map((c) => row[c]))
      return `(${COLS.map((_, k) => `$${base + k + 1}`).join(', ')})`
    })
    const { rowCount } = await client.query(
      `INSERT INTO item_dims_catalog (${COLS.join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT (fishbowl_part_number, uom_code) DO NOTHING`,
      params
    )
    written += rowCount
  }
  console.log(`Done. ${written} rows written.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => client.end())
