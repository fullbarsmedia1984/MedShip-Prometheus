// =============================================================================
// Backfill item_dims_catalog from the Hercules vendor catalog (passes 1-3).
//
// Matches every Fishbowl part (inventory_snapshot) to Hercules offer UOM dims
// and inserts one row per (part, pack level). Matching spine, in priority
// order (a part only falls through to the next pass if the previous found
// nothing):
//   1. exact manufacturer part number        (confidence 0.9 / 0.7 multi-mfr)
//   2. normalized MPN (case/trim variants)   (confidence 0.8 / 0.65)
//   3. vendor part number                    (confidence 0.75)
//
// Runs client-side in small indexed key batches over a direct Postgres
// connection (DG_URL) on purpose: set-based SQL over the 0.7M/1.2M-row
// Hercules tables exceeds shared-instance statement timeouts, and PostgREST
// enforces its own short timeout on the service role.
//
// Weight semantics: Hercules reports one unlabeled pack weight ->
// gross_weight_lb with weight_basis='unlabeled_assumed_gross' (catalog
// convention is shipping weight; gross >= net, conservative for packing).
// net_weight_lb stays NULL until a distinguishing source provides it.
//
// Guards:
//   * unit normalization (IN/CM/MM, LB/KG/G/OZ); unknown units rejected
//   * plausibility: dims 0.05-120 in, weight 0.005-500 lb, density <= 0.5
//   * dispersion guard: if matched candidates for a (part, uom) disagree on
//     volume by >6x, skip it (MPN collision across manufacturers) rather
//     than average unrelated products
//   * representative row: lower-median volume across vendors/offers
//
// Usage: node scripts/backfill-item-dims-hercules.mjs [--dry-run]
// =============================================================================

import envPkg from '@next/env'
import pg from 'pg'

const { loadEnvConfig } = envPkg
loadEnvConfig(process.cwd())

const dryRun = process.argv.includes('--dry-run')
const RUN_ID = 'hercules-backfill-2026-07-09'
// Real pack levels seen in Hercules offer UOMs. The estimator prefers EA and
// falls back to lowest volume, so storing less-common pack codes is safe.
const UOM_CODES = new Set([
  'EA', 'CS', 'BX', 'PK', 'PR', 'RL', 'BG', 'CT', 'KT', 'ST', 'VL', 'TB', 'TR', 'DZ', 'BT', 'CA',
])

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const client = new pg.Client({
  connectionString: requireEnv('DG_URL'),
  ssl: { rejectUnauthorized: false },
})

function chunks(array, size) {
  const out = []
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size))
  return out
}

/** Batched `col = ANY(keys)` reads so every batch stays an index probe. */
async function selectIn(table, column, keys, columns, extraWhere = '') {
  const rows = []
  for (const batch of chunks(keys, 200)) {
    const { rows: batchRows } = await client.query(
      `SELECT ${columns} FROM ${table} WHERE ${column} = ANY($1) ${extraWhere}`,
      [batch]
    )
    rows.push(...batchRows)
  }
  return rows
}

// --- Unit conversion + guards ------------------------------------------------

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

function candidateFromUom(uomRow, vendorName) {
  const uomCode = String(uomRow.uom_code ?? '').trim().toUpperCase()
  if (!UOM_CODES.has(uomCode)) return null
  const len = toInches(uomRow.length, uomRow.dimension_unit)
  const wid = toInches(uomRow.width, uomRow.dimension_unit)
  const hgt = toInches(uomRow.height, uomRow.dimension_unit)
  const wt = toPounds(uomRow.weight, uomRow.weight_unit)
  if ([len, wid, hgt].some((d) => d === null || d < 0.05 || d > 120)) return null
  if (wt === null || wt < 0.005 || wt > 500) return null
  if (wt / (len * wid * hgt) > 0.5) return null
  return {
    uomCode,
    lengthIn: len,
    widthIn: wid,
    heightIn: hgt,
    grossWeightLb: wt,
    vol: len * wid * hgt,
    gtin: uomRow.gtin ?? null,
    uomId: uomRow.id,
    vendorName: vendorName ?? null,
  }
}

