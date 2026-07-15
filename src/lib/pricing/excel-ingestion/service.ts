import 'server-only'

import { createHash } from 'node:crypto'

import { createAdminClient } from '@/lib/supabase/admin'
import { buildMigrationStagePlan } from '@/lib/pricing/contract-migration'
import { stageMigrationArtifact } from '@/lib/pricing/contract-migration/repository'
import type { DryRunArtifact } from '@/lib/pricing/contract-migration'
import uomAliases from '../../../../pricing_ingestion/reference/uom_aliases.json'
import { discoverWorkbook, extractWorkbookRows, suggestColumnMappings, CANONICAL_FIELDS } from './native-engine.mjs'
import { readWorkbookGrids } from './workbook-reader.mjs'
import type {
  NativeProfileInput,
  NativeProfileRecord,
  WorkbookDiscovery,
  WorkbookDryRunResult,
  WorkbookStageResult,
  WorkbookUploadMetadataInput,
  WorkbookUploadSummary,
} from './types'

type DbRow = Record<string, unknown>

const STORAGE_BUCKET = 'pricing-workbooks'
const MAX_FILE_BYTES = 25 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.xlsx', '.xlsm']

function assertConfigured() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('Supabase service credentials are required for workbook ingestion.')
  }
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

function safeUuid(value?: string | null) {
  const text = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null
}

function nonEmptyText(value?: string | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function isoDateOrNull(value?: string | null) {
  const text = nonEmptyText(value)
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return text
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'distributor'
}

const UPLOAD_SELECT =
  'id, file_name, file_size, distributor_name, contract_number, effective_date, expiration_date, status, profile_id, staged_batch_id, error_message, created_at, updated_at'

export async function listWorkbookUploads(): Promise<WorkbookUploadSummary[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pricing_workbook_uploads')
    .select(UPLOAD_SELECT)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    const message = String((error as { message?: unknown }).message ?? '').toLowerCase()
    if ((error as { code?: string }).code === '42P01' || message.includes('does not exist')) return []
    throw error
  }
  return (data ?? []) as unknown as WorkbookUploadSummary[]
}

export async function getWorkbookUpload(id: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pricing_workbook_uploads')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  assertNoError(error)
  return data as DbRow | null
}

async function updateUpload(id: string, patch: DbRow) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('pricing_workbook_uploads')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  assertNoError(error)
}

function runDiscovery(grids: Awaited<ReturnType<typeof readWorkbookGrids>>): WorkbookDiscovery {
  const discovery = discoverWorkbook(grids)
  return {
    sheets: discovery.sheets.map((sheet) => ({
      ...sheet,
      suggested_mappings: suggestColumnMappings(sheet.headers),
    })),
  }
}

/**
 * Upload a distributor workbook: store it in the private bucket, record
 * required contract metadata, and run deterministic structure discovery.
 */
export async function createWorkbookUpload(input: {
  fileName: string
  fileBytes: Buffer
  metadata: WorkbookUploadMetadataInput
  actorId?: string | null
}): Promise<{ uploadId: string; status: string; discovery: WorkbookDiscovery | null }> {
  assertConfigured()

  const fileName = nonEmptyText(input.fileName)
  if (!fileName) throw new Error('File name is required.')
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new Error('Only .xlsx and .xlsm workbooks are supported.')
  }
  if (input.fileBytes.length === 0 || input.fileBytes.length > MAX_FILE_BYTES) {
    throw new Error('Workbook must be between 1 byte and 25 MB.')
  }

  const distributorName = nonEmptyText(input.metadata.distributorName)
  const contractNumber = nonEmptyText(input.metadata.contractNumber)
  const effectiveDate = isoDateOrNull(input.metadata.effectiveDate)
  if (!distributorName) throw new Error('Distributor name is required.')
  if (!contractNumber) throw new Error('Contract number is required.')
  if (!effectiveDate) throw new Error('Effective date is required (YYYY-MM-DD).')

  const fileHash = createHash('sha256').update(input.fileBytes).digest('hex')
  const supabase = createAdminClient()

  const { data: inserted, error: insertError } = await supabase
    .from('pricing_workbook_uploads')
    .insert({
      file_name: fileName,
      file_size: input.fileBytes.length,
      file_hash: fileHash,
      storage_bucket: STORAGE_BUCKET,
      storage_path: 'pending',
      distributor_name: distributorName,
      contract_number: contractNumber,
      effective_date: effectiveDate,
      expiration_date: isoDateOrNull(input.metadata.expirationDate),
      account_number: nonEmptyText(input.metadata.accountNumber),
      location_scope: nonEmptyText(input.metadata.locationScope),
      notes: nonEmptyText(input.metadata.notes),
      status: 'uploaded',
      created_by: safeUuid(input.actorId),
    })
    .select('id')
    .single()
  assertNoError(insertError)
  const uploadId = String((inserted as DbRow).id)

  const storagePath = `${uploadId}/${fileName}`
  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, input.fileBytes, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true,
    })
  if (storageError) {
    await updateUpload(uploadId, { status: 'failed', error_message: `Storage upload failed: ${storageError.message}` })
    throw new Error(`Storage upload failed: ${storageError.message}`)
  }
  await updateUpload(uploadId, { storage_path: storagePath })

  try {
    const grids = await readWorkbookGrids(input.fileBytes)
    const discovery = runDiscovery(grids)
    await updateUpload(uploadId, { status: 'discovered', discovery_json: discovery, error_message: null })
    return { uploadId, status: 'discovered', discovery }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workbook discovery failed'
    await updateUpload(uploadId, { status: 'failed', error_message: message })
    return { uploadId, status: 'failed', discovery: null }
  }
}

