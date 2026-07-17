/**
 * Deterministic native workbook engine for contract-pricing Phase C.
 * Pure functions over a simple grid model — no filesystem, network, or
 * exceljs dependency here, so everything is unit-testable with node:test.
 *
 * Design rules carried over from the Python toolkit:
 * - Code extracts prices; nothing is inferred. Mapping suggestions are
 *   deterministic header-synonym lookups a human confirms in the UI.
 * - Every extracted value keeps cell-level lineage (sheet, row, cell ref).
 * - No package conversions are ever inferred.
 *
 * Grid model (produced by workbook-reader.mjs):
 *   { name: string, rows: [ [ { text, isDate, dateIso, isFormula, address } | null ] ] }
 * rows/columns are 1-indexed by position in the arrays (index 0 unused).
 */

export const CANONICAL_FIELDS = [
  'distributor_sku',
  'manufacturer_part_number',
  'model_number',
  'gtin',
  'ndc',
  'manufacturer_name',
  'item_description_raw',
  'raw_price_uom',
  'price',
  'pack_size',
  'minimum_quantity',
  'effective_date',
  'expiration_date',
]

const HEADER_SYNONYMS = {
  distributor_sku: ['ITEM #', 'ITEM NUMBER', 'ITEM NO', 'SKU', 'ITEM CODE', 'PRODUCT NUMBER', 'PRODUCT #', 'CATALOG #', 'CATALOG NUMBER', 'CAT #', 'PART #', 'PART NUMBER', 'ITEM'],
  manufacturer_part_number: ['MFG PART', 'MFG PART #', 'MFR PART', 'MANUFACTURER PART', 'MANUFACTURER PART NUMBER', 'MPN', 'MFG #', 'MFR #', 'VENDOR PART', 'VENDOR PART #'],
  model_number: ['MODEL', 'MODEL #', 'MODEL NUMBER', 'MODEL NO'],
  gtin: ['GTIN', 'UPC', 'UPC CODE', 'BARCODE', 'EAN'],
  ndc: ['NDC', 'NDC NUMBER'],
  manufacturer_name: ['MANUFACTURER', 'MFG', 'MFR', 'BRAND', 'VENDOR NAME'],
  item_description_raw: ['DESCRIPTION', 'ITEM DESCRIPTION', 'PRODUCT DESCRIPTION', 'PRODUCT NAME', 'DESC'],
  raw_price_uom: ['UOM', 'UNIT OF MEASURE', 'U/M', 'UM', 'SELL UOM', 'PRICE UOM', 'UNIT'],
  price: ['CONTRACT PRICE', 'NET PRICE', 'UNIT PRICE', 'CONTRACT COST', 'NET COST', 'UNIT COST', 'YOUR PRICE', 'DEALER PRICE', 'PRICE', 'COST'],
  pack_size: ['PACK SIZE', 'PACK', 'QTY PER', 'CASE QTY', 'QTY/UOM'],
  minimum_quantity: ['MIN QTY', 'MINIMUM QTY', 'MINIMUM', 'MOQ', 'MIN ORDER'],
  effective_date: ['EFFECTIVE DATE', 'EFFECTIVE', 'START DATE'],
  expiration_date: ['EXPIRATION DATE', 'EXPIRATION', 'EXPIRES', 'END DATE', 'EXP DATE'],
}

const IDENTIFIER_FIELDS = ['distributor_sku', 'manufacturer_part_number', 'model_number', 'gtin', 'ndc']
const UPLOAD_METADATA_FIELDS = ['contract_number', 'effective_date', 'expiration_date', 'account_number', 'location', 'distributor_name', 'contract_name']

