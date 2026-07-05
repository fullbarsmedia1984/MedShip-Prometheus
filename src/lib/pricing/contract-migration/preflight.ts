import 'server-only'

import { readDryRunArtifact } from './artifact-reader'
import { buildMigrationStagePlan } from './planner'
import type { MigrationPreflightResult } from './types'

export async function runContractMigrationPreflight(dryRunPath: string): Promise<MigrationPreflightResult> {
  const artifact = readDryRunArtifact(dryRunPath)
  const plan = buildMigrationStagePlan(artifact)

  return {
    ok: plan.canStage,
    artifact: {
      dryRunId: artifact.dryRunId,
      dryRunPath: artifact.dryRunPath,
    },
    summary: {
      rowsFound: artifact.proposedRows.length,
      validRows: artifact.summary.valid_rows,
      warningRows: artifact.summary.warning_rows,
      blockingRows: artifact.summary.blocking_exception_rows,
      excludedRows: artifact.excludedRows.length,
    },
    plan,
  }
}