async function downloadWorkbook(upload: DbRow): Promise<Buffer> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(String(upload.storage_bucket ?? STORAGE_BUCKET))
    .download(String(upload.storage_path))
  assertNoError(error)
  if (!data) throw new Error('Workbook file not found in storage.')
  return Buffer.from(await data.arrayBuffer())
}

function validateProfileInput(input: NativeProfileInput) {
  const sheetName = nonEmptyText(input.sheetName)
  if (!sheetName) throw new Error('Profile sheet name is required.')
  const headerRow = Number(input.headerRow)
  if (!Number.isInteger(headerRow) || headerRow < 1) throw new Error('Header row must be a positive integer.')

  const mappings = (input.columnMappings ?? [])
    .map((mapping) => ({
      canonical_field: String(mapping.canonicalField ?? '').trim(),
      column_letter: String(mapping.columnLetter ?? '').trim().toUpperCase(),
      required: Boolean(mapping.required),
    }))
    .filter((mapping) => mapping.canonical_field && mapping.column_letter)

  const invalidField = mappings.find((mapping) => !(CANONICAL_FIELDS as string[]).includes(mapping.canonical_field))
  if (invalidField) throw new Error(`Unknown canonical field: ${invalidField.canonical_field}`)
  if (!mappings.some((mapping) => mapping.canonical_field === 'price')) {
    throw new Error('A price column mapping is required.')
  }
  const letters = mappings.map((mapping) => mapping.column_letter)
  if (new Set(letters).size !== letters.length) {
    throw new Error('Each workbook column may only be mapped once.')
  }

  return { sheetName, headerRow, mappings }
}

/**
 * Save a reviewed native profile for a distributor. Versions auto-increment
 * per profile name; new profiles start at review_required.
 */
export async function saveDistributorProfile(
  uploadId: string,
  input: NativeProfileInput,
  actorId?: string | null
): Promise<NativeProfileRecord> {
  assertConfigured()
  const upload = await getWorkbookUpload(uploadId)
  if (!upload) throw new Error('Upload not found.')

  const { sheetName, headerRow, mappings } = validateProfileInput(input)
  const distributorName = String(upload.distributor_name)
  const profileName = nonEmptyText(input.profileName) ?? `${slugify(distributorName)}_native`

  const supabase = createAdminClient()
  const { data: existing, error: existingError } = await supabase
    .from('pricing_distributor_profiles')
    .select('profile_version')
    .eq('profile_name', profileName)
  assertNoError(existingError)
  const versions = ((existing ?? []) as DbRow[])
    .map((row) => String(row.profile_version))
    .map((version) => version.split('.').map((part) => Number(part) || 0))
  const maxPatch = versions
    .filter((parts) => parts[0] === 1 && parts[1] === 0)
    .reduce((max, parts) => Math.max(max, parts[2] ?? 0), -1)
  const profileVersion = `1.0.${maxPatch + 1}`

  const profileJson = {
    schema: 'native_v1',
    profile_name: profileName,
    profile_version: profileVersion,
    distributor_name: distributorName,
    sheet_name: sheetName,
    header_row: headerRow,
    data_start_row: input.dataStartRow ? Number(input.dataStartRow) : headerRow + 1,
    stop_after_blank_rows: 5,
    column_mappings: mappings,
    defaults: {
      currency: 'USD',
      ...(nonEmptyText(input.defaultPriceUom) ? { raw_price_uom: String(input.defaultPriceUom).toUpperCase() } : {}),
    },
  }

  const { data, error } = await supabase
    .from('pricing_distributor_profiles')
    .insert({
      profile_name: profileName,
      profile_version: profileVersion,
      distributor_name: distributorName,
      status: 'review_required',
      profile_json: profileJson,
      source_upload_id: uploadId,
      created_by: safeUuid(actorId),
    })
    .select('id, profile_name, profile_version, distributor_name, status, profile_json, created_at')
    .single()
  assertNoError(error)

  await updateUpload(uploadId, { profile_id: String((data as DbRow).id) })
  return data as unknown as NativeProfileRecord
}

export async function listDistributorProfiles(distributorName?: string | null): Promise<NativeProfileRecord[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from('pricing_distributor_profiles')
    .select('id, profile_name, profile_version, distributor_name, status, profile_json, created_at')
    .neq('status', 'deprecated')
    .order('created_at', { ascending: false })
    .limit(100)
  if (nonEmptyText(distributorName)) query = query.eq('distributor_name', String(distributorName))
  const { data, error } = await query
  if (error) {
    const message = String((error as { message?: unknown }).message ?? '').toLowerCase()
    if ((error as { code?: string }).code === '42P01' || message.includes('does not exist')) return []
    throw error
  }
  return (data ?? []) as unknown as NativeProfileRecord[]
}

