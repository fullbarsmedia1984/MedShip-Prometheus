import type { SheetGrid } from './workbook-reader.mjs'
import type { DryRunException, DryRunSummary, ExcludedDryRunRow, ProposedPricingRow } from '../contract-migration/types'

export const CANONICAL_FIELDS: string[]

export function columnIndexFromLetter(letter: string): number | null

export type HeaderCandidate = {
  row_number: number
  cell_count: number
  synonym_hits: number
  score: number
}

export type DiscoveredSheet = {
  name: string
  row_count: number
  header_candidates: HeaderCandidate[]
  detected_header_row: number | null
  headers: Array<{ column_letter: string; header: string }>
}

export function discoverWorkbook(grids: SheetGrid[]): { sheets: DiscoveredSheet[] }

export type MappingSuggestion = {
  canonical_field: string
  column_letter: string
  header: string
  confidence: number
}

export function suggestColumnMappings(
  headers: Array<{ column_letter: string; header: string }>
): MappingSuggestion[]

export function recommendSheet(
  sheets: Array<{ name: string; row_count: number; suggested_mappings?: Array<{ canonical_field: string }> }>
): string | null

export function parsePrice(text: unknown): { value: number | null; error: string | null }

export function normalizeUom(
  raw: unknown,
  uomAliases: Array<{ alias?: unknown; normalized_uom?: unknown }>
): { normalized: string | null; recognized: boolean }

export function parseDateValue(cell: { isDate?: boolean; dateIso?: string | null; text?: string } | null): string | null

export type NativeProfileJson = {
  profile_name: string
  profile_version: string
  sheet_name?: string
  header_row: number
  data_start_row?: number
  stop_after_blank_rows?: number
  column_mappings: Array<{ canonical_field: string; column_letter: string; required?: boolean }>
  defaults?: Record<string, string>
}

export type NativeUploadMeta = {
  upload_id: string
  file_name: string
  file_hash: string
  distributor_name?: string | null
  contract_number?: string | null
  effective_date?: string | null
  expiration_date?: string | null
  account_number?: string | null
  location?: string | null
  contract_name?: string | null
}

export function extractWorkbookRows(input: {
  grid: SheetGrid
  profile: NativeProfileJson
  uploadMeta: NativeUploadMeta
  uomAliases: Array<{ alias?: unknown; normalized_uom?: unknown }>
}): {
  proposedRows: ProposedPricingRow[]
  exceptions: DryRunException[]
  excludedRows: ExcludedDryRunRow[]
  summary: DryRunSummary
}
