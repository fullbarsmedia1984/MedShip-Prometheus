// =============================================================================
// Zeus Packaging Estimator — estimate orchestration
// Joins SO lines with verified dims, runs the deterministic engine, applies
// the LLM review pass (flags only — never mutates numbers), and persists the
// estimate with a full input snapshot for reproducibility.
// =============================================================================

import {
  computeConfidence,
  packItems,
  ENGINE_VERSION,
  CONSERVATIVE_ATTRIBUTES,
  type PackableItem,
} from '@/lib/packing-engine'
import { getEstimatorLlmProvider } from '@/lib/llm'
import {
  getCatalogDimsForParts,
  getPackingRules,
  getStandardBoxes,
  getVerifiedDimsForParts,
  insertEstimate,
} from './repositories'
import { fetchSalesOrderForEstimate } from './so-service'
import type {
  CatalogDims,
  EstimateRecord,
  ResolvedLineItem,
  SalesOrderSummary,
  SoLineItem,
  VerifiedDims,
} from './types'

/**
 * Placeholder dims for items with no verified row and no usable Fishbowl dims.
 * Deliberately mid-sized so missing data inflates rather than shrinks the
 * estimate; the low confidence score surfaces the gap to the rep.
 */
const PLACEHOLDER_DIMS = { lengthIn: 12, widthIn: 10, heightIn: 8, weightLb: 5 }

function resolveLine(
  line: SoLineItem,
  verified: VerifiedDims | undefined,
  catalog: CatalogDims | undefined
): ResolvedLineItem {
  if (verified) {
    return {
      ...line,
      dimsSource: 'verified',
      resolved: {
        lengthIn: verified.lengthIn,
        widthIn: verified.widthIn,
        heightIn: verified.heightIn,
        weightLb: verified.weightLb,
        shipsInOwnCarton: verified.shipsInOwnCarton,
        attributes: verified.attributes,
      },
      verified,
      catalog: catalog ?? null,
    }
  }

  if (catalog) {
    return {
      ...line,
      // Fishbowl-product-sourced rows keep advisory-tier trust: their
      // granularity is inconsistent, so only Hercules vendor data earns the
      // catalog confidence discount.
      dimsSource: catalog.sourceSystem === 'hercules' ? 'catalog' : 'fishbowl',
      resolved: {
        lengthIn: catalog.lengthIn,
        widthIn: catalog.widthIn,
        heightIn: catalog.heightIn,
        // Packing uses shipping weight; catalog gross is the best available.
        weightLb: catalog.grossWeightLb,
        shipsInOwnCarton: false,
        attributes: { ...CONSERVATIVE_ATTRIBUTES },
      },
      verified: null,
      catalog,
    }
  }

  const fb = line.fishbowlDims
  const hasFishbowlDims =
    fb.lengthIn !== null &&
    fb.widthIn !== null &&
    fb.heightIn !== null &&
    fb.weightLb !== null &&
    fb.lengthIn > 0 &&
    fb.widthIn > 0 &&
    fb.heightIn > 0

  if (hasFishbowlDims) {
    return {
      ...line,
      dimsSource: 'fishbowl',
      resolved: {
        lengthIn: fb.lengthIn as number,
        widthIn: fb.widthIn as number,
        heightIn: fb.heightIn as number,
        weightLb: (fb.weightLb as number) || 1,
        shipsInOwnCarton: false,
        attributes: { ...CONSERVATIVE_ATTRIBUTES },
      },
      verified: null,
      catalog: null,
    }
  }

  return {
    ...line,
    dimsSource: 'default',
    resolved: {
      ...PLACEHOLDER_DIMS,
      shipsInOwnCarton: false,
      attributes: { ...CONSERVATIVE_ATTRIBUTES },
    },
    verified: null,
    catalog: null,
  }
}

function toPackableItems(lines: ResolvedLineItem[]): PackableItem[] {
  return lines.map((line) => ({
    partNumber: line.partNumber,
    description: line.description,
    quantity: line.quantity,
    lengthIn: line.resolved.lengthIn,
    widthIn: line.resolved.widthIn,
    heightIn: line.resolved.heightIn,
    weightLb: line.resolved.weightLb,
    shipsInOwnCarton: line.resolved.shipsInOwnCarton,
    attributes: line.resolved.attributes,
    dimsSource: line.dimsSource,
  }))
}

/** Fetch an SO and resolve every line against the verified dims layer. */
export async function getSalesOrderSummary(soNumber: string): Promise<SalesOrderSummary> {
  const so = await fetchSalesOrderForEstimate(soNumber)
  const partNumbers = so.lineItems.map((l) => l.partNumber)
  const [verifiedByPart, catalogByPart] = await Promise.all([
    getVerifiedDimsForParts(partNumbers),
    getCatalogDimsForParts(
      so.lineItems.map((l) => ({
        partNumber: l.partNumber,
        resolvedPartNumber: l.resolvedPartNumber,
      }))
    ),
  ])
  const lineItems = so.lineItems.map((line) =>
    resolveLine(line, verifiedByPart.get(line.partNumber), catalogByPart.get(line.partNumber))
  )
  return {
    soNumber: so.soNumber,
    status: so.status,
    customerName: so.customerName,
    lineItems,
    excludedLineCount: so.excludedLineCount,
    confidence: computeConfidence(toPackableItems(lineItems)),
  }
}

/**
 * Generate and persist an estimate for an SO. Re-fetches the SO so the
 * persisted input snapshot reflects the exact state that was packed.
 */
export async function generateEstimate(
  soNumber: string,
  createdBy: string | null
): Promise<{ estimate: EstimateRecord; summary: SalesOrderSummary }> {
  const summary = await getSalesOrderSummary(soNumber)
  if (summary.lineItems.length === 0) {
    throw new Error(`${soNumber} has no physical line items to pack`)
  }

  const [boxes, rules] = await Promise.all([getStandardBoxes(), getPackingRules()])
  const items = toPackableItems(summary.lineItems)
  const packPlan = packItems(items, boxes, rules)

  // LLM anomaly review: display-only flags, never blocks, never mutates.
  const llm = getEstimatorLlmProvider()
  const llmFlags = llm.available
    ? await llm.reviewPackPlan(
        packPlan,
        summary.lineItems.map((l) => ({ partNumber: l.partNumber, description: l.description }))
      )
    : []

  const estimate = await insertEstimate({
    soNumber: summary.soNumber,
    engineVersion: ENGINE_VERSION,
    inputSnapshot: {
      lineItems: summary.lineItems,
      boxes,
      rules,
      excludedLineCount: summary.excludedLineCount,
    },
    packPlan,
    confidenceScore: summary.confidence,
    llmFlags,
    createdBy,
  })

  return { estimate, summary }
}