/**
 * Lower-median by volume, with a dispersion guard: when candidates disagree
 * on volume by >6x (MPN collision or mixed pack data), fall back to the
 * majority cluster — the largest group of candidates that mutually agree
 * within 6x — instead of rejecting the part outright. Only a cluster holding
 * a strict majority is trusted; an even split stays ambiguous -> null.
 */
function pickRepresentative(candidates) {
  if (candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => a.vol - b.vol)
  if (sorted[sorted.length - 1].vol / sorted[0].vol <= 6) {
    return sorted[Math.floor((sorted.length - 1) / 2)]
  }
  let best = null
  for (let start = 0; start < sorted.length; start++) {
    let end = start
    while (end + 1 < sorted.length && sorted[end + 1].vol / sorted[start].vol <= 6) end++
    if (!best || end - start > best.end - best.start) best = { start, end }
  }
  const clusterSize = best.end - best.start + 1
  if (clusterSize * 2 <= sorted.length) return null // no majority — ambiguous
  const cluster = sorted.slice(best.start, best.end + 1)
  return cluster[Math.floor((cluster.length - 1) / 2)]
}

// --- Hercules lookups ---------------------------------------------------------

const DIMS_FILTER = 'AND length > 0 AND width > 0 AND height > 0 AND weight > 0'

/**
 * Resolve catalog dims candidates for a set of part numbers by matching
 * hercules_catalog_items.manufacturer_part_number against the given keys.
 * keyToParts: Map<matchKey, partNumber[]>.
 */
async function matchViaCatalogItems(keyToParts) {
  const keys = [...keyToParts.keys()]
  const items = await selectIn(
    'hercules_catalog_items',
    'manufacturer_part_number',
    keys,
    'id, manufacturer_part_number, manufacturer_name'
  )
  if (items.length === 0) return new Map()

  const offers = await selectIn(
    'hercules_vendor_offers',
    'hercules_catalog_item_id',
    items.map((i) => i.id),
    'id, hercules_catalog_item_id, vendor_name'
  )
  const uoms = await selectIn(
    'hercules_offer_uoms',
    'hercules_vendor_offer_id',
    offers.map((o) => o.id),
    'id, hercules_vendor_offer_id, uom_code, length, width, height, weight, dimension_unit, weight_unit, gtin',
    DIMS_FILTER
  )

  const offersByItem = new Map()
  for (const offer of offers) {
    const list = offersByItem.get(offer.hercules_catalog_item_id) ?? []
    list.push(offer)
    offersByItem.set(offer.hercules_catalog_item_id, list)
  }
  const uomsByOffer = new Map()
  for (const uom of uoms) {
    const list = uomsByOffer.get(uom.hercules_vendor_offer_id) ?? []
    list.push(uom)
    uomsByOffer.set(uom.hercules_vendor_offer_id, list)
  }

  const result = new Map()
  for (const item of items) {
    const partNumbers = keyToParts.get(item.manufacturer_part_number)
    if (!partNumbers) continue
    for (const pn of partNumbers) {
      let entry = result.get(pn)
      if (!entry) {
        entry = { byUom: new Map(), manufacturers: new Set(), itemIdByUomId: new Map() }
        result.set(pn, entry)
      }
      entry.manufacturers.add(item.manufacturer_name ?? '')
      for (const offer of offersByItem.get(item.id) ?? []) {
        for (const uomRow of uomsByOffer.get(offer.id) ?? []) {
          const candidate = candidateFromUom(uomRow, offer.vendor_name)
          if (!candidate) continue
          const list = entry.byUom.get(candidate.uomCode) ?? []
          list.push(candidate)
          entry.byUom.set(candidate.uomCode, list)
          entry.itemIdByUomId.set(candidate.uomId, item.id)
        }
      }
    }
  }
  return result
}