function normalizeHeaderText(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9#/ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function columnLetter(index) {
  let result = ''
  let value = index
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

export function columnIndexFromLetter(letter) {
  let value = 0
  for (const char of String(letter ?? '').toUpperCase()) {
    if (char < 'A' || char > 'Z') return null
    value = value * 26 + (char.charCodeAt(0) - 64)
  }
  return value > 0 ? value : null
}

function cellAt(grid, rowIndex, colIndex) {
  const row = grid.rows[rowIndex]
  if (!row) return null
  return row[colIndex] ?? null
}

function cellText(cell) {
  return String(cell?.text ?? '').trim()
}

/**
 * Score candidate header rows: fraction of non-empty text cells that look
 * like labels (non-numeric), weighted by how many known synonyms they hit.
 */
export function discoverWorkbook(grids) {
  return {
    sheets: grids.map((grid) => {
      const rowCount = grid.rows.length - 1
      const candidates = []
      const maxScan = Math.min(rowCount, 15)
      for (let rowIndex = 1; rowIndex <= maxScan; rowIndex += 1) {
        const row = grid.rows[rowIndex] ?? []
        const texts = row.filter(Boolean).map(cellText).filter((text) => text.length > 0)
        if (texts.length < 2) continue
        const labelish = texts.filter((text) => Number.isNaN(Number(text.replace(/[$,%]/g, '')))).length
        const synonymHits = texts.filter((text) => {
          const normalized = normalizeHeaderText(text)
          return Object.values(HEADER_SYNONYMS).some((patterns) => patterns.includes(normalized))
        }).length
        const score = (labelish / texts.length) * 0.5 + Math.min(synonymHits / 4, 1) * 0.5
        candidates.push({ row_number: rowIndex, cell_count: texts.length, synonym_hits: synonymHits, score: Number(score.toFixed(3)) })
      }
      candidates.sort((left, right) => right.score - left.score || left.row_number - right.row_number)
      const best = candidates[0] ?? null

      const headers = []
      if (best) {
        const row = grid.rows[best.row_number] ?? []
        for (let colIndex = 1; colIndex < row.length; colIndex += 1) {
          const text = cellText(row[colIndex])
          if (text) headers.push({ column_letter: columnLetter(colIndex), header: text })
        }
      }

      return {
        name: grid.name,
        row_count: rowCount,
        header_candidates: candidates.slice(0, 5),
        detected_header_row: best?.row_number ?? null,
        headers,
      }
    }),
  }
}

/**
 * Deterministic mapping suggestions: exact normalized-synonym match first
 * (confidence 0.95), then prefix match (0.7). One column per canonical field,
 * one canonical field per column, resolved in CANONICAL_FIELDS priority order.
 */
export function suggestColumnMappings(headers) {
  const suggestions = []
  const usedColumns = new Set()

  for (const field of CANONICAL_FIELDS) {
    const patterns = HEADER_SYNONYMS[field] ?? []
    let best = null
    for (const { column_letter, header } of headers) {
      if (usedColumns.has(column_letter)) continue
      const normalized = normalizeHeaderText(header)
      if (!normalized) continue
      if (patterns.includes(normalized)) {
        best = { column_letter, header, confidence: 0.95 }
        break
      }
      if (!best) {
        const prefixHit = patterns.some(
          (pattern) => normalized.startsWith(`${pattern} `) || (pattern.length >= 4 && normalized.includes(pattern))
        )
        if (prefixHit) best = { column_letter, header, confidence: 0.7 }
      }
    }
    if (best) {
      usedColumns.add(best.column_letter)
      suggestions.push({ canonical_field: field, ...best })
    }
  }

  return suggestions
}

export function parsePrice(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { value: null, error: 'MISSING_PRICE' }
  const negative = /^\(.*\)$/.test(raw)
  const cleaned = raw.replace(/[()$,\s]/g, '').replace(/USD$/i, '')
  if (!cleaned || Number.isNaN(Number(cleaned))) return { value: null, error: 'UNPARSEABLE_PRICE' }
  const value = Number(cleaned) * (negative ? -1 : 1)
  if (value < 0) return { value, error: 'NEGATIVE_PRICE' }
  return { value, error: null }
}

export function normalizeUom(raw, uomAliases) {
  const cleaned = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!cleaned) return { normalized: null, recognized: false }
  const KNOWN = new Set(['EA', 'BX', 'CS', 'PK', 'CT', 'DZ', 'PR', 'RL', 'ST', 'KT', 'BG', 'TB', 'BT', 'CN', 'JR', 'PL'])
  if (KNOWN.has(cleaned)) return { normalized: cleaned, recognized: true }
  for (const alias of uomAliases ?? []) {
    const aliasKey = String(alias.alias ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (aliasKey === cleaned) return { normalized: String(alias.normalized_uom), recognized: true }
  }
  return { normalized: cleaned, recognized: false }
}

export function parseDateValue(cell) {
  if (!cell) return null
  if (cell.isDate && cell.dateIso) return String(cell.dateIso).slice(0, 10)
  const text = cellText(cell)
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const usMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (usMatch) {
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3]
    return `${year}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`
  }
  return null
}

