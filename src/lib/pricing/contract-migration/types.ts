export type ValidationStatus = 'valid' | 'warning' | 'blocking'

export type DryRunSummary = {
  rows_scanned: number
  proposed_rows: number
  valid_rows: number
  warning_rows: number
  blocking_exception_rows: number
  exception_counts: Record<string, number>
  output?: string
}

export type ProposedPricingRow = {
  ingestion_row_id: string
  profile_name: string
  profile_version: string
  distributor_name?: string | null
  distributor_id?: string | null
  validation_status: ValidationStatus
  exception_codes: string[]
  warning_codes: string[]
  source_file: string
  source_file_hash: string
  source_sheet_name: string
  source_row_number: number | null
  source_column_map: Record<string, unknown>
  source_cell_map: Record<string, unknown>
  formula_fields: string[]
  canonical_row: Record<string, unknown>
}

export type DryRunException = {
  exception_code: string
  severity: 'info' | 'warning' | 'blocking'
  source_file?: string
  source_sheet?: string
  source_row: number | null
  source_cell?: string
  canonical_field?: string
  message?: string
}

export type ExcludedDryRunRow = {
  source_file?: string
  source_sheet?: string
  source_row?: string
  reason?: string
  message?: string
  decision_id?: string
}

export type DryRunArtifact = {
  dryRunId: string
  dryRunPath: string
  summary: DryRunSummary
  proposedRows: ProposedPricingRow[]
  exceptions: DryRunException[]
  excludedRows: ExcludedDryRunRow[]
  mappingReview?: string
}

export type MigrationBlockingReason = {
  code: string
  count: number
  message: string
}

export type MigrationBatchDraft = {
  dryRunId: string
  sourceFileName: string | null
  sourceFileHash: string | null
  profileName: string
  profileVersion: string
  distributorName: string | null
  distributorId: string | null
  status: 'staged' | 'needs_review'
  rowCount: number
  validRowCount: number
  warningRowCount: number
  blockingRowCount: number
  summaryJson: Record<string, unknown>
}

export type MigrationStagePlan = {
  dryRunId: string
  batch: MigrationBatchDraft
  rowsEligibleToStage: number
  rowsBlocked: number
  rowsRequiringReview: number
  exceptionCounts: Record<string, number>
  metadataGaps: number
  lineageGaps: number
  duplicateConflictCount: number
  blockingReasons: MigrationBlockingReason[]
  canStage: boolean
}

export type MigrationPreflightResult = {
  ok: boolean
  artifact: {
    dryRunId: string
    dryRunPath: string
  }
  summary: {
    rowsFound: number
    validRows: number
    warningRows: number
    blockingRows: number
    excludedRows: number
  }
  plan: MigrationStagePlan
}

export type MigrationStageResult = {
  staged: boolean
  batchId?: string
  dryRunId: string
  rowsInserted: number
  exceptionsInserted: number
  status: string
}

export type ExceptionReviewStatus = 'open' | 'acknowledged' | 'resolved' | 'waived' | 'rejected'

export type ExceptionReviewInput = {
  status: ExceptionReviewStatus
  resolution?: string | null
  resolutionNotes?: string | null
  reviewerId?: string | null
}

export type ExceptionReviewResult = {
  id: string
  batch_id: string
  status: ExceptionReviewStatus
  reviewed_at: string | null
}

export type BatchApprovalInput = {
  reviewerId?: string | null
  reviewerIdentifier?: string | null
  notes?: string | null
}

export type BatchApprovalResult = {
  batchId: string
  status: 'approved'
  approvedAt: string
  publishEnabled: false
}

export type PublishPreviewResult = {
  batchId: string
  batchStatus: string
  rowCount: number
  validRowCount: number
  warningRowCount: number
  blockingRowCount: number
  openExceptionCount: number
  unresolvedExceptionCount: number
  candidatePendingCostLines: number
  existingPendingCostLines: number
  existingActiveCostLines: number
  wouldCreateActiveCosts: boolean
  wouldTouchCustomerSellPricing: false
  canProceedToPublishImplementation: boolean
  blockers: string[]
}

export type PreparePublishInput = {
  actorId?: string | null
  notes?: string | null
}

export type PreparePublishResult = {
  batchId: string
  supplierContractId: string
  pendingCostLinesCreated: number
  pendingCostLinesReplaced: number
  activeCostLinesCreated: 0
  skippedRows: number
  blockerCount: number
  status: 'publishing'
  publishEnabled: false
}

export type PublishBatchInput = {
  actorId?: string | null
  notes?: string | null
  confirm?: string | null
}

export type PublishBatchResult = {
  batchId: string
  supplierContractId: string
  activatedCostLines: number
  supersededCostLines: number
  linesWithoutIdentity: number
  status: 'published'
  publishedAt: string
}

export type RollbackBatchInput = {
  actorId?: string | null
  notes?: string | null
  confirm?: string | null
}

export type RollbackBatchResult = {
  batchId: string
  supplierContractId: string | null
  deactivatedCostLines: number
  restoredCostLines: number
  status: 'rolled_back'
  rolledBackAt: string
}

export type ActiveSupplierCostQuery = {
  supplierContractId?: string | null
  supplierName?: string | null
  internalItemId?: string | null
  distributorSku?: string | null
  manufacturerPartNumber?: string | null
  gtin?: string | null
  priceUom?: string | null
  asOfDate?: string | null
  limit?: number | null
}

export type ActiveSupplierCost = {
  id: string
  supplier_contract_id: string | null
  supplier_name: string | null
  internal_item_id: string | null
  distributor_sku: string | null
  manufacturer_name: string | null
  manufacturer_part_number: string | null
  model_number: string | null
  gtin: string | null
  item_description_raw: string | null
  cost: number
  currency: string
  raw_price_uom: string | null
  normalized_price_uom: string | null
  pack_size: number | null
  tier: string | null
  minimum_quantity: number | null
  effective_date: string | null
  expiration_date: string | null
  source_batch_id: string | null
  approved_at: string | null
}

export type ActiveSupplierCostResult = {
  asOfDate: string
  count: number
  lines: ActiveSupplierCost[]
}

export type SupplierContractCostLineDraft = {
  supplierName: string | null
  distributorSku?: string | null
  manufacturerPartNumber?: string | null
  modelNumber?: string | null
  rawPrice: number
  cost: number
  currency: string
  active: false
  approvalStatus: 'pending'
}
