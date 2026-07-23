export type ItemSpineSyncResult = {
  productsInserted: number
  productsUpdated: number
  crosswalkInserted: number
}

export type MatchSuggestionRunResult = {
  batchId: string
  totalSuggestions: number
  byMatcher: Record<string, number>
}

export type ItemMatchTargetType = 'pricing_product' | 'hercules_catalog_item'
export type ItemMatchStatus = 'suggested' | 'approved' | 'rejected' | 'superseded'
export type ItemMatchMethod = 'gtin_exact' | 'sku_exact' | 'mpn_exact' | 'model_exact' | 'manual'

export type ItemMatchSuggestion = {
  id: string
  cost_line_id: string
  target_type: ItemMatchTargetType
  pricing_product_id: string | null
  hercules_catalog_item_id: string | null
  match_method: ItemMatchMethod
  match_confidence: number | null
  matched_identifier_field: string | null
  status: ItemMatchStatus
  reviewed_at: string | null
  created_at: string
  // Display context resolved by the repository:
  cost_line_source_row_number: number | null
  cost_line_identifier: string | null
  target_label: string | null
  target_manufacturer: string | null
}

export type ItemMatchReviewInput = {
  status: 'approved' | 'rejected'
  reviewerId?: string | null
  notes?: string | null
}

export type ItemMatchReviewResult = {
  matchId: string
  costLineId: string
  status: ItemMatchStatus
  targetType: ItemMatchTargetType
  linkedInternalItemId: string | null
  linkedHerculesCatalogItemId: string | null
  supersededSiblingSuggestions: number
}

export type BatchItemMatchStats = {
  batchId: string
  costLines: number
  linkedToInternalItem: number
  linkedToHerculesItem: number
  openSuggestions: number
  approvedMatches: number
  rejectedMatches: number
}

export type BatchItemMatchOverview = {
  stats: BatchItemMatchStats
  suggestions: ItemMatchSuggestion[]
}
