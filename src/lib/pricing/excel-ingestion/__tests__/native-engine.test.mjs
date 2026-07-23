import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import ExcelJS from 'exceljs'

import { readWorkbookGrids } from '../workbook-reader.mjs'
import {
  discoverWorkbook,
  extractWorkbookRows,
  normalizeUom,
  parsePrice,
  recommendSheet,
  suggestColumnMappings,
} from '../native-engine.mjs'

const UOM_ALIASES = [
  { alias: 'EACHES', normalized_uom: 'EA' },
  { alias: 'CASES', normalized_uom: 'CS' },
]

const UPLOAD_META = {
  upload_id: 'upload-test-1',
  file_name: 'fictional_pricelist.xlsx',
  file_hash: 'hash123',
  distributor_name: 'Fictional Distributor',
  contract_number: 'FICTIONAL-CONTRACT-1',
  effective_date: '2026-01-01',
}

async function buildSyntheticWorkbook() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Pricing')
  sheet.getCell('A1').value = 'Fictional Distributor Price List'
  // Header row at 3.
  sheet.getCell('A3').value = 'Item #'
  sheet.getCell('B3').value = 'Description'
  sheet.getCell('C3').value = 'UOM'
  sheet.getCell('D3').value = 'Contract Price'
  sheet.getCell('E3').value = 'UPC'
  // Clean row.
  sheet.getCell('A4').value = 'FD-100'
  sheet.getCell('B4').value = 'Fictional widget alpha'
  sheet.getCell('C4').value = 'eaches'
  sheet.getCell('D4').value = '$12.34'
  sheet.getCell('E4').value = '00012345678905'
  // Warning row: unknown UOM, no description.
  sheet.getCell('A5').value = 'FD-101'
  sheet.getCell('C5').value = 'gross'
  sheet.getCell('D5').value = 56.78
  // Blocking row: no identifier, bad price.
  sheet.getCell('B6').value = 'Mystery item with no identifier'
  sheet.getCell('C6').value = 'CS'
  sheet.getCell('D6').value = 'call for pricing'
  // Formula price row.
  sheet.getCell('A7').value = 'FD-102'
  sheet.getCell('B7').value = 'Fictional widget beta'
  sheet.getCell('C7').value = 'cases'
  sheet.getCell('D7').value = { formula: 'D4*2', result: 24.68 }
  sheet.getCell('E7').value = '00012345678912'
  // Repeated header row (page break artifact).
  sheet.getCell('A8').value = 'Item #'
  sheet.getCell('B8').value = 'Description'
  sheet.getCell('C8').value = 'UOM'
  sheet.getCell('D8').value = 'Contract Price'
  sheet.getCell('E8').value = 'UPC'

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

const PROFILE = {
  profile_name: 'fictional_native',
  profile_version: '1.0.0',
  sheet_name: 'Pricing',
  header_row: 3,
  column_mappings: [
    { canonical_field: 'distributor_sku', column_letter: 'A', required: false },
    { canonical_field: 'item_description_raw', column_letter: 'B', required: false },
    { canonical_field: 'raw_price_uom', column_letter: 'C', required: false },
    { canonical_field: 'price', column_letter: 'D', required: true },
    { canonical_field: 'gtin', column_letter: 'E', required: false },
  ],
  defaults: { currency: 'USD' },
}

