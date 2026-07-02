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
import type { EstimateRecord, VerifiedDims } from './types'

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
