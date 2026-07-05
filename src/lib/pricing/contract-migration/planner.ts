import 'server-only'

import type { DryRunArtifact, MigrationBatchDraft, MigrationStagePlan } from './types'
import { validateMigrationArtifact } from './validator'

function firstRow(artifact: DryRunArtifact) {
  return artifact.proposedRows[0] ?? null
}

function buildBatchDraft(artifact: DryRunArtifact): MigrationBatchDraft {
  const row = firstRow(artifact)
  const summary = artifact.summary

  return {
    dryRunId: artifact.dryRunId,
    sourceFileName: row?.source_file ?? null,
    sourceFileHash: row?.source_file_hash ?? null,
    profileName: row?.profile_name ?? 'unknown_profile',
    profileVersion: row?.profile_version ?? 'unknown',
    distributorName: row?.distributor_name ?? null,
    distributorId: row?.distributor_id ?? null,
    status: Number(summary.blocking_exception_rows ?? 0) > 0 ? 'needs_review' : 'staged',
    rowCount: Number(summary.proposed_rows ?? artifact.proposedRows.length),
    validRowCount: Number(summary.valid_rows ?? 0),
    warningRowCount: Number(summary.warning_rows ?? 0),
    blockingRowCount: Number(summary.blocking_exception_rows ?? 0),
    summaryJson: {
      rows_scanned: summary.rows_scanned,
      proposed_rows: summary.proposed_rows,
      valid_rows: summary.valid_rows,
      warning_rows: summary.warning_rows,
      blocking_exception_rows: summary.blocking_exception_rows,
      exception_counts: summary.exception_counts ?? {},
      source: 'contract_pricing_dry_run',
    },
  }
}

export function buildMigrationStagePlan(artifact: DryRunArtifact): MigrationStagePlan {
  const validation = validateMigrationArtifact(artifact)
  const rowsBlocked = artifact.proposedRows.filter(
    (row) => row.validation_status === 'blocking' || row.exception_codes.length > 0
  ).length
  const rowsRequiringReview = artifact.proposedRows.filter(
    (row) => row.validation_status === 'warning' && row.exception_codes.length === 0
  ).length

  return {
    dryRunId: artifact.dryRunId,
    batch: buildBatchDraft(artifact),
    rowsEligibleToStage: validation.canStage ? artifact.proposedRows.length : 0,
    rowsBlocked,
    rowsRequiringReview,
    exceptionCounts: artifact.summary.exception_counts ?? {},
    metadataGaps: validation.metadataGaps,
    lineageGaps: validation.lineageGaps,
    duplicateConflictCount: validation.duplicateConflictCount,
    blockingReasons: validation.blockingReasons,
    canStage: validation.canStage,
  }
}