/** Pass 3: match hercules_offer_uoms.vendor_part_number directly. */
async function matchViaVendorPartNumber(partNumbers) {
  const uoms = await selectIn(
    'hercules_offer_uoms',
    'vendor_part_number',
    partNumbers,
    'id, hercules_vendor_offer_id, vendor_part_number, uom_code, length, width, height, weight, dimension_unit, weight_unit, gtin',
    DIMS_FILTER
  )
  if (uoms.length === 0) return new Map()
  const offers = await selectIn(
    'hercules_vendor_offers',
    'id',
    [...new Set(uoms.map((u) => u.hercules_vendor_offer_id))],
    'id, hercules_catalog_item_id, vendor_name'
  )
  const offerById = new Map(offers.map((o) => [o.id, o]))

  const result = new Map()
  for (const uomRow of uoms) {
    const offer = offerById.get(uomRow.hercules_vendor_offer_id)
    const candidate = candidateFromUom(uomRow, offer?.vendor_name)
    if (!candidate) continue
    let entry = result.get(uomRow.vendor_part_number)
    if (!entry) {
      entry = { byUom: new Map(), manufacturers: new Set(), itemIdByUomId: new Map() }
      result.set(uomRow.vendor_part_number, entry)
    }
    const list = entry.byUom.get(candidate.uomCode) ?? []
    list.push(candidate)
    entry.byUom.set(candidate.uomCode, list)
    if (offer?.hercules_catalog_item_id) {
      entry.itemIdByUomId.set(candidate.uomId, offer.hercules_catalog_item_id)
    }
  }
  return result
}

function buildRows(pn, entry, matchMethod, confidenceSingle, confidenceMulti) {
  const rows = []
  const confidence = entry.manufacturers.size <= 1 ? confidenceSingle : confidenceMulti
  for (const [uomCode, candidates] of entry.byUom) {
    const rep = pickRepresentative(candidates)
    if (!rep) continue
    rows.push({
      fishbowl_part_number: pn,
      uom_code: uomCode,
      length_in: rep.lengthIn,
      width_in: rep.widthIn,
      height_in: rep.heightIn,
      gross_weight_lb: rep.grossWeightLb,
      net_weight_lb: null,
      weight_basis: 'unlabeled_assumed_gross',
      source_system: 'hercules',
      source_vendor: rep.vendorName,
      gtin: rep.gtin,
      hercules_catalog_item_id: entry.itemIdByUomId.get(rep.uomId) ?? null,
      hercules_offer_uom_id: rep.uomId,
      match_method: matchMethod,
      match_confidence: confidence,
      backfill_run_id: RUN_ID,
    })
  }
  return rows
}

const INSERT_COLUMNS = [
  'fishbowl_part_number', 'uom_code', 'length_in', 'width_in', 'height_in',
  'gross_weight_lb', 'net_weight_lb', 'weight_basis', 'source_system',
  'source_vendor', 'gtin', 'hercules_catalog_item_id', 'hercules_offer_uom_id',
  'match_method', 'match_confidence', 'backfill_run_id',
]

async function insertRows(rows) {
  let written = 0
  for (const batch of chunks(rows, 300)) {
    const params = []
    const tuples = batch.map((row, i) => {
      const base = i * INSERT_COLUMNS.length
      params.push(...INSERT_COLUMNS.map((c) => row[c]))
      return `(${INSERT_COLUMNS.map((_, j) => `$${base + j + 1}`).join(', ')})`
    })
    const { rowCount } = await client.query(
      `INSERT INTO item_dims_catalog (${INSERT_COLUMNS.join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT (fishbowl_part_number, uom_code) DO NOTHING`,
      params
    )
    written += rowCount
    console.log(`inserted ${written} rows so far`)
  }
  return written
}

