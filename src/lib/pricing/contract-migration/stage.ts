import 'server-only'

import { readDryRunArtifact } from './artifact-reader'
import { buildMigrationStagePlan } from './planner'
import { stageMigrationArtifact } from './repository'
import type { MigrationStageResult } from './types'

export async function stageContractMigrationDryRun(
  dryRunPath: string,
  createdBy?: string | null
): Promise<MigrationStageResult> {
  const artifact = readDryRunArtifact(dryRunPath)
  const plan = buildMigrationStagePlan(artifact)

  if (!plan.canStage) {
    throw new Error(
      `Dry-run cannot be staged. Blocking reason(s): ${plan.blockingReasons
        .map((reason) => reason.code)
        .join(', ')}`
    )
  }

  return stageMigrationArtifact(artifact, plan.batch, createdBy)
}