function rowIsRepeatedHeader(grid, rowIndex, mappings, headerRow) {
  let matches = 0
  let compared = 0
  for (const mapping of mappings) {
    const colIndex = columnIndexFromLetter(mapping.column_letter)
    if (!colIndex) continue
    const headerText = normalizeHeaderText(cellText(cellAt(grid, headerRow, colIndex)))
    const rowText = normalizeHeaderText(cellText(cellAt(grid, rowIndex, colIndex)))
    if (!headerText) continue
    compared += 1
    if (headerText === rowText) matches += 1
  }
  return compared > 0 && matches === compared
}

/**
 * Apply a native profile to a workbook grid and produce a dry-run artifact
 * shaped for the contract-migration planner (ProposedPricingRow objects,
 * exceptions, excluded rows, aggregate summary).
 *
 * @param {Object} input
 * @param {Object} input.grid Sheet grid to extract from.
 * @param {Object} input.profile Native profile: { profile_name, profile_version, sheet_name, header_row, data_start_row?, stop_after_blank_rows?, column_mappings: [{canonical_field, column_letter, required}], defaults? }
 * @param {Object} input.uploadMeta { upload_id, file_name, file_hash, distributor_name, contract_number, effective_date, expiration_date?, account_number?, location? }
 * @param {Array}  input.uomAliases uom alias reference entries
 */
