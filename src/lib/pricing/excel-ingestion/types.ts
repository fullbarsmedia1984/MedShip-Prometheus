export type WorkbookUploadMetadataInput = {
  distributorName: string
  contractNumber: string
  effectiveDate: string
  expirationDate?: string | null
  accountNumber?: string | null
  locationScope?: string | null
  notes?: string | null
}

export type WorkbookUploadStatus = 'uploaded' | 'discovered' | 'dry_run' | 'staged' | 'failed'

export type WorkbookUploadSummary = {
  id: string
  file_name: string
  file_size: number | null
  distributor_name: string
  contract_number: string
  effective_date: string
  expiration_date: string | null
  status: WorkbookUploadStatus
  profile_id: string | null
  staged_batch_id: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export type SheetDiscovery = {
  name: string
  row_count: number
  detected_header_row: number | null
  header_candidates: Array<{ row_number: number; cell_count: number; synonym_hits: number; score: number }>
  headers: Array<{ column_letter: string; header: string }>
  suggested_mappings: Array<{ canonical_field: string; column_letter: string; header: string; confidence: number }>
}

export type WorkbookDiscovery = {
  sheets: SheetDiscovery[]
}

export type NativeProfileInput = {
  profileName?: string | null
  sheetName: string
  headerRow: number
  dataStartRow?: number | null
  defaultPriceUom?: string | null
  columnMappings: Array<{ canonicalField: string; columnLetter: string; required?: boolean }>
}

export type NativeProfileRecord = {
  id: string
  profile_name: string
  profile_version: string
  distributor_name: string
  status: string
  profile_json: Record<string, unknown>
  created_at: string
}

export type WorkbookDryRunResult = {
  uploadId: string
  profileId: string
  dryRunId: string
  summary: {
    rows_scanned: number
    proposed_rows: number
    valid_rows: number
    warning_rows: number
    blocking_exception_rows: number
    exception_counts: Record<string, number>
  }
  excludedRows: number
  canStage: boolean
  blockingReasons: Array<{ code: string; count: number; message: string }>
}

export type WorkbookStageResult = {
  uploadId: string
  batchId: string
  dryRunId: string
  rowsInserted: number
  exceptionsInserted: number
  batchStatus: string
}
