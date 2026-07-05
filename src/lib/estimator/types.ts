// =============================================================================
// Zeus Packaging Estimator — service layer types
// =============================================================================

import type {
  DimsSource,
  ItemAttributes,
  PackResult,
} from '@/lib/packing-engine'

/** Advisory dims pulled from Fishbowl (untrusted until verified). */
export interface AdvisoryDims {
  lengthIn: number | null
  widthIn: number | null
  heightIn: number | null
  weightLb: number | null
}

/** One physical SO line as fetched from Fishbowl. */
export interface SoLineItem {
  partNumber: string
  description: string
  quantity: number
  uom: string | null
  productId: number | null
  fishbowlDims: AdvisoryDims
}

/** A verified dims row from item_dims_verified. */
export interface VerifiedDims {
  id: string
  fishbowlPartNumber: string
  lengthIn: number
  widthIn: number
  heightIn: number
  weightLb: number
  shipsInOwnCarton: boolean
  attributes: ItemAttributes
  source: 'manufacturer_site' | 'physical_measurement' | 'fishbowl_confirmed'
  sourceUrl: string | null
  llmSuggested: boolean
  verifiedBy: string | null
  verifiedAt: string
}

/** SO line joined with its dims resolution for the UI. */
export interface ResolvedLineItem extends SoLineItem {
  dimsSource: DimsSource
  resolved: {
    lengthIn: number
    widthIn: number
    heightIn: number
    weightLb: number
    shipsInOwnCarton: boolean
    attributes: ItemAttributes
  }
  verified: VerifiedDims | null
}

export interface SalesOrderSummary {
  soNumber: string
  status: string | null
  customerName: string | null
  lineItems: ResolvedLineItem[]
  excludedLineCount: number
  confidence: number
}

export interface EstimateRecord {
  id: string
  soNumber: string
  engineVersion: string
  inputSnapshot: unknown
  packPlan: PackResult
  confidenceScore: number
  llmFlags: Array<{ severity: string; message: string }>
  actualBoxesUsed: unknown | null
  createdBy: string | null
  createdAt: string
}