async function buildArtifactForUpload(upload: DbRow, profile: NativeProfileRecord): Promise<{ artifact: DryRunArtifact; excludedRows: number }> {
  const fileBytes = await downloadWorkbook(upload)
  const grids = await readWorkbookGrids(fileBytes)
  const profileJson = profile.profile_json as Record<string, unknown>
  const sheetName = String(profileJson.sheet_name)
  const grid = grids.find((candidate) => candidate.name === sheetName)
  if (!grid) throw new Error(`Sheet "${sheetName}" was not found in the workbook.`)

  const uploadMeta = {
    upload_id: String(upload.id),
    file_name: String(upload.file_name),
    file_hash: String(upload.file_hash),
    distributor_name: String(upload.distributor_name),
    contract_number: String(upload.contract_number),
    effective_date: String(upload.effective_date),
    expiration_date: upload.expiration_date ? String(upload.expiration_date) : null,
    account_number: upload.account_number ? String(upload.account_number) : null,
    location: upload.location_scope ? String(upload.location_scope) : null,
  }

  const extraction = extractWorkbookRows({
    grid,
    profile: profileJson as unknown as Parameters<typeof extractWorkbookRows>[0]['profile'],
    uploadMeta,
    uomAliases,
  })

  const dryRunId = `native_${String(upload.id).slice(0, 8)}_${profile.profile_name}_v${profile.profile_version}`
  const artifact: DryRunArtifact = {
    dryRunId,
    dryRunPath: `storage://${STORAGE_BUCKET}/${String(upload.storage_path)}`,
    summary: extraction.summary,
    proposedRows: extraction.proposedRows,
    exceptions: extraction.exceptions,
    excludedRows: extraction.excludedRows,
  }
  return { artifact, excludedRows: extraction.excludedRows.length }
}

async function getProfileById(profileId: string): Promise<NativeProfileRecord> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pricing_distributor_profiles')
    .select('id, profile_name, profile_version, distributor_name, status, profile_json, created_at')
    .eq('id', profileId)
    .maybeSingle()
  assertNoError(error)
  if (!data) throw new Error('Profile not found.')
  return data as unknown as NativeProfileRecord
}

/**
 * Deterministic dry-run: extract with the profile and report the staging plan
 * without writing any pricing rows. Aggregate-safe output only.
 */
export async function runWorkbookDryRun(uploadId: string, profileId: string): Promise<WorkbookDryRunResult> {
  assertConfigured()
  const upload = await getWorkbookUpload(uploadId)
  if (!upload) throw new Error('Upload not found.')
  const profile = await getProfileById(profileId)

  const { artifact, excludedRows } = await buildArtifactForUpload(upload, profile)
  const plan = buildMigrationStagePlan(artifact)

  const result: WorkbookDryRunResult = {
    uploadId,
    profileId,
    dryRunId: artifact.dryRunId,
    summary: artifact.summary,
    excludedRows,
    canStage: plan.canStage,
    blockingReasons: plan.blockingReasons,
  }

  await updateUpload(uploadId, {
    status: 'dry_run',
    profile_id: profileId,
    last_dry_run_json: {
      dry_run_id: artifact.dryRunId,
      profile_name: profile.profile_name,
      profile_version: profile.profile_version,
      summary: artifact.summary,
      excluded_rows: excludedRows,
      can_stage: plan.canStage,
      blocking_reasons: plan.blockingReasons,
      ran_at: new Date().toISOString(),
    },
    error_message: null,
  })

  return result
}

/**
 * Stage the upload into pricing_ingestion_batches through the existing
 * governed pipeline. Refuses when the plan has blocking reasons.
 */
export async function stageWorkbookUpload(
  uploadId: string,
  profileId: string,
  actorId?: string | null
): Promise<WorkbookStageResult> {
  assertConfigured()
  const upload = await getWorkbookUpload(uploadId)
  if (!upload) throw new Error('Upload not found.')
  const profile = await getProfileById(profileId)

  const { artifact } = await buildArtifactForUpload(upload, profile)
  const plan = buildMigrationStagePlan(artifact)
  if (!plan.canStage) {
    throw new Error(
      `Dry run has blocking reasons and cannot stage: ${plan.blockingReasons.map((reason) => reason.code).join(', ')}`
    )
  }

  const staged = await stageMigrationArtifact(artifact, plan.batch, safeUuid(actorId))
  await updateUpload(uploadId, {
    status: 'staged',
    profile_id: profileId,
    staged_batch_id: staged.batchId ?? null,
    error_message: null,
  })

  return {
    uploadId,
    batchId: String(staged.batchId),
    dryRunId: staged.dryRunId,
    rowsInserted: staged.rowsInserted,
    exceptionsInserted: staged.exceptionsInserted,
    batchStatus: staged.status,
  }
}
