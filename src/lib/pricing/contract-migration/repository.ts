import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  BatchApprovalInput,
  BatchApprovalResult,
  DryRunArtifact,
  DryRunException,
  ExceptionReviewInput,
  ExceptionReviewResult,
  MigrationBatchDraft,
  MigrationStageResult,
  PreparePublishInput,
  PreparePublishResult,
  PublishPreviewResult,
  ProposedPricingRow,
} from './types'

type DbRow = Record<string, unknown>
type ExceptionStatus = 'open' | 'acknowledged' | 'resolved' | 'waived' | 'rejected'

const REVIEWED_EXCEPTION_STATUSES = new Set<ExceptionStatus>(['acknowledged', 'resolved', 'waived', 'rejected'])

function configuredForWrites() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function missingRelation(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; message?: string }
  const message = candidate.message?.toLowerCase() ?? ''
  return candidate.code === '42P01' || candidate.code === 'PGRST205' || message.includes('does not exist')
}

function assertNoError(error: unknown) {
  if (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'Unknown Supabase error'
    throw new Error(message)
  }
}

function arrayValue(values: string[]) {
  return values.filter(Boolean)
}

function batchPayload(batch: MigrationBatchDraft, createdBy?: string | null) {
  return {
    source_file_name: batch.sourceFileName,
    source_file_hash: batch.sourceFileHash,
    dry_run_id: batch.dryRunId,
    profile_name: batch.profileName,
    profile_version: batch.profileVersion,
    distributor_name: batch.distributorName,
    distributor_id: batch.distributorId,
    status: batch.status,
    row_count: batch.rowCount,
    valid_row_count: batch.validRowCount,
    warning_row_count: batch.warningRowCount,
    blocking_row_count: batch.blockingRowCount,
    summary_json: batch.summaryJson,
    created_by: createdBy ?? null,
    updated_at: new Date().toISOString(),
  }
}

function rowPayload(batchId: string, row: ProposedPricingRow) {
  return {
    batch_id: batchId,
    row_number: row.source_row_number,
    ingestion_row_id: row.ingestion_row_id,
    validation_status: row.validation_status,
    exception_codes: arrayValue(row.exception_codes),
    warning_codes: arrayValue(row.warning_codes),
    canonical_row: row.canonical_row,
    raw_row_reference: {
      source_file_name: row.source_file,
      source_sheet_name: row.source_sheet_name,
      source_row_number: row.source_row_number,
    },
    source_file_name: row.source_file,
    source_file_hash: row.source_file_hash,
    source_sheet_name: row.source_sheet_name,
    source_row_number: row.source_row_number,
    source_column_map: row.source_column_map,
    source_cell_map: row.source_cell_map,
    formula_fields: arrayValue(row.formula_fields),
  }
}

function exceptionPayload(batchId: string, exception: DryRunException, rowIdsBySourceRow: Map<number, string>) {
  const sourceRow = exception.source_row
  return {
    batch_id: batchId,
    row_id: sourceRow ? rowIdsBySourceRow.get(sourceRow) ?? null : null,
    severity: exception.severity,
    exception_code: exception.exception_code,
    canonical_field: exception.canonical_field || null,
    source_sheet_name: exception.source_sheet || null,
    source_row_number: sourceRow,
    source_cell_reference: exception.source_cell || null,
    message: exception.message || null,
    status: 'open',
  }
}

export async function listMigrationBatches() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pricing_ingestion_batches')
    .select('id, dry_run_id, source_file_name, profile_name, profile_version, distributor_name, status, row_count, valid_row_count, warning_row_count, blocking_row_count, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  return data ?? []
}

export async function getMigrationBatch(id: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pricing_ingestion_batches')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    if (missingRelation(error)) return null
    throw error
  }
  return data
}

export async function listMigrationRows(batchId: string, page: number, pageSize: number) {
  const supabase = createAdminClient()
  const from = Math.max(0, page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await supabase
    .from('pricing_ingestion_rows')
    .select('id, row_number, ingestion_row_id, validation_status, exception_codes, warning_codes, source_file_name, source_sheet_name, source_row_number, source_column_map, source_cell_map, formula_fields, created_at', { count: 'exact' })
    .eq('batch_id', batchId)
    .order('row_number')
    .range(from, to)

  if (error) {
    if (missingRelation(error)) return { rows: [], total: 0, page, pageSize }
    throw error
  }
  return { rows: data ?? [], total: count ?? 0, page, pageSize }
}

export async function listMigrationExceptions(batchId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pricing_ingestion_exceptions')
    .select('id, severity, exception_code, canonical_field, source_sheet_name, source_row_number, source_cell_reference, message, status, resolution, resolution_notes, reviewed_at, created_at')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: false })

  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  return data ?? []
}

