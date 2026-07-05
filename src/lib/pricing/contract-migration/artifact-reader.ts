import 'server-only'

import { existsSync, readFileSync } from 'node:fs'
import { basename, join, normalize } from 'node:path'
import type {
  DryRunArtifact,
  DryRunException,
  DryRunSummary,
  ExcludedDryRunRow,
  ProposedPricingRow,
  ValidationStatus,
} from './types'

const REQUIRED_FILES = ['dry_run_summary.json', 'proposed_rows.csv', 'exceptions.csv', 'excluded_rows.csv']
const DRY_RUN_ROOT = join(process.cwd(), 'outputs', 'pricing_discovery', 'dry_runs')

const CANONICAL_ROW_FIELDS = [
  'distributor_name',
  'distributor_id',
  'contract_name',
  'contract_number',
  'account_number',
  'location',
  'internal_item_id',
  'distributor_sku',
  'model_number',
  'manufacturer_name',
  'manufacturer_part_number',
  'gtin',
  'udi',
  'ndc',
  'item_description_raw',
  'item_description_normalized',
  'raw_uom',
  'normalized_uom',
  'raw_price_uom',
  'normalized_price_uom',
  'raw_base_uom',
  'normalized_base_uom',
  'raw_pack_size',
  'pack_size',
  'raw_price',
  'price',
  'currency',
  'tier',
  'effective_date',
  'expiration_date',
  'minimum_quantity',
  'rebate_terms',
  'freight_terms',
  'metadata_source_map',
] as const

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(value)
      value = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(value)
      rows.push(row)
      row = []
      value = ''
      continue
    }

    value += char
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value)
    rows.push(row)
  }

  const [headers = [], ...dataRows] = rows
  return dataRows
    .filter((dataRow) => dataRow.some((cell) => cell.trim() !== ''))
    .map((dataRow) =>
      Object.fromEntries(headers.map((header, index) => [header.trim(), dataRow[index] ?? '']))
    )
}

function parseJsonObject(value: string): Record<string, unknown> {
  if (!value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseJsonArray(value: string): string[] {
  if (!value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return value
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function normalizeSeverity(value: string): DryRunException['severity'] {
  if (value === 'blocking' || value === 'warning' || value === 'info') return value
  return 'warning'
}

function normalizeStatus(value: string): ValidationStatus {
  if (value === 'valid' || value === 'warning' || value === 'blocking') return value
  return 'blocking'
}

function canonicalRow(row: Record<string, string>) {
  return Object.fromEntries(
    CANONICAL_ROW_FIELDS.map((field) => [
      field,
      field === 'metadata_source_map' ? parseJsonObject(row[field] ?? '') : (row[field] || null),
    ])
  )
}

function toProposedRow(row: Record<string, string>): ProposedPricingRow {
  return {
    ingestion_row_id: row.ingestion_row_id,
    profile_name: row.profile_name,
    profile_version: row.profile_version,
    distributor_name: row.distributor_name || null,
    distributor_id: row.distributor_id || null,
    validation_status: normalizeStatus(row.validation_status),
    exception_codes: parseJsonArray(row.exception_codes),
    warning_codes: parseJsonArray(row.warning_codes),
    source_file: row.source_file,
    source_file_hash: row.source_file_hash,
    source_sheet_name: row.source_sheet_name,
    source_row_number: parseNumber(row.source_row_number),
    source_column_map: parseJsonObject(row.source_column_map),
    source_cell_map: parseJsonObject(row.source_cell_map),
    formula_fields: parseJsonArray(row.formula_fields),
    canonical_row: canonicalRow(row),
  }
}

function toException(row: Record<string, string>): DryRunException {
  return {
    exception_code: row.exception_code,
    severity: normalizeSeverity(row.severity),
    source_file: row.source_file,
    source_sheet: row.source_sheet,
    source_row: parseNumber(row.source_row),
    source_cell: row.source_cell,
    canonical_field: row.canonical_field,
    message: row.message,
  }
}

function safeDryRunPath(dryRunPathInput: string) {
  const normalizedInput = normalize(dryRunPathInput.replace(/\\/g, '/'))
    .replace(/^outputs[/\\]pricing_discovery[/\\]dry_runs[/\\]?/, '')
    .replace(/^[/\\]+/, '')

  if (!normalizedInput || normalizedInput.startsWith('..') || normalizedInput.includes(`..\\`) || normalizedInput.includes('../')) {
    throw new Error('Dry-run path must be a relative path under outputs/pricing_discovery/dry_runs.')
  }

  return join(DRY_RUN_ROOT, normalizedInput)
}

export function assertRequiredDryRunFiles(dryRunPath: string) {
  const missing = REQUIRED_FILES.filter((file) => !existsSync(join(/* turbopackIgnore: true */ dryRunPath, file)))
  if (missing.length > 0) {
    throw new Error(`Dry-run artifact is missing required file(s): ${missing.join(', ')}`)
  }
}

export function readDryRunArtifact(dryRunPathInput: string): DryRunArtifact {
  const dryRunPath = safeDryRunPath(dryRunPathInput)
  assertRequiredDryRunFiles(dryRunPath)

  const summary = JSON.parse(
    readFileSync(join(/* turbopackIgnore: true */ dryRunPath, 'dry_run_summary.json'), 'utf8')
  ) as DryRunSummary
  const proposedRows = parseCsv(readFileSync(join(/* turbopackIgnore: true */ dryRunPath, 'proposed_rows.csv'), 'utf8')).map(toProposedRow)
  const exceptions = parseCsv(readFileSync(join(/* turbopackIgnore: true */ dryRunPath, 'exceptions.csv'), 'utf8')).map(toException)
  const excludedRows = parseCsv(readFileSync(join(/* turbopackIgnore: true */ dryRunPath, 'excluded_rows.csv'), 'utf8')) as ExcludedDryRunRow[]
  const mappingReviewPath = join(/* turbopackIgnore: true */ dryRunPath, 'mapping_review.md')

  return {
    dryRunId: basename(dryRunPath),
    dryRunPath,
    summary,
    proposedRows,
    exceptions,
    excludedRows,
    mappingReview: existsSync(mappingReviewPath) ? readFileSync(mappingReviewPath, 'utf8') : undefined,
  }
}
