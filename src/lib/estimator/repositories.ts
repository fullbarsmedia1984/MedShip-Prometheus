// =============================================================================
// Zeus Packaging Estimator — Supabase repositories
// standard_boxes, packing_rules, item_dims_verified, estimates
// =============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import {
  DEFAULT_PACKING_RULES,
  normalizeAttributes,
  type BoxSpec,
  type PackingRules,
  type PackResult,
} from '@/lib/packing-engine'
import type { CatalogDims, EstimateRecord, VerifiedDims } from './types'

type BoxRow = {
  id: string
  name: string
  inner_length_in: number
  inner_width_in: number
  inner_height_in: number
  outer_length_in: number
  outer_width_in: number
  outer_height_in: number
  box_weight_lb: number
  max_content_weight_lb: number
  active: boolean
}

function toBoxSpec(row: BoxRow): BoxSpec & { active: boolean } {
  return {
    id: row.id,
    name: row.name,
    innerLengthIn: Number(row.inner_length_in),
    innerWidthIn: Number(row.inner_width_in),
    innerHeightIn: Number(row.inner_height_in),
    outerLengthIn: Number(row.outer_length_in),
    outerWidthIn: Number(row.outer_width_in),
    outerHeightIn: Number(row.outer_height_in),
    boxWeightLb: Number(row.box_weight_lb),
    maxContentWeightLb: Number(row.max_content_weight_lb),
    active: row.active,
  }
}

export async function getStandardBoxes(options?: {
  includeInactive?: boolean
}): Promise<Array<BoxSpec & { active: boolean }>> {
  const supabase = createAdminClient()
  let query = supabase.from('standard_boxes').select('*').order('name')
  if (!options?.includeInactive) {
    query = query.eq('active', true)
  }
  const { data, error } = await query
  if (error) throw new Error(`Failed to load standard boxes: ${error.message}`)
  return (data as BoxRow[]).map(toBoxSpec)
}

export async function upsertStandardBox(
  box: Partial<BoxRow> & { name: string }
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('standard_boxes')
    .upsert({ ...box, updated_at: new Date().toISOString() }, { onConflict: 'name' })
  if (error) throw new Error(`Failed to save box: ${error.message}`)
}

export async function updateStandardBox(
  id: string,
  patch: Partial<Omit<BoxRow, 'id'>>
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('standard_boxes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Failed to update box: ${error.message}`)
}

export async function deleteStandardBox(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('standard_boxes').delete().eq('id', id)
  if (error) throw new Error(`Failed to delete box: ${error.message}`)
}

// -----------------------------------------------------------------------------
// Packing rules
// -----------------------------------------------------------------------------

export async function getPackingRules(): Promise<PackingRules> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('packing_rules')
    .select('rules')
    .eq('key', 'default')
    .maybeSingle()
  if (error) throw new Error(`Failed to load packing rules: ${error.message}`)
  if (!data?.rules) return DEFAULT_PACKING_RULES
  // Deep-merge onto defaults so partial configs never crash the engine.
  const stored = data.rules as Partial<PackingRules>
  return {
    ...DEFAULT_PACKING_RULES,
    ...stored,
    parcel_max: { ...DEFAULT_PACKING_RULES.parcel_max, ...stored.parcel_max },
    ltl_triggers: { ...DEFAULT_PACKING_RULES.ltl_triggers, ...stored.ltl_triggers },
    pallet: { ...DEFAULT_PACKING_RULES.pallet, ...stored.pallet },
  }
}

