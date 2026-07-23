import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  BatchItemMatchStats,
  ItemMatchReviewInput,
  ItemMatchReviewResult,
  ItemMatchStatus,
  ItemMatchSuggestion,
  ItemMatchTargetType,
  ItemSpineSyncResult,
  MatchSuggestionRunResult,
} from './types'

type DbRow = Record<string, unknown>

function assertConfigured() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('Supabase service credentials are required for item matching actions.')
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

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Seed/refresh the internal item spine (pricing_products + product_crosswalk)
 * from the Fishbowl part master cached in inventory_snapshot. Idempotent.
 */
export async function syncItemSpineFromInventory(): Promise<ItemSpineSyncResult> {
  assertConfigured()
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('pricing_sync_products_from_inventory')
  assertNoError(error)
  const summary = (data ?? {}) as DbRow
  return {
    productsInserted: toNumber(summary.products_inserted),
    productsUpdated: toNumber(summary.products_updated),
    crosswalkInserted: toNumber(summary.crosswalk_inserted),
  }
}

/**
 * Generate deterministic suggest-only item matches for one batch's cost lines.
 * Never links items itself — suggestions must be approved by a reviewer.
 */
export async function generateItemMatchSuggestions(batchId: string): Promise<MatchSuggestionRunResult> {
  assertConfigured()
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('pricing_suggest_cost_line_item_matches', {
    p_batch_id: batchId,
  })
  assertNoError(error)
  const summary = (data ?? {}) as DbRow
  const byMatcher: Record<string, number> = {}
  for (const [key, value] of Object.entries(summary)) {
    if (key !== 'total_suggestions') byMatcher[key] = toNumber(value)
  }
  return {
    batchId,
    totalSuggestions: toNumber(summary.total_suggestions),
    byMatcher,
  }
}

async function batchCostLineIds(batchId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('supplier_contract_cost_lines')
    .select('id, source_row_number, distributor_sku, manufacturer_part_number, model_number, gtin, item_description_raw, internal_item_id, hercules_catalog_item_id')
    .eq('source_batch_id', batchId)
  assertNoError(error)
  return (data ?? []) as DbRow[]
}

function costLineIdentifier(line: DbRow) {
  for (const field of ['distributor_sku', 'manufacturer_part_number', 'model_number', 'gtin']) {
    const value = String(line[field] ?? '').trim()
    if (value) return value
  }
  return null
}

export async function listItemMatchSuggestions(batchId: string): Promise<ItemMatchSuggestion[]> {
  const supabase = createAdminClient()
  const lines = await batchCostLineIds(batchId)
  if (lines.length === 0) return []
  const lineById = new Map(lines.map((line) => [String(line.id), line]))

  const { data, error } = await supabase
    .from('supplier_cost_line_item_matches')
    .select('id, cost_line_id, target_type, pricing_product_id, hercules_catalog_item_id, match_method, match_confidence, matched_identifier_field, status, reviewed_at, created_at')
    .in('cost_line_id', [...lineById.keys()])
    .order('created_at', { ascending: true })
  if (error) {
    const message = String((error as { message?: unknown }).message ?? '').toLowerCase()
    if ((error as { code?: string }).code === '42P01' || message.includes('does not exist')) return []
    throw error
  }
  const matches = (data ?? []) as DbRow[]
  if (matches.length === 0) return []

  const productIds = [...new Set(matches.map((m) => String(m.pricing_product_id ?? '')).filter(Boolean))]
  const herculesIds = [...new Set(matches.map((m) => String(m.hercules_catalog_item_id ?? '')).filter(Boolean))]

  const productById = new Map<string, DbRow>()
  if (productIds.length > 0) {
    const { data: products, error: productError } = await supabase
      .from('pricing_products')
      .select('id, name, manufacturer, zeus_product_id')
      .in('id', productIds)
    assertNoError(productError)
    for (const product of (products ?? []) as DbRow[]) productById.set(String(product.id), product)
  }

  const herculesById = new Map<string, DbRow>()
  if (herculesIds.length > 0) {
    const { data: items, error: herculesError } = await supabase
      .from('hercules_catalog_items')
      .select('id, description, manufacturer_name, manufacturer_part_number, brand, category')
      .in('id', herculesIds)
    assertNoError(herculesError)
    for (const item of (items ?? []) as DbRow[]) herculesById.set(String(item.id), item)
  }

  return matches.map((match) => {
    const line = lineById.get(String(match.cost_line_id))
    const product = productById.get(String(match.pricing_product_id ?? ''))
    const hercules = herculesById.get(String(match.hercules_catalog_item_id ?? ''))
    const matchedField = match.matched_identifier_field ? String(match.matched_identifier_field) : null
    const matchedValue = line && matchedField && line[matchedField] ? String(line[matchedField]) : null
    return {
      id: String(match.id),
      cost_line_id: String(match.cost_line_id),
      target_type: match.target_type as ItemMatchTargetType,
      pricing_product_id: match.pricing_product_id ? String(match.pricing_product_id) : null,
      hercules_catalog_item_id: match.hercules_catalog_item_id ? String(match.hercules_catalog_item_id) : null,
      match_method: match.match_method as ItemMatchSuggestion['match_method'],
      match_confidence: match.match_confidence === null ? null : Number(match.match_confidence),
      matched_identifier_field: match.matched_identifier_field ? String(match.matched_identifier_field) : null,
      status: match.status as ItemMatchStatus,
      reviewed_at: match.reviewed_at ? String(match.reviewed_at) : null,
      created_at: String(match.created_at),
      cost_line_source_row_number: line ? (line.source_row_number === null ? null : Number(line.source_row_number)) : null,
      cost_line_identifier: line ? costLineIdentifier(line) : null,
      cost_line_description: line && line.item_description_raw ? String(line.item_description_raw) : null,
      matched_value: matchedValue,
      target_label: product
        ? String(product.name ?? product.zeus_product_id ?? '')
        : hercules
          ? String(hercules.description ?? '')
          : null,
      target_manufacturer: product
        ? (product.manufacturer ? String(product.manufacturer) : null)
        : hercules
          ? (hercules.manufacturer_name ? String(hercules.manufacturer_name) : null)
          : null,
      target_part_number: hercules && hercules.manufacturer_part_number
        ? String(hercules.manufacturer_part_number)
        : product
          ? String(product.zeus_product_id ?? '') || null
          : null,
      target_category: hercules && hercules.category ? String(hercules.category) : null,
    }
  })
}

