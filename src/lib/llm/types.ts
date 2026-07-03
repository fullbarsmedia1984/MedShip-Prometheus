// =============================================================================
// Zeus Packaging Estimator — LLM assist layer contracts
// The LLM never does packing math. It only classifies attributes, suggests
// dims (human-confirmed), and flags anomalies (display-only warnings).
// =============================================================================

import type { ItemAttributes, PackResult } from '@/lib/packing-engine'

export interface ItemToClassify {
  partNumber: string
  description: string
}

export interface AttributeClassification {
  partNumber: string
  attributes: ItemAttributes
  /** 0–1; below the configured threshold the caller applies conservative defaults. */
  confidence: number
  rationale: string
}

export interface DimSuggestion {
  lengthIn: number
  widthIn: number
  heightIn: number
  weightLb: number
  attributes: ItemAttributes
  shipsInOwnCarton: boolean
  confidence: number
  sourceUrl: string | null
  rationale: string
}

export interface PackPlanFlag {
  severity: 'info' | 'warning'
  message: string
}

export type LlmPurpose = 'classify_attributes' | 'suggest_dimensions' | 'review_pack_plan'

export interface LlmCallRecord {
  purpose: LlmPurpose
  provider: string
  model: string
  promptHash: string
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  success: boolean
  error: string | null
  result: unknown
}

export type LlmCallLogger = (record: LlmCallRecord) => Promise<void>

export interface EstimatorLlmProvider {
  readonly name: string
  readonly available: boolean
  classifyItemAttributes(items: ItemToClassify[]): Promise<AttributeClassification[]>
  suggestDimensions(item: ItemToClassify): Promise<DimSuggestion | null>
  reviewPackPlan(plan: PackResult, items: ItemToClassify[]): Promise<PackPlanFlag[]>
}