export async function savePackingRules(
  rules: PackingRules,
  updatedBy: string | null
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('packing_rules').upsert({
    key: 'default',
    rules,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Failed to save packing rules: ${error.message}`)
}

// -----------------------------------------------------------------------------
// Verified dims
// -----------------------------------------------------------------------------

type DimsRow = {
  id: string
  fishbowl_part_number: string
  length_in: number
  width_in: number
  height_in: number
  weight_lb: number
  ships_in_own_carton: boolean
  attributes: Record<string, unknown> | null
  source: VerifiedDims['source']
  source_url: string | null
  llm_suggested: boolean
  verified_by: string | null
  verified_at: string
}

function toVerifiedDims(row: DimsRow): VerifiedDims {
  return {
    id: row.id,
    fishbowlPartNumber: row.fishbowl_part_number,
    lengthIn: Number(row.length_in),
    widthIn: Number(row.width_in),
    heightIn: Number(row.height_in),
    weightLb: Number(row.weight_lb),
    shipsInOwnCarton: row.ships_in_own_carton,
    attributes: normalizeAttributes(row.attributes ?? {}),
    source: row.source,
    sourceUrl: row.source_url,
    llmSuggested: row.llm_suggested,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
  }
}

export async function getVerifiedDimsForParts(
  partNumbers: string[]
): Promise<Map<string, VerifiedDims>> {
  if (partNumbers.length === 0) return new Map()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('item_dims_verified')
    .select('*')
    .in('fishbowl_part_number', partNumbers)
  if (error) throw new Error(`Failed to load verified dims: ${error.message}`)
  return new Map((data as DimsRow[]).map((row) => [row.fishbowl_part_number, toVerifiedDims(row)]))
}

export async function searchVerifiedDims(search?: string): Promise<VerifiedDims[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from('item_dims_verified')
    .select('*')
    .order('verified_at', { ascending: false })
    .limit(200)
  if (search) {
    query = query.ilike('fishbowl_part_number', `%${search}%`)
  }
  const { data, error } = await query
  if (error) throw new Error(`Failed to search verified dims: ${error.message}`)
  return (data as DimsRow[]).map(toVerifiedDims)
}

export async function upsertVerifiedDims(input: {
  fishbowlPartNumber: string
  lengthIn: number
  widthIn: number
  heightIn: number
  weightLb: number
  shipsInOwnCarton: boolean
  attributes: Record<string, unknown>
  source: VerifiedDims['source']
  sourceUrl: string | null
  llmSuggested: boolean
  verifiedBy: string | null
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('item_dims_verified').upsert(
    {
      fishbowl_part_number: input.fishbowlPartNumber,
      length_in: input.lengthIn,
      width_in: input.widthIn,
      height_in: input.heightIn,
      weight_lb: input.weightLb,
      ships_in_own_carton: input.shipsInOwnCarton,
      attributes: normalizeAttributes(input.attributes),
      source: input.source,
      source_url: input.sourceUrl,
      llm_suggested: input.llmSuggested,
      verified_by: input.verifiedBy,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'fishbowl_part_number' }
  )
  if (error) throw new Error(`Failed to save verified dims: ${error.message}`)
}

// -----------------------------------------------------------------------------
// Catalog dims (item_dims_catalog — Hercules/Fishbowl backfill tier)
// -----------------------------------------------------------------------------

type CatalogDimsRow = {
  id: string
  fishbowl_part_number: string
  uom_code: string
  length_in: number
  width_in: number
  height_in: number
  gross_weight_lb: number
  net_weight_lb: number | null
  weight_basis: CatalogDims['weightBasis']
  source_system: CatalogDims['sourceSystem']
  source_vendor: string | null
  gtin: string | null
  match_method: string
  match_confidence: number
}

function toCatalogDims(row: CatalogDimsRow): CatalogDims {
  return {
    id: row.id,
    fishbowlPartNumber: row.fishbowl_part_number,
    uomCode: row.uom_code,
    lengthIn: Number(row.length_in),
    widthIn: Number(row.width_in),
    heightIn: Number(row.height_in),
    grossWeightLb: Number(row.gross_weight_lb),
    netWeightLb: row.net_weight_lb === null ? null : Number(row.net_weight_lb),
    weightBasis: row.weight_basis,
    sourceSystem: row.source_system,
    sourceVendor: row.source_vendor,
    gtin: row.gtin,
    matchMethod: row.match_method,
    matchConfidence: Number(row.match_confidence),
  }
}

/** Case-variant SO parts ("10001cs") resolve to the base part's CS-level row. */
export function catalogLookupCandidates(partNumber: string): Array<{
  partNumber: string
  preferredUom: string | null
}> {
  const candidates: Array<{ partNumber: string; preferredUom: string | null }> = [
    { partNumber, preferredUom: null },
  ]
  const caseVariant = partNumber.match(/^(.*?)cs$/i)
  if (caseVariant && caseVariant[1]) {
    candidates.push({ partNumber: caseVariant[1], preferredUom: 'CS' })
  }
  return candidates
}

/**
 * Load catalog dims for a set of SO part numbers. Each part resolves to at
 * most one row: its own best row (preferring EA, then lowest volume so a
 * mixed-pack match never inflates the estimate), or — for case-variant part
 * numbers — the base part's case-level row.
 */
export async function getCatalogDimsForParts(
  partNumbers: string[]
): Promise<Map<string, CatalogDims>> {
  if (partNumbers.length === 0) return new Map()
  const lookups = new Map<string, ReturnType<typeof catalogLookupCandidates>>()
  for (const pn of partNumbers) lookups.set(pn, catalogLookupCandidates(pn))
  const allKeys = [...new Set([...lookups.values()].flat().map((c) => c.partNumber))]

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('item_dims_catalog')
    .select('*')
    .in('fishbowl_part_number', allKeys)
  if (error) throw new Error(`Failed to load catalog dims: ${error.message}`)

  const rowsByPart = new Map<string, CatalogDimsRow[]>()
  for (const row of (data ?? []) as CatalogDimsRow[]) {
    const list = rowsByPart.get(row.fishbowl_part_number) ?? []
    list.push(row)
    rowsByPart.set(row.fishbowl_part_number, list)
  }

  const pickRow = (
    rows: CatalogDimsRow[],
    preferredUom: string | null
  ): CatalogDimsRow | undefined => {
    if (preferredUom) {
      const match = rows.find((r) => r.uom_code.toUpperCase() === preferredUom)
      if (match) return match
      return undefined // case-variant fallback only trusts an actual CS row
    }
    const ea = rows.find((r) => r.uom_code.toUpperCase() === 'EA')
    if (ea) return ea
    return [...rows].sort(
      (a, b) =>
        Number(a.length_in) * Number(a.width_in) * Number(a.height_in) -
        Number(b.length_in) * Number(b.width_in) * Number(b.height_in)
    )[0]
  }

  const result = new Map<string, CatalogDims>()
  for (const [pn, candidates] of lookups) {
    for (const candidate of candidates) {
      const rows = rowsByPart.get(candidate.partNumber)
      if (!rows || rows.length === 0) continue
      const row = pickRow(rows, candidate.preferredUom)
      if (row) {
        result.set(pn, toCatalogDims(row))
        break
      }
    }
  }
  return result
}

// -----------------------------------------------------------------------------
// Dims work queue (estimator_dims_queue view)
// -----------------------------------------------------------------------------

export interface DimsQueueEntry {
  partNumber: string
  partDescription: string | null
  lineCount12mo: number
  totalQty12mo: number
  lastOrderedAt: string | null
}

/** Highest-velocity parts still missing trusted dims, for manual entry. */
export async function getDimsQueue(limit = 100): Promise<DimsQueueEntry[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('estimator_dims_queue')
    .select('*')
    .order('line_count_12mo', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Failed to load dims queue: ${error.message}`)
  return (data ?? []).map((row) => ({
    partNumber: row.part_number as string,
    partDescription: (row.part_description as string | null) ?? null,
    lineCount12mo: Number(row.line_count_12mo),
    totalQty12mo: Number(row.total_qty_12mo ?? 0),
    lastOrderedAt: (row.last_ordered_at as string | null) ?? null,
  }))
}

// -----------------------------------------------------------------------------
// Estimates
// -----------------------------------------------------------------------------

type EstimateRow = {
  id: string
  so_number: string
  engine_version: string
  input_snapshot: unknown
  pack_plan: PackResult
  confidence_score: number
  llm_flags: Array<{ severity: string; message: string }>
  actual_boxes_used: unknown | null
  created_by: string | null
  created_at: string
}

function toEstimateRecord(row: EstimateRow): EstimateRecord {
  return {
    id: row.id,
    soNumber: row.so_number,
    engineVersion: row.engine_version,
    inputSnapshot: row.input_snapshot,
    packPlan: row.pack_plan,
    confidenceScore: Number(row.confidence_score),
    llmFlags: row.llm_flags ?? [],
    actualBoxesUsed: row.actual_boxes_used,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

export async function insertEstimate(input: {
  soNumber: string
  engineVersion: string
  inputSnapshot: unknown
  packPlan: PackResult
  confidenceScore: number
  llmFlags: Array<{ severity: string; message: string }>
  createdBy: string | null
}): Promise<EstimateRecord> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('estimates')
    .insert({
      so_number: input.soNumber,
      engine_version: input.engineVersion,
      input_snapshot: input.inputSnapshot,
      pack_plan: input.packPlan,
      confidence_score: input.confidenceScore,
      llm_flags: input.llmFlags,
      created_by: input.createdBy,
    })
    .select('*')
    .single()
  if (error) throw new Error(`Failed to save estimate: ${error.message}`)
  return toEstimateRecord(data as EstimateRow)
}

export async function listEstimates(soNumber?: string): Promise<EstimateRecord[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from('estimates')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (soNumber) query = query.eq('so_number', soNumber)
  const { data, error } = await query
  if (error) throw new Error(`Failed to list estimates: ${error.message}`)
  return (data as EstimateRow[]).map(toEstimateRecord)
}

export async function recordActualBoxes(
  estimateId: string,
  actualBoxesUsed: unknown,
  recordedBy: string | null
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('estimates')
    .update({
      actual_boxes_used: actualBoxesUsed,
      actual_recorded_by: recordedBy,
      actual_recorded_at: new Date().toISOString(),
    })
    .eq('id', estimateId)
  if (error) throw new Error(`Failed to record actual boxes: ${error.message}`)
}