export async function getBatchItemMatchStats(batchId: string): Promise<BatchItemMatchStats> {
  const lines = await batchCostLineIds(batchId)
  const suggestions = await listItemMatchSuggestions(batchId)
  return {
    batchId,
    costLines: lines.length,
    linkedToInternalItem: lines.filter((line) => line.internal_item_id).length,
    linkedToHerculesItem: lines.filter((line) => line.hercules_catalog_item_id).length,
    openSuggestions: suggestions.filter((match) => match.status === 'suggested').length,
    approvedMatches: suggestions.filter((match) => match.status === 'approved').length,
    rejectedMatches: suggestions.filter((match) => match.status === 'rejected').length,
  }
}

/**
 * Approve or reject a match suggestion. Approval links the cost line to the
 * target (internal_item_id or hercules_catalog_item_id) and supersedes the
 * line's other open suggestions for the same target type.
 */
export async function reviewItemMatchSuggestion(
  matchId: string,
  input: ItemMatchReviewInput
): Promise<ItemMatchReviewResult> {
  assertConfigured()
  if (!['approved', 'rejected'].includes(input.status)) {
    throw new Error('Match review status must be approved or rejected.')
  }

  const supabase = createAdminClient()
  const { data: matchRow, error: matchError } = await supabase
    .from('supplier_cost_line_item_matches')
    .select('id, cost_line_id, target_type, pricing_product_id, hercules_catalog_item_id, status')
    .eq('id', matchId)
    .maybeSingle()
  assertNoError(matchError)
  if (!matchRow) throw new Error('Match suggestion not found.')
  const match = matchRow as DbRow
  if (match.status !== 'suggested') {
    throw new Error(`Only open suggestions can be reviewed (current status: ${String(match.status)}).`)
  }

  const now = new Date().toISOString()
  const reviewerId = safeUuid(input.reviewerId)
  const costLineId = String(match.cost_line_id)
  const targetType = match.target_type as ItemMatchTargetType

  const { error: updateError } = await supabase
    .from('supplier_cost_line_item_matches')
    .update({
      status: input.status,
      reviewed_by: reviewerId,
      reviewed_at: now,
      notes: input.notes ? String(input.notes) : null,
    })
    .eq('id', matchId)
    .eq('status', 'suggested')
  assertNoError(updateError)

  let linkedInternalItemId: string | null = null
  let linkedHerculesCatalogItemId: string | null = null
  let supersededSiblingSuggestions = 0

  if (input.status === 'approved') {
    if (targetType === 'pricing_product') {
      linkedInternalItemId = String(match.pricing_product_id)
      const { error: linkError } = await supabase
        .from('supplier_contract_cost_lines')
        .update({ internal_item_id: linkedInternalItemId })
        .eq('id', costLineId)
      assertNoError(linkError)
    } else {
      linkedHerculesCatalogItemId = String(match.hercules_catalog_item_id)
      const { error: linkError } = await supabase
        .from('supplier_contract_cost_lines')
        .update({ hercules_catalog_item_id: linkedHerculesCatalogItemId })
        .eq('id', costLineId)
      assertNoError(linkError)
    }

    const { data: superseded, error: supersedeError } = await supabase
      .from('supplier_cost_line_item_matches')
      .update({ status: 'superseded', reviewed_by: reviewerId, reviewed_at: now })
      .eq('cost_line_id', costLineId)
      .eq('target_type', targetType)
      .eq('status', 'suggested')
      .neq('id', matchId)
      .select('id')
    assertNoError(supersedeError)
    supersededSiblingSuggestions = (superseded ?? []).length
  }

  return {
    matchId,
    costLineId,
    status: input.status,
    targetType,
    linkedInternalItemId,
    linkedHerculesCatalogItemId,
    supersededSiblingSuggestions,
  }
}