// --- Main ---------------------------------------------------------------------

async function main() {
  await client.connect()
  await client.query("SET statement_timeout = '300s'")

  const { rows: snapshotParts } = await client.query(
    'SELECT DISTINCT part_number FROM inventory_snapshot WHERE part_number IS NOT NULL'
  )
  const allParts = snapshotParts.map((r) => r.part_number)
  console.log(`${allParts.length} distinct Fishbowl parts`)

  const rows = []
  const matched = new Set()

  // Pass 1: exact MPN.
  {
    const keyToParts = new Map(allParts.map((pn) => [pn, [pn]]))
    const found = await matchViaCatalogItems(keyToParts)
    for (const [pn, entry] of found) {
      const partRows = buildRows(pn, entry, 'exact_mpn', 0.9, 0.7)
      if (partRows.length > 0) {
        rows.push(...partRows)
        matched.add(pn)
      }
    }
    console.log(`pass 1 (exact_mpn): ${matched.size} parts matched`)
  }

  // Pass 2: normalized MPN — case/punctuation-insensitive. Scans the whole
  // MPN index once (keyset pagination, index-only) and matches unmatched
  // parts on alphanumeric-only uppercase keys, then reuses the exact-probe
  // machinery on the raw MPN strings that matched.
  {
    const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const wanted = new Map() // normalized key -> part numbers
    for (const pn of allParts) {
      if (matched.has(pn)) continue
      const key = norm(pn)
      if (key.length < 4) continue // too short to be a meaningful MPN
      const list = wanted.get(key) ?? []
      list.push(pn)
      wanted.set(key, list)
    }

    // raw hci MPN -> part numbers it serves
    const keyToParts = new Map()
    let last = ''
    for (;;) {
      const { rows: page } = await client.query(
        `SELECT DISTINCT manufacturer_part_number AS mpn
         FROM hercules_catalog_items
         WHERE manufacturer_part_number > $1
         ORDER BY 1 LIMIT 20000`,
        [last]
      )
      if (page.length === 0) break
      for (const { mpn } of page) {
        const pns = wanted.get(norm(mpn))
        if (pns) {
          // The exact form was already tried in pass 1; only raw variants add signal.
          const fresh = pns.filter((pn) => pn !== mpn)
          if (fresh.length > 0) keyToParts.set(mpn, fresh)
        }
      }
      last = page[page.length - 1].mpn
    }

    const before = matched.size
    if (keyToParts.size > 0) {
      const found = await matchViaCatalogItems(keyToParts)
      for (const [pn, entry] of found) {
        if (matched.has(pn)) continue
        const partRows = buildRows(pn, entry, 'normalized_mpn', 0.8, 0.65)
        if (partRows.length > 0) {
          rows.push(...partRows)
          matched.add(pn)
        }
      }
    }
    console.log(`pass 2 (normalized_mpn): ${matched.size - before} parts matched`)
  }

  // Pass 3: vendor part number for the rest.
  {
    const remaining = allParts.filter((pn) => !matched.has(pn))
    const before = matched.size
    if (remaining.length > 0) {
      const found = await matchViaVendorPartNumber(remaining)
      for (const [pn, entry] of found) {
        if (matched.has(pn)) continue
        const partRows = buildRows(pn, entry, 'vendor_part_number', 0.75, 0.75)
        if (partRows.length > 0) {
          rows.push(...partRows)
          matched.add(pn)
        }
      }
    }
    console.log(`pass 3 (vendor_part_number): ${matched.size - before} parts matched`)
  }

  console.log(`${matched.size} parts matched total, ${rows.length} dims rows to write`)

  if (dryRun) {
    console.log('[dry-run] sample:', rows.slice(0, 5))
    return
  }

  const written = await insertRows(rows)
  console.log(`Done. ${written} rows written (conflicts skipped).`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => client.end())
