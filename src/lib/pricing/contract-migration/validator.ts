import 'server-only'

import type { DryRunArtifact, MigrationBlockingReason, ProposedPricingRow } from './types'

const REQUIRED_METADATA_FIELDS = ['contract_number', 'effective_date']

function hasLineage(row: ProposedPricingRow) {
  return Boolean(
    row.source_file &&
      row.source_file_hash &&
      row.source_sheet_name &&
      row.source_row_number &&
      Object.keys(row.source_column_map).length > 0 &&
      Object.keys(row.source_cell_map).length > 0
  )
}

function hasRequiredMetadata(row: ProposedPricingRow) {
  return REQUIRED_METADATA_FIELDS.every((field) => {
    const value = row.canonical_row[field]
    return value !== null && value !== undefined && String(value).trim() !== ''
  })
}

function hasPriceUom(row: ProposedPricingRow) {
  const raw = row.canonical_row.raw_price_uom ?? row.canonical_row.raw_uom
  const normalized = row.canonical_row.normalized_price_uom ?? row.canonical_row.normalized_uom
  return Boolean(raw && normalized)
}

function duplicateKey(row: ProposedPricingRow) {
  return [
    row.canonical_row.distributor_sku,
    row.canonical_row.manufacturer_part_number,
    row.canonical_row.model_number,
    row.canonical_row.gtin,
    row.canonical_row.normalized_price_uom ?? row.canonical_row.normalized_uom,
    row.canonical_row.minimum_quantity,
    row.canonical_row.effective_date,
  ]
    .map((value) => String(value ?? '').trim().toUpperCase())
    .join('|')
}

function costValue(row: ProposedPricingRow) {
  return String(row.canonical_row.price ?? row.canonical_row.raw_price ?? '').trim()
}

function countReason(reasons: Map<string, MigrationBlockingReason>, code: string, message: string) {
  const current = reasons.get(code)
  if (current) {
    current.count += 1
    return
  }
  reasons.set(code, { code, count: 1, message })
}

export function validateMigrationArtifact(artifact: DryRunArtifact) {
  const reasons = new Map<string, MigrationBlockingReason>()
  const seenCosts = new Map<string, string>()
  let lineageGaps = 0
  let metadataGaps = 0
  let duplicateConflictCount = 0
  let missingPriceUomCount = 0

  for (const row of artifact.proposedRows) {
    if (row.validation_status === 'blocking' || row.exception_codes.length > 0) {
      countReason(reasons, 'ROW_HAS_BLOCKING_EXCEPTIONS', 'One or more rows still have blocking dry-run exceptions.')
    }

    if (!hasLineage(row)) {
      lineageGaps += 1
      countReason(reasons, 'MISSING_SOURCE_LINEAGE', 'One or more rows are missing source workbook lineage.')
    }

    if (!hasRequiredMetadata(row)) {
      metadataGaps += 1
      countReason(reasons, 'MISSING_REQUIRED_METADATA', 'One or more rows are missing required contract metadata.')
    }

    if (!hasPriceUom(row)) {
      missingPriceUomCount += 1
      countReason(reasons, 'MISSING_PRICE_UOM', 'One or more rows are missing the approved price UOM.')
    }

    const key = duplicateKey(row)
    const cost = costValue(row)
    if (key.replace(/\|/g, '') && cost) {
      const prior = seenCosts.get(key)
      if (prior && prior !== cost) {
        duplicateConflictCount += 1
        countReason(reasons, 'DUPLICATE_CONFLICTING_COST', 'Duplicate cost keys have conflicting cost values.')
      }
      seenCosts.set(key, cost)
    }
  }

  return {
    blockingReasons: [...reasons.values()],
    metadataGaps,
    lineageGaps,
    duplicateConflictCount,
    missingPriceUomCount,
    canStage: reasons.size === 0,
  }
}