export function extractWorkbookRows({ grid, profile, uploadMeta, uomAliases }) {
  const mappings = (profile.column_mappings ?? []).filter(
    (mapping) => CANONICAL_FIELDS.includes(mapping.canonical_field) && columnIndexFromLetter(mapping.column_letter)
  )
  if (mappings.length === 0) throw new Error('Profile has no valid column mappings.')
  const priceMapping = mappings.find((mapping) => mapping.canonical_field === 'price')
  if (!priceMapping) throw new Error('Profile must map the price column.')

  const headerRow = Number(profile.header_row)
  const dataStart = Number(profile.data_start_row ?? headerRow + 1)
  const stopAfterBlanks = Number(profile.stop_after_blank_rows ?? 5)
  const defaults = profile.defaults ?? {}

  const proposedRows = []
  const exceptions = []
  const excludedRows = []
  const exceptionCounts = {}
  let rowsScanned = 0
  let consecutiveBlanks = 0

  const addException = (code, severity, rowNumber, cellRef, field, message) => {
    exceptionCounts[code] = (exceptionCounts[code] ?? 0) + 1
    exceptions.push({
      exception_code: code,
      severity,
      source_file: uploadMeta.file_name,
      source_sheet: grid.name,
      source_row: rowNumber,
      source_cell: cellRef ?? null,
      canonical_field: field ?? null,
      message,
    })
  }

  for (let rowIndex = dataStart; rowIndex < grid.rows.length; rowIndex += 1) {
    const mappedCells = mappings.map((mapping) => {
      const colIndex = columnIndexFromLetter(mapping.column_letter)
      const cell = cellAt(grid, rowIndex, colIndex)
      return { mapping, cell, address: cell?.address ?? `${mapping.column_letter}${rowIndex}` }
    })

    const nonEmpty = mappedCells.filter(({ cell }) => cellText(cell).length > 0)
    if (nonEmpty.length === 0) {
      consecutiveBlanks += 1
      if (consecutiveBlanks >= stopAfterBlanks) break
      continue
    }
    consecutiveBlanks = 0
    rowsScanned += 1

    if (rowIsRepeatedHeader(grid, rowIndex, mappings, headerRow)) {
      excludedRows.push({ source_sheet: grid.name, source_row: String(rowIndex), reason: 'repeated_header', message: 'Row repeats the header labels.' })
      continue
    }

    const canonical = {}
    const sourceColumnMap = {}
    const sourceCellMap = {}
    const formulaFields = []
    const exceptionCodes = []
    const warningCodes = []

    for (const { mapping, cell, address } of mappedCells) {
      const field = mapping.canonical_field
      const text = cellText(cell)
      sourceColumnMap[field] = mapping.column_letter
      sourceCellMap[field] = address
      if (cell?.isFormula) formulaFields.push(field)

      if (field === 'price') {
        const parsed = parsePrice(text)
        if (parsed.error) {
          exceptionCodes.push(parsed.error)
          addException(parsed.error, 'blocking', rowIndex, address, 'price', 'Price cell is missing, unparseable, or negative.')
        } else {
          canonical.price = String(parsed.value)
          canonical.raw_price = text
        }
      } else if (field === 'effective_date' || field === 'expiration_date') {
        const parsedDate = parseDateValue(cell)
        if (text && !parsedDate) {
          warningCodes.push('UNPARSEABLE_DATE')
          addException('UNPARSEABLE_DATE', 'warning', rowIndex, address, field, 'Date cell could not be parsed.')
        }
        if (parsedDate) canonical[field] = parsedDate
      } else if (text) {
        canonical[field] = text
      }

      if (mapping.required && !text) {
        exceptionCodes.push('MISSING_REQUIRED_FIELD')
        addException('MISSING_REQUIRED_FIELD', 'blocking', rowIndex, address, field, 'Required mapped cell is empty.')
      }
    }

    // UOM: mapped column first, profile default second.
    const rawUom = String(canonical.raw_price_uom ?? defaults.raw_price_uom ?? '').trim()
    if (rawUom) {
      const { normalized, recognized } = normalizeUom(rawUom, uomAliases)
      canonical.raw_price_uom = rawUom
      canonical.normalized_price_uom = normalized
      if (!recognized) {
        warningCodes.push('UNRECOGNIZED_UOM')
        addException('UNRECOGNIZED_UOM', 'warning', rowIndex, sourceCellMap.raw_price_uom ?? null, 'raw_price_uom', 'UOM token is not in the alias reference; using cleaned raw value.')
      }
    } else {
      exceptionCodes.push('MISSING_PRICE_UOM')
      addException('MISSING_PRICE_UOM', 'blocking', rowIndex, sourceCellMap.raw_price_uom ?? null, 'raw_price_uom', 'No UOM cell value and no profile default UOM.')
    }

    if (!IDENTIFIER_FIELDS.some((field) => String(canonical[field] ?? '').trim())) {
      exceptionCodes.push('MISSING_ITEM_IDENTIFIER')
      addException('MISSING_ITEM_IDENTIFIER', 'blocking', rowIndex, null, null, 'Row has no item identifier (SKU, MPN, model, GTIN, or NDC).')
    }
    if (!String(canonical.item_description_raw ?? '').trim()) {
      warningCodes.push('MISSING_DESCRIPTION')
      addException('MISSING_DESCRIPTION', 'warning', rowIndex, null, 'item_description_raw', 'Row has no item description.')
    }

    // Upload metadata fills canonical fields the workbook did not provide.
    for (const field of UPLOAD_METADATA_FIELDS) {
      const value = uploadMeta[field]
      if (value !== undefined && value !== null && String(value).trim() !== '' && !canonical[field]) {
        canonical[field] = String(value).trim()
      }
    }
    if (defaults.currency && !canonical.currency) canonical.currency = String(defaults.currency)

    const validationStatus = exceptionCodes.length > 0 ? 'blocking' : warningCodes.length > 0 ? 'warning' : 'valid'
    proposedRows.push({
      ingestion_row_id: `${uploadMeta.upload_id}:${grid.name}:${rowIndex}`,
      profile_name: profile.profile_name,
      profile_version: profile.profile_version,
      distributor_name: uploadMeta.distributor_name ?? null,
      distributor_id: null,
      validation_status: validationStatus,
      exception_codes: exceptionCodes,
      warning_codes: warningCodes,
      source_file: uploadMeta.file_name,
      source_file_hash: uploadMeta.file_hash,
      source_sheet_name: grid.name,
      source_row_number: rowIndex,
      source_column_map: sourceColumnMap,
      source_cell_map: sourceCellMap,
      formula_fields: formulaFields,
      canonical_row: canonical,
    })
  }

  const validRows = proposedRows.filter((row) => row.validation_status === 'valid').length
  const warningRows = proposedRows.filter((row) => row.validation_status === 'warning').length
  const blockingRows = proposedRows.filter((row) => row.validation_status === 'blocking').length

  return {
    proposedRows,
    exceptions,
    excludedRows,
    summary: {
      rows_scanned: rowsScanned,
      proposed_rows: proposedRows.length,
      valid_rows: validRows,
      warning_rows: warningRows,
      blocking_exception_rows: blockingRows,
      exception_counts: exceptionCounts,
    },
  }
}
