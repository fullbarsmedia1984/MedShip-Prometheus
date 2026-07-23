#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const REQUIRED_FILES = ['dry_run_summary.json', 'proposed_rows.csv', 'exceptions.csv', 'excluded_rows.csv']
const REQUIRED_METADATA_FIELDS = ['contract_number', 'effective_date']

function parseArgs(argv) {
  const [command, ...rest] = argv
  const args = { command }
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (token.startsWith('--')) {
      args[token.slice(2)] = rest[index + 1]
      index += 1
    }
  }
  return args
}

function parseCsv(text) {
  const rows = []
  let row = []
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
    .map((dataRow) => Object.fromEntries(headers.map((header, index) => [header.trim(), dataRow[index] ?? ''])))
}

function parseJsonObject(value) {
  if (!String(value ?? '').trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseJsonArray(value) {
  if (!String(value ?? '').trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return String(value).split(/[;,]/).map((item) => item.trim()).filter(Boolean)
  }
}

function readArtifact(dryRunInput) {
  const dryRunPath = resolve(dryRunInput)
  const missing = REQUIRED_FILES.filter((file) => !existsSync(join(dryRunPath, file)))
  if (missing.length > 0) throw new Error(`Dry-run artifact is missing required file(s): ${missing.join(', ')}`)

  const summary = JSON.parse(readFileSync(join(dryRunPath, 'dry_run_summary.json'), 'utf8'))
  const proposedRows = parseCsv(readFileSync(join(dryRunPath, 'proposed_rows.csv'), 'utf8'))
  const exceptions = parseCsv(readFileSync(join(dryRunPath, 'exceptions.csv'), 'utf8'))
  const excludedRows = parseCsv(readFileSync(join(dryRunPath, 'excluded_rows.csv'), 'utf8'))
  return { dryRunId: basename(dryRunPath), dryRunPath, summary, proposedRows, exceptions, excludedRows }
}

function rowStatus(row) {
  return ['valid', 'warning', 'blocking'].includes(row.validation_status) ? row.validation_status : 'blocking'
}

function hasLineage(row) {
  return Boolean(
    row.source_file &&
      row.source_file_hash &&
      row.source_sheet_name &&
      row.source_row_number &&
      Object.keys(parseJsonObject(row.source_column_map)).length > 0 &&
      Object.keys(parseJsonObject(row.source_cell_map)).length > 0
  )
}

function hasRequiredMetadata(row) {
  return REQUIRED_METADATA_FIELDS.every((field) => String(row[field] ?? '').trim() !== '')
}

function hasPriceUom(row) {
  return Boolean(
    String(row.raw_price_uom || row.raw_uom || '').trim() &&
      String(row.normalized_price_uom || row.normalized_uom || '').trim()
  )
}

function planArtifact(artifact) {
  const reasons = new Map()
  const addReason = (code, message) => {
    const current = reasons.get(code) ?? { code, count: 0, message }
    current.count += 1
    reasons.set(code, current)
  }

  let metadataGaps = 0
  let lineageGaps = 0
  let missingPriceUom = 0
  for (const row of artifact.proposedRows) {
    if (rowStatus(row) === 'blocking' || parseJsonArray(row.exception_codes).length > 0) {
      addReason('ROW_HAS_BLOCKING_EXCEPTIONS', 'One or more rows still have blocking dry-run exceptions.')
    }
    if (!hasLineage(row)) {
      lineageGaps += 1
      addReason('MISSING_SOURCE_LINEAGE', 'One or more rows are missing source workbook lineage.')
    }
    if (!hasRequiredMetadata(row)) {
      metadataGaps += 1
      addReason('MISSING_REQUIRED_METADATA', 'One or more rows are missing required contract metadata.')
    }
    if (!hasPriceUom(row)) {
      missingPriceUom += 1
      addReason('MISSING_PRICE_UOM', 'One or more rows are missing the approved price UOM.')
    }
  }

  const firstRow = artifact.proposedRows[0] ?? {}
  const exceptionCounts = artifact.summary.exception_counts ?? {}
  return {
    dryRunId: artifact.dryRunId,
    rowsFound: artifact.proposedRows.length,
    validRows: artifact.summary.valid_rows ?? 0,
    warningRows: artifact.summary.warning_rows ?? 0,
    blockingRows: artifact.summary.blocking_exception_rows ?? 0,
    excludedRows: artifact.excludedRows.length,
    exceptionCounts,
    metadataGaps,
    lineageGaps,
    missingPriceUom,
    rowsEligibleToStage: reasons.size === 0 ? artifact.proposedRows.length : 0,
    canStage: reasons.size === 0,
    blockingReasons: [...reasons.values()],
    batch: {
      dry_run_id: artifact.dryRunId,
      source_file_name: firstRow.source_file || null,
      source_file_hash: firstRow.source_file_hash || null,
      profile_name: firstRow.profile_name || 'unknown_profile',
      profile_version: firstRow.profile_version || 'unknown',
      distributor_name: firstRow.distributor_name || null,
      distributor_id: firstRow.distributor_id || null,
      status: (artifact.summary.blocking_exception_rows ?? 0) > 0 ? 'needs_review' : 'staged',
      row_count: artifact.summary.proposed_rows ?? artifact.proposedRows.length,
      valid_row_count: artifact.summary.valid_rows ?? 0,
      warning_row_count: artifact.summary.warning_rows ?? 0,
      blocking_row_count: artifact.summary.blocking_exception_rows ?? 0,
      summary_json: {
        rows_scanned: artifact.summary.rows_scanned,
        proposed_rows: artifact.summary.proposed_rows,
        valid_rows: artifact.summary.valid_rows,
        warning_rows: artifact.summary.warning_rows,
        blocking_exception_rows: artifact.summary.blocking_exception_rows,
        exception_counts: exceptionCounts,
        source: 'contract_pricing_dry_run',
      },
    },
  }
}

function safePreflightOutput(plan, dryRunPath) {
  return {
    dryRunPath,
    dryRunId: plan.dryRunId,
    rowsFound: plan.rowsFound,
    validRows: plan.validRows,
    warningRows: plan.warningRows,
    blockingRows: plan.blockingRows,
    excludedRows: plan.excludedRows,
    exceptionCounts: plan.exceptionCounts,
    metadataGaps: plan.metadataGaps,
    lineageGaps: plan.lineageGaps,
    missingPriceUom: plan.missingPriceUom,
    rowsEligibleToStage: plan.rowsEligibleToStage,
    canStage: plan.canStage,
    blockingReasons: plan.blockingReasons,
  }
}

function supabaseClientForStage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service credentials are required for staging.')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function stageArtifact(artifact, plan) {
  if (!plan.canStage) {
    throw new Error(`Dry-run cannot be staged. Blocking reason(s): ${plan.blockingReasons.map((reason) => reason.code).join(', ')}`)
  }

  const supabase = supabaseClientForStage()
  const { data: batch, error: batchError } = await supabase
    .from('pricing_ingestion_batches')
    .upsert(
      {
        ...plan.batch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source_file_hash,dry_run_id,profile_name,profile_version' }
    )
    .select('id, status')
    .single()

  if (batchError) throw new Error(batchError.message)
  const batchId = batch.id

  await supabase.from('pricing_ingestion_exceptions').delete().eq('batch_id', batchId)
  await supabase.from('pricing_ingestion_rows').delete().eq('batch_id', batchId)

  const rowPayloads = artifact.proposedRows.map((row) => ({
    batch_id: batchId,
    row_number: Number(row.source_row_number) || null,
    ingestion_row_id: row.ingestion_row_id,
    validation_status: rowStatus(row),
    exception_codes: parseJsonArray(row.exception_codes),
    warning_codes: parseJsonArray(row.warning_codes),
    canonical_row: row,
    raw_row_reference: {
      source_file_name: row.source_file,
      source_sheet_name: row.source_sheet_name,
      source_row_number: Number(row.source_row_number) || null,
    },
    source_file_name: row.source_file,
    source_file_hash: row.source_file_hash,
    source_sheet_name: row.source_sheet_name,
    source_row_number: Number(row.source_row_number) || null,
    source_column_map: parseJsonObject(row.source_column_map),
    source_cell_map: parseJsonObject(row.source_cell_map),
    formula_fields: parseJsonArray(row.formula_fields),
  }))
  const { data: rows, error: rowError } = await supabase
    .from('pricing_ingestion_rows')
    .insert(rowPayloads)
    .select('id, source_row_number')
  if (rowError) throw new Error(rowError.message)

  const rowIdsBySourceRow = new Map((rows ?? []).map((row) => [Number(row.source_row_number), row.id]))
  if (artifact.exceptions.length > 0) {
    const { error: exceptionError } = await supabase.from('pricing_ingestion_exceptions').insert(
      artifact.exceptions.map((exception) => ({
        batch_id: batchId,
        row_id: rowIdsBySourceRow.get(Number(exception.source_row)) ?? null,
        severity: ['blocking', 'warning', 'info'].includes(exception.severity) ? exception.severity : 'warning',
        exception_code: exception.exception_code,
        canonical_field: exception.canonical_field || null,
        source_sheet_name: exception.source_sheet || null,
        source_row_number: Number(exception.source_row) || null,
        source_cell_reference: exception.source_cell || null,
        message: exception.message || null,
      }))
    )
    if (exceptionError) throw new Error(exceptionError.message)
  }

  return {
    staged: true,
    batchId,
    dryRunId: artifact.dryRunId,
    rowsInserted: artifact.proposedRows.length,
    exceptionsInserted: artifact.exceptions.length,
    status: batch.status,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.command || ['preflight', 'stage'].includes(args.command) && !args['dry-run']) {
    throw new Error('Usage: node scripts/pricing-contract-migration.mjs <preflight|stage> --dry-run <dry-run-dir>')
  }

  if (args.command === 'publish' || args.command === 'rollback') {
    throw new Error(
      `${args.command} is intentionally not implemented in the CLI. Use the authenticated dashboard publish/rollback flow so the action is attributed to a reviewer and audited.`
    )
  }

  if (args.command !== 'preflight' && args.command !== 'stage') {
    throw new Error(`Unknown command: ${args.command}`)
  }

  const artifact = readArtifact(args['dry-run'])
  const plan = planArtifact(artifact)
  if (args.command === 'preflight') {
    console.log(JSON.stringify(safePreflightOutput(plan, artifact.dryRunPath), null, 2))
    return
  }

  const result = await stageArtifact(artifact, plan)
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }, null, 2))
  process.exitCode = 1
})