describe('native excel ingestion engine', () => {
  let grids

  before(async () => {
    grids = await readWorkbookGrids(await buildSyntheticWorkbook())
  })

  it('discovers the header row and headers', () => {
    const discovery = discoverWorkbook(grids)
    assert.equal(discovery.sheets.length, 1)
    const sheet = discovery.sheets[0]
    assert.equal(sheet.name, 'Pricing')
    assert.equal(sheet.detected_header_row, 3)
    assert.equal(sheet.headers.length, 5)
  })

  it('suggests deterministic column mappings from header synonyms', () => {
    const discovery = discoverWorkbook(grids)
    const suggestions = suggestColumnMappings(discovery.sheets[0].headers)
    const byField = Object.fromEntries(suggestions.map((entry) => [entry.canonical_field, entry]))
    assert.equal(byField.distributor_sku.column_letter, 'A')
    assert.equal(byField.item_description_raw.column_letter, 'B')
    assert.equal(byField.raw_price_uom.column_letter, 'C')
    assert.equal(byField.price.column_letter, 'D')
    assert.equal(byField.gtin.column_letter, 'E')
    assert.ok(byField.price.confidence >= 0.9)
  })

  it('extracts rows with statuses, lineage, and injected upload metadata', () => {
    const result = extractWorkbookRows({ grid: grids[0], profile: PROFILE, uploadMeta: UPLOAD_META, uomAliases: UOM_ALIASES })

    assert.equal(result.summary.proposed_rows, 4)
    assert.equal(result.summary.valid_rows, 2)
    assert.equal(result.summary.warning_rows, 1)
    assert.equal(result.summary.blocking_exception_rows, 1)
    assert.equal(result.excludedRows.length, 1)
    assert.equal(result.excludedRows[0].reason, 'repeated_header')

    const clean = result.proposedRows.find((row) => row.source_row_number === 4)
    assert.equal(clean.validation_status, 'valid')
    assert.equal(clean.canonical_row.price, '12.34')
    assert.equal(clean.canonical_row.normalized_price_uom, 'EA')
    assert.equal(clean.canonical_row.contract_number, 'FICTIONAL-CONTRACT-1')
    assert.equal(clean.canonical_row.effective_date, '2026-01-01')
    assert.equal(clean.source_cell_map.price, 'D4')
    assert.equal(clean.source_column_map.price, 'D')

    const warning = result.proposedRows.find((row) => row.source_row_number === 5)
    assert.equal(warning.validation_status, 'warning')
    assert.deepEqual(warning.exception_codes, [])
    assert.ok(warning.warning_codes.includes('UNRECOGNIZED_UOM'))
    assert.ok(warning.warning_codes.includes('MISSING_DESCRIPTION'))

    const blocking = result.proposedRows.find((row) => row.source_row_number === 6)
    assert.equal(blocking.validation_status, 'blocking')
    assert.ok(blocking.exception_codes.includes('UNPARSEABLE_PRICE'))
    assert.ok(blocking.exception_codes.includes('MISSING_ITEM_IDENTIFIER'))

    const formulaRow = result.proposedRows.find((row) => row.source_row_number === 7)
    assert.equal(formulaRow.validation_status, 'valid')
    assert.equal(formulaRow.canonical_row.price, '24.68')
    assert.ok(formulaRow.formula_fields.includes('price'))
    assert.equal(formulaRow.canonical_row.normalized_price_uom, 'CS')
  })

  it('uses the profile default UOM when no UOM column value exists', () => {
    const profile = {
      ...PROFILE,
      column_mappings: PROFILE.column_mappings.filter((mapping) => mapping.canonical_field !== 'raw_price_uom'),
      defaults: { currency: 'USD', raw_price_uom: 'EA' },
    }
    const result = extractWorkbookRows({ grid: grids[0], profile, uploadMeta: UPLOAD_META, uomAliases: UOM_ALIASES })
    const clean = result.proposedRows.find((row) => row.source_row_number === 4)
    assert.equal(clean.canonical_row.raw_price_uom, 'EA')
    assert.equal(clean.canonical_row.normalized_price_uom, 'EA')
  })
})

describe('mapping suggestion synonyms', () => {
  it('matches "Customer Price" exactly, beating a partial-match List Price column', () => {
    const suggestions = suggestColumnMappings([
      { column_letter: 'A', header: 'Item #' },
      { column_letter: 'B', header: 'List Price' },
      { column_letter: 'C', header: 'Customer Price' },
    ])
    const price = suggestions.find((entry) => entry.canonical_field === 'price')
    assert.equal(price.column_letter, 'C')
    assert.ok(price.confidence >= 0.9)
  })

  it('never suggests List Price with high confidence', () => {
    const suggestions = suggestColumnMappings([
      { column_letter: 'A', header: 'Item #' },
      { column_letter: 'B', header: 'List Price' },
    ])
    const price = suggestions.find((entry) => entry.canonical_field === 'price')
    assert.ok(!price || price.confidence < 0.9)
  })
})

describe('recommendSheet', () => {
  it('prefers the sheet with a suggested price column over an earlier terms sheet', () => {
    const best = recommendSheet([
      { name: 'Terms', row_count: 120, suggested_mappings: [] },
      {
        name: 'Price List',
        row_count: 800,
        suggested_mappings: [
          { canonical_field: 'distributor_sku' },
          { canonical_field: 'price' },
        ],
      },
      { name: 'Notes', row_count: 10, suggested_mappings: [{ canonical_field: 'item_description_raw' }] },
    ])
    assert.equal(best, 'Price List')
  })

  it('breaks price ties by suggestion count, then row count', () => {
    const best = recommendSheet([
      { name: 'Small', row_count: 5, suggested_mappings: [{ canonical_field: 'price' }] },
      {
        name: 'Rich',
        row_count: 5,
        suggested_mappings: [{ canonical_field: 'price' }, { canonical_field: 'distributor_sku' }],
      },
      { name: 'Big', row_count: 900, suggested_mappings: [{ canonical_field: 'price' }] },
    ])
    assert.equal(best, 'Rich')
  })

  it('returns null when no sheet has any suggestions', () => {
    assert.equal(recommendSheet([{ name: 'Terms', row_count: 120, suggested_mappings: [] }]), null)
    assert.equal(recommendSheet([]), null)
  })
})

describe('normalization helpers', () => {
  it('parses currency-formatted and parenthesized prices', () => {
    assert.equal(parsePrice('$1,234.56').value, 1234.56)
    assert.equal(parsePrice('(5.00)').error, 'NEGATIVE_PRICE')
    assert.equal(parsePrice('').error, 'MISSING_PRICE')
    assert.equal(parsePrice('TBD').error, 'UNPARSEABLE_PRICE')
  })

  it('normalizes UOM tokens via known set and aliases', () => {
    assert.deepEqual(normalizeUom('ea.', []), { normalized: 'EA', recognized: true })
    assert.deepEqual(normalizeUom('EACHES', UOM_ALIASES), { normalized: 'EA', recognized: true })
    assert.equal(normalizeUom('GROSS', UOM_ALIASES).recognized, false)
  })
})