function safeUuid(value?: string | null) {
  const text = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null
}

function assertConfiguredForReview() {
  if (!configuredForWrites()) {
    throw new Error('Supabase service credentials are required for pricing review actions.')
  }
}

function nonEmptyText(value?: string | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function stringField(row: DbRow, field: string) {
  return nonEmptyText(row[field] === undefined || row[field] === null ? null : String(row[field]))
}

function numberField(row: DbRow, field: string) {
  const value = row[field]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').trim().replace(/[$,]/g, '')
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

function dateField(row: DbRow, field: string) {
  const text = stringField(row, field)
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : text.slice(0, 10)
}

function jsonObject(value: unknown): DbRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as DbRow : {}
}

export async function reviewMigrationException(
  batchId: string,
  exceptionId: string,
  input: ExceptionReviewInput
): Promise<ExceptionReviewResult> {
  assertConfiguredForReview()

  const status = input.status
  if (!['open', 'acknowledged', 'resolved', 'waived', 'rejected'].includes(status)) {
    throw new Error('Invalid exception review status.')
  }

  if (REVIEWED_EXCEPTION_STATUSES.has(status) && !nonEmptyText(input.resolutionNotes)) {
    throw new Error('Resolution notes are required when reviewing an exception.')
  }

  const reviewed = status === 'open'
    ? { reviewed_by: null, reviewed_at: null }
    : { reviewed_by: safeUuid(input.reviewerId), reviewed_at: new Date().toISOString() }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pricing_ingestion_exceptions')
    .update({
      status,
      resolution: nonEmptyText(input.resolution),
      resolution_notes: nonEmptyText(input.resolutionNotes),
      ...reviewed,
    })
    .eq('id', exceptionId)
    .eq('batch_id', batchId)
    .select('id, batch_id, status, reviewed_at')
    .single()

  assertNoError(error)
  const row = data as DbRow
  return {
    id: String(row.id),
    batch_id: String(row.batch_id),
    status: row.status as ExceptionStatus,
    reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null,
  }
}

async function exceptionReviewCounts(batchId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pricing_ingestion_exceptions')
    .select('status, severity')
    .eq('batch_id', batchId)

  assertNoError(error)
  const rows = (data ?? []) as DbRow[]
  return {
    openExceptionCount: rows.filter((row) => row.status === 'open').length,
    unresolvedExceptionCount: rows.filter((row) => !REVIEWED_EXCEPTION_STATUSES.has(row.status as ExceptionStatus)).length,
    openBlockingExceptionCount: rows.filter((row) => row.status === 'open' && row.severity === 'blocking').length,
  }
}

export async function approveMigrationBatch(
  batchId: string,
  input: BatchApprovalInput = {}
): Promise<BatchApprovalResult> {
  assertConfiguredForReview()

  const batch = await getMigrationBatch(batchId)
  if (!batch) throw new Error('Batch not found.')
  if (!['staged', 'needs_review'].includes(String((batch as DbRow).status))) {
    throw new Error('Only staged or review-needed batches can be approved.')
  }
  if (Number((batch as DbRow).blocking_row_count ?? 0) > 0) {
    throw new Error('Batches with blocking rows cannot be approved.')
  }

  const counts = await exceptionReviewCounts(batchId)
  if (counts.openBlockingExceptionCount > 0) {
    throw new Error('Open blocking exceptions must be resolved or waived before approval.')
  }

  const supabase = createAdminClient()
  const approvedAt = new Date().toISOString()
  const reviewerId = safeUuid(input.reviewerId)
  const { data, error } = await supabase
    .from('pricing_ingestion_batches')
    .update({
      status: 'approved',
      approved_by: reviewerId,
      approved_at: approvedAt,
      updated_at: approvedAt,
    })
    .eq('id', batchId)
    .select('id, status, approved_at')
    .single()

  assertNoError(error)

  const { error: eventError } = await supabase
    .from('pricing_publish_events')
    .insert({
      batch_id: batchId,
      action: 'approve_batch',
      actor_id: reviewerId,
      status: 'approved',
      summary_json: {
        row_count: Number((batch as DbRow).row_count ?? 0),
        valid_row_count: Number((batch as DbRow).valid_row_count ?? 0),
        warning_row_count: Number((batch as DbRow).warning_row_count ?? 0),
        blocking_row_count: Number((batch as DbRow).blocking_row_count ?? 0),
        open_exception_count: counts.openExceptionCount,
        unresolved_exception_count: counts.unresolvedExceptionCount,
        publish_enabled: false,
        reviewer_identifier_present: Boolean(nonEmptyText(input.reviewerIdentifier)),
      },
      notes: nonEmptyText(input.notes),
    })
  assertNoError(eventError)

  const row = data as DbRow
  return {
    batchId: String(row.id),
    status: 'approved',
    approvedAt: String(row.approved_at ?? approvedAt),
    publishEnabled: false,
  }
}

export async function buildMigrationPublishPreview(batchId: string): Promise<PublishPreviewResult> {
  const batch = await getMigrationBatch(batchId)
  if (!batch) throw new Error('Batch not found.')

  const row = batch as DbRow
  const counts = await exceptionReviewCounts(batchId)
  const rowCount = Number(row.row_count ?? 0)
  const validRowCount = Number(row.valid_row_count ?? 0)
  const warningRowCount = Number(row.warning_row_count ?? 0)
  const blockingRowCount = Number(row.blocking_row_count ?? 0)
  const blockers: string[] = []

  if (blockingRowCount > 0) blockers.push('BLOCKING_ROWS_PRESENT')
  if (counts.openBlockingExceptionCount > 0) blockers.push('OPEN_BLOCKING_EXCEPTIONS')
  if (!['approved', 'staged', 'publishing'].includes(String(row.status))) blockers.push('BATCH_STATUS_NOT_READY')
  if (rowCount === 0 || validRowCount === 0) blockers.push('NO_VALID_ROWS')

  const supabase = createAdminClient()
  const { count: existingPendingCostLines, error: pendingError } = await supabase
    .from('supplier_contract_cost_lines')
    .select('id', { count: 'exact', head: true })
    .eq('source_batch_id', batchId)
    .eq('active', false)
    .eq('approval_status', 'pending')
  assertNoError(pendingError)

  const { count: existingActiveCostLines, error: activeError } = await supabase
    .from('supplier_contract_cost_lines')
    .select('id', { count: 'exact', head: true })
    .eq('source_batch_id', batchId)
    .eq('active', true)
  assertNoError(activeError)

  return {
    batchId,
    batchStatus: String(row.status ?? 'unknown'),
    rowCount,
    validRowCount,
    warningRowCount,
    blockingRowCount,
    openExceptionCount: counts.openExceptionCount,
    unresolvedExceptionCount: counts.unresolvedExceptionCount,
    candidatePendingCostLines: validRowCount,
    existingPendingCostLines: existingPendingCostLines ?? 0,
    existingActiveCostLines: existingActiveCostLines ?? 0,
    wouldCreateActiveCosts: false,
    wouldTouchCustomerSellPricing: false,
    canProceedToPublishImplementation: blockers.length === 0,
    blockers,
  }
}

async function listBatchRowsForPrepare(batchId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pricing_ingestion_rows')
    .select('id, validation_status, canonical_row, source_file_name, source_file_hash, source_sheet_name, source_row_number, source_column_map, source_cell_map')
    .eq('batch_id', batchId)
    .order('row_number')

  assertNoError(error)
  return (data ?? []) as DbRow[]
}

async function ensureSupplierContract(batch: DbRow, rows: DbRow[], actorId?: string | null) {
  const existingContractId = safeUuid(String(batch.supplier_contract_id ?? ''))
  if (existingContractId) return existingContractId

  const firstCanonicalRow = jsonObject(rows[0]?.canonical_row)
  const supplierName = stringField(firstCanonicalRow, 'distributor_name') ?? stringField(batch, 'distributor_name')
  if (!supplierName) throw new Error('Supplier name is required to create a supplier contract.')

  const supabase = createAdminClient()
  const now = new Date().toISOString()
  const { data: contract, error } = await supabase
    .from('supplier_contracts')
    .insert({
      supplier_name: supplierName,
      supplier_id: safeUuid(stringField(firstCanonicalRow, 'distributor_id')),
      contract_name: stringField(firstCanonicalRow, 'contract_name'),
      contract_number: stringField(firstCanonicalRow, 'contract_number'),
      account_number: stringField(firstCanonicalRow, 'account_number'),
      location_scope: stringField(firstCanonicalRow, 'location'),
      effective_date: dateField(firstCanonicalRow, 'effective_date'),
      expiration_date: dateField(firstCanonicalRow, 'expiration_date'),
      status: 'draft',
      metadata: {
        source: 'pricing_ingestion_prepare_publish',
        batch_id: String(batch.id),
        dry_run_id: stringField(batch, 'dry_run_id'),
        profile_name: stringField(batch, 'profile_name'),
        created_by_present: Boolean(safeUuid(actorId)),
      },
      updated_at: now,
    })
    .select('id')
    .single()

  assertNoError(error)
  const contractId = String((contract as DbRow).id)

  const { error: batchError } = await supabase
    .from('pricing_ingestion_batches')
    .update({ supplier_contract_id: contractId, updated_at: now })
    .eq('id', batch.id)
  assertNoError(batchError)

  return contractId
}

function pendingCostLinePayload(batchId: string, supplierContractId: string, row: DbRow, actorId?: string | null) {
  const canonical = jsonObject(row.canonical_row)
  const cost = numberField(canonical, 'price')
  const rawPrice = numberField(canonical, 'raw_price') ?? cost
  if (cost === null || rawPrice === null || cost < 0 || rawPrice < 0) return null

  return {
    supplier_contract_id: supplierContractId,
    supplier_name: stringField(canonical, 'distributor_name'),
    supplier_id: safeUuid(stringField(canonical, 'distributor_id')),
    internal_item_id: safeUuid(stringField(canonical, 'internal_item_id')),
    distributor_sku: stringField(canonical, 'distributor_sku'),
    manufacturer_name: stringField(canonical, 'manufacturer_name'),
    manufacturer_part_number: stringField(canonical, 'manufacturer_part_number'),
    model_number: stringField(canonical, 'model_number'),
    gtin: stringField(canonical, 'gtin'),
    udi: stringField(canonical, 'udi'),
    ndc: stringField(canonical, 'ndc'),
    item_description_raw: stringField(canonical, 'item_description_raw'),
    item_description_normalized: stringField(canonical, 'item_description_normalized'),
    raw_price: rawPrice,
    cost,
    currency: stringField(canonical, 'currency') ?? 'USD',
    raw_price_uom: stringField(canonical, 'raw_price_uom'),
    normalized_price_uom: stringField(canonical, 'normalized_price_uom'),
    raw_base_uom: stringField(canonical, 'raw_base_uom'),
    normalized_base_uom: stringField(canonical, 'normalized_base_uom'),
    raw_uom: stringField(canonical, 'raw_uom'),
    normalized_uom: stringField(canonical, 'normalized_uom'),
    raw_pack_size: stringField(canonical, 'raw_pack_size'),
    pack_size: numberField(canonical, 'pack_size'),
    tier: stringField(canonical, 'tier'),
    minimum_quantity: numberField(canonical, 'minimum_quantity'),
    effective_date: dateField(canonical, 'effective_date'),
    expiration_date: dateField(canonical, 'expiration_date'),
    source_batch_id: batchId,
    source_row_id: String(row.id),
    source_file_name: stringField(row, 'source_file_name'),
    source_file_hash: stringField(row, 'source_file_hash'),
    source_sheet_name: stringField(row, 'source_sheet_name'),
    source_row_number: numberField(row, 'source_row_number'),
    source_column_map: jsonObject(row.source_column_map),
    source_cell_map: jsonObject(row.source_cell_map),
    active: false,
    approval_status: 'pending',
    created_by: safeUuid(actorId),
  }
}

export async function prepareMigrationBatchForPublish(
  batchId: string,
  input: PreparePublishInput = {}
): Promise<PreparePublishResult> {
  assertConfiguredForReview()

  const preview = await buildMigrationPublishPreview(batchId)
  if (!preview.canProceedToPublishImplementation || !['approved', 'publishing'].includes(preview.batchStatus)) {
    throw new Error(`Batch is not ready to prepare pending costs. Blockers: ${preview.blockers.join(', ') || 'BATCH_NOT_APPROVED'}`)
  }

  const batch = await getMigrationBatch(batchId)
  if (!batch) throw new Error('Batch not found.')

  const rows = await listBatchRowsForPrepare(batchId)
  const validRows = rows.filter((row) => row.validation_status === 'valid' || row.validation_status === 'warning')
  const supplierContractId = await ensureSupplierContract(batch as DbRow, validRows, input.actorId)
  const payloads = validRows
    .map((row) => pendingCostLinePayload(batchId, supplierContractId, row, input.actorId))
    .filter((row): row is NonNullable<ReturnType<typeof pendingCostLinePayload>> => row !== null)

  const supabase = createAdminClient()
  const { count: replacedCount, error: countError } = await supabase
    .from('supplier_contract_cost_lines')
    .select('id', { count: 'exact', head: true })
    .eq('source_batch_id', batchId)
    .eq('active', false)
    .eq('approval_status', 'pending')
  assertNoError(countError)

  const { error: deleteError } = await supabase
    .from('supplier_contract_cost_lines')
    .delete()
    .eq('source_batch_id', batchId)
    .eq('active', false)
    .eq('approval_status', 'pending')
  assertNoError(deleteError)

  if (payloads.length > 0) {
    const { error: insertError } = await supabase
      .from('supplier_contract_cost_lines')
      .insert(payloads)
    assertNoError(insertError)
  }

  const now = new Date().toISOString()
  const { error: batchError } = await supabase
    .from('pricing_ingestion_batches')
    .update({ status: 'publishing', supplier_contract_id: supplierContractId, updated_at: now })
    .eq('id', batchId)
  assertNoError(batchError)

  const { error: eventError } = await supabase
    .from('pricing_publish_events')
    .insert({
      batch_id: batchId,
      action: 'publish_batch',
      actor_id: safeUuid(input.actorId),
      status: 'prepared_pending_costs',
      summary_json: {
        pending_cost_lines_created: payloads.length,
        pending_cost_lines_replaced: replacedCount ?? 0,
        active_cost_lines_created: 0,
        skipped_rows: validRows.length - payloads.length,
        publish_enabled: false,
      },
      notes: nonEmptyText(input.notes),
    })
  assertNoError(eventError)

  return {
    batchId,
    supplierContractId,
    pendingCostLinesCreated: payloads.length,
    pendingCostLinesReplaced: replacedCount ?? 0,
    activeCostLinesCreated: 0,
    skippedRows: validRows.length - payloads.length,
    blockerCount: preview.blockers.length,
    status: 'publishing',
    publishEnabled: false,
  }
}

export async function stageMigrationArtifact(
  artifact: DryRunArtifact,
  batch: MigrationBatchDraft,
  createdBy?: string | null
): Promise<MigrationStageResult> {
  if (!configuredForWrites()) {
    throw new Error('Supabase service credentials are required for staging.')
  }

  const supabase = createAdminClient()
  const { data: batchRow, error: batchError } = await supabase
    .from('pricing_ingestion_batches')
    .upsert(batchPayload(batch, createdBy), {
      onConflict: 'source_file_hash,dry_run_id,profile_name,profile_version',
    })
    .select('id, status')
    .single()

  assertNoError(batchError)
  const batchId = String((batchRow as DbRow).id)

  const { error: deleteExceptionsError } = await supabase
    .from('pricing_ingestion_exceptions')
    .delete()
    .eq('batch_id', batchId)
  assertNoError(deleteExceptionsError)

  const { error: deleteRowsError } = await supabase
    .from('pricing_ingestion_rows')
    .delete()
    .eq('batch_id', batchId)
  assertNoError(deleteRowsError)

  const { data: insertedRows, error: rowError } = await supabase
    .from('pricing_ingestion_rows')
    .insert(artifact.proposedRows.map((row) => rowPayload(batchId, row)))
    .select('id, source_row_number')

  assertNoError(rowError)

  const rowIdsBySourceRow = new Map<number, string>()
  for (const row of (insertedRows ?? []) as DbRow[]) {
    const sourceRow = Number(row.source_row_number)
    if (Number.isFinite(sourceRow)) rowIdsBySourceRow.set(sourceRow, String(row.id))
  }

  if (artifact.exceptions.length > 0) {
    const { error: exceptionError } = await supabase
      .from('pricing_ingestion_exceptions')
      .insert(artifact.exceptions.map((exception) => exceptionPayload(batchId, exception, rowIdsBySourceRow)))
    assertNoError(exceptionError)
  }

  return {
    staged: true,
    batchId,
    dryRunId: artifact.dryRunId,
    rowsInserted: artifact.proposedRows.length,
    exceptionsInserted: artifact.exceptions.length,
    status: String((batchRow as DbRow).status ?? batch.status),
  }
}
