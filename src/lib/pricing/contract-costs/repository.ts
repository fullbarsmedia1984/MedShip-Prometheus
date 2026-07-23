import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeUom } from '../excel-ingestion/native-engine.mjs'
import uomAliases from '../../../../pricing_ingestion/reference/uom_aliases.json'
import type {
  ContractCostLine,
  CostLineMutationResult,
  CostLineStatusFilter,
  CostLineUpdateInput,
  ManualCostLineInput,
  SupplierContractSummary,
} from './types'

type DbRow = Record<string, unknown>

const COST_LINE_SELECT =
  'id, supplier_contract_id, distributor_sku, manufacturer_name, manufacturer_part_number, model_number, gtin, item_description_raw, cost, currency, raw_price_uom, normalized_price_uom, pack_size, tier, minimum_quantity, effective_date, expiration_date, active, approval_status, internal_item_id, hercules_catalog_item_id, supersedes_cost_line_id, source_batch_id, source_file_name, source_sheet_name, source_row_number, created_at, approved_at'

function assertConfigured() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('Supabase service credentials are required for contract cost actions.')
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

function missingRelation(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; message?: string }
  const message = candidate.message?.toLowerCase() ?? ''
  return candidate.code === '42P01' || candidate.code === 'PGRST205' || message.includes('does not exist')
}

function safeUuid(value?: string | null) {
  const text = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null
}

function nonEmptyText(value?: string | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function isoDateOrNull(value?: string | null) {
  const text = nonEmptyText(value)
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return text
}

function positiveNumberOrNull(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

async function logManualEvent(
  action: CostLineMutationResult['action'],
  actorId: string | null,
  summary: Record<string, unknown>,
  notes?: string | null
) {
  const supabase = createAdminClient()
  const { error } = await supabase.from('pricing_publish_events').insert({
    batch_id: null,
    action,
    actor_id: actorId,
    status: 'applied',
    summary_json: { ...summary, customer_sell_pricing_touched: false },
    notes: nonEmptyText(notes),
  })
  assertNoError(error)
}

export async function listSupplierContracts(): Promise<SupplierContractSummary[]> {
  const supabase = createAdminClient()
  const { data: contracts, error } = await supabase
    .from('supplier_contracts')
    .select('id, supplier_name, contract_name, contract_number, status, effective_date, expiration_date, updated_at')
    .order('supplier_name')
    .limit(200)
  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  const contractRows = (contracts ?? []) as DbRow[]
  if (contractRows.length === 0) return []

  const { data: lines, error: lineError } = await supabase
    .from('supplier_contract_cost_lines')
    .select('supplier_contract_id, active, approval_status')
    .in('supplier_contract_id', contractRows.map((row) => String(row.id)))
  assertNoError(lineError)

  const activeCounts = new Map<string, number>()
  const pendingCounts = new Map<string, number>()
  for (const line of (lines ?? []) as DbRow[]) {
    const contractId = String(line.supplier_contract_id ?? '')
    if (!contractId) continue
    if (line.active) activeCounts.set(contractId, (activeCounts.get(contractId) ?? 0) + 1)
    if (line.approval_status === 'pending') pendingCounts.set(contractId, (pendingCounts.get(contractId) ?? 0) + 1)
  }

  return contractRows.map((row) => ({
    id: String(row.id),
    supplier_name: String(row.supplier_name),
    contract_name: row.contract_name ? String(row.contract_name) : null,
    contract_number: row.contract_number ? String(row.contract_number) : null,
    status: String(row.status),
    effective_date: row.effective_date ? String(row.effective_date) : null,
    expiration_date: row.expiration_date ? String(row.expiration_date) : null,
    updated_at: String(row.updated_at),
    active_line_count: activeCounts.get(String(row.id)) ?? 0,
    pending_line_count: pendingCounts.get(String(row.id)) ?? 0,
  }))
}

export async function getSupplierContract(id: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('supplier_contracts')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  assertNoError(error)
  return data as DbRow | null
}

export async function listContractCostLines(
  contractId: string,
  statusFilter: CostLineStatusFilter = 'active'
): Promise<ContractCostLine[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from('supplier_contract_cost_lines')
    .select(COST_LINE_SELECT)
    .eq('supplier_contract_id', contractId)

  if (statusFilter === 'active') query = query.eq('active', true).eq('approval_status', 'approved')
  else if (statusFilter !== 'all') query = query.eq('approval_status', statusFilter)

  const { data, error } = await query
    .order('item_description_raw', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  return (data ?? []) as unknown as ContractCostLine[]
}

function uomFields(priceUom: string) {
  const raw = String(priceUom).trim().toUpperCase()
  const { normalized } = normalizeUom(raw, uomAliases)
  return { raw_price_uom: raw, normalized_price_uom: normalized ?? raw }
}

/**
 * Add a manually negotiated cost line (no workbook). Active immediately —
 * the actor is the approver — and audited as manual_line_create.
 */
export async function createManualCostLine(
  contractId: string,
  input: ManualCostLineInput,
  actorId?: string | null
): Promise<CostLineMutationResult> {
  assertConfigured()
  const contract = await getSupplierContract(contractId)
  if (!contract) throw new Error('Supplier contract not found.')

  const cost = positiveNumberOrNull(input.cost)
  if (cost === null) throw new Error('Cost must be a number greater than or equal to zero.')
  const priceUom = nonEmptyText(input.priceUom)
  if (!priceUom) throw new Error('Price UOM is required (e.g. EA).')
  const identifiers = [input.distributorSku, input.manufacturerPartNumber, input.modelNumber, input.gtin]
  if (!identifiers.some((value) => nonEmptyText(value))) {
    throw new Error('At least one item identifier is required (SKU, MPN, model, or GTIN).')
  }

  const now = new Date().toISOString()
  const actor = safeUuid(actorId)
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('supplier_contract_cost_lines')
    .insert({
      supplier_contract_id: contractId,
      supplier_name: String(contract.supplier_name),
      distributor_sku: nonEmptyText(input.distributorSku),
      manufacturer_name: nonEmptyText(input.manufacturerName),
      manufacturer_part_number: nonEmptyText(input.manufacturerPartNumber),
      model_number: nonEmptyText(input.modelNumber),
      gtin: nonEmptyText(input.gtin),
      item_description_raw: nonEmptyText(input.itemDescription),
      raw_price: cost,
      cost,
      currency: nonEmptyText(input.currency) ?? 'USD',
      ...uomFields(priceUom),
      pack_size: input.packSize === null || input.packSize === undefined ? null : positiveNumberOrNull(input.packSize),
      tier: nonEmptyText(input.tier),
      minimum_quantity:
        input.minimumQuantity === null || input.minimumQuantity === undefined
          ? null
          : positiveNumberOrNull(input.minimumQuantity),
      effective_date: isoDateOrNull(input.effectiveDate) ?? now.slice(0, 10),
      expiration_date: isoDateOrNull(input.expirationDate),
      active: true,
      approval_status: 'approved',
      created_by: actor,
      approved_at: now,
      approved_by: actor,
    })
    .select('id')
    .single()
  assertNoError(error)
  const costLineId = String((data as DbRow).id)

  await logManualEvent(
    'manual_line_create',
    actor,
    { cost_line_id: costLineId, supplier_contract_id: contractId },
    input.notes
  )

  return { costLineId, supplierContractId: contractId, action: 'manual_line_create', supersededCostLineId: null }
}

/**
 * Update a cost line by superseding it: history is never mutated. The new
 * line copies the old one, applies the changes, and records the linkage.
 */
export async function updateCostLine(
  costLineId: string,
  input: CostLineUpdateInput,
  actorId?: string | null
): Promise<CostLineMutationResult> {
  assertConfigured()
  const supabase = createAdminClient()
  const { data: existing, error: fetchError } = await supabase
    .from('supplier_contract_cost_lines')
    .select('*')
    .eq('id', costLineId)
    .maybeSingle()
  assertNoError(fetchError)
  if (!existing) throw new Error('Cost line not found.')
  const line = existing as DbRow
  if (!line.active || line.approval_status !== 'approved') {
    throw new Error('Only active approved cost lines can be updated.')
  }
  const contractId = safeUuid(String(line.supplier_contract_id ?? ''))
  if (!contractId) throw new Error('Cost line has no supplier contract.')

  const changedFields: string[] = []
  const overrides: DbRow = {}

  if (input.cost !== null && input.cost !== undefined) {
    const cost = positiveNumberOrNull(input.cost)
    if (cost === null) throw new Error('Cost must be a number greater than or equal to zero.')
    overrides.cost = cost
    overrides.raw_price = cost
    changedFields.push('cost')
  }
  if (nonEmptyText(input.priceUom)) {
    Object.assign(overrides, uomFields(String(input.priceUom)))
    changedFields.push('price_uom')
  }
  if (input.itemDescription !== undefined && input.itemDescription !== null) {
    overrides.item_description_raw = nonEmptyText(input.itemDescription)
    changedFields.push('description')
  }
  if (input.effectiveDate !== undefined && input.effectiveDate !== null) {
    overrides.effective_date = isoDateOrNull(input.effectiveDate)
    changedFields.push('effective_date')
  }
  if (input.expirationDate !== undefined) {
    overrides.expiration_date = isoDateOrNull(input.expirationDate)
    changedFields.push('expiration_date')
  }
  if (input.packSize !== undefined) {
    overrides.pack_size = input.packSize === null ? null : positiveNumberOrNull(input.packSize)
    changedFields.push('pack_size')
  }
  if (input.tier !== undefined) {
    overrides.tier = nonEmptyText(input.tier)
    changedFields.push('tier')
  }
  if (input.minimumQuantity !== undefined) {
    overrides.minimum_quantity = input.minimumQuantity === null ? null : positiveNumberOrNull(input.minimumQuantity)
    changedFields.push('minimum_quantity')
  }
  if (changedFields.length === 0) throw new Error('No changes provided.')

  const now = new Date().toISOString()
  const actor = safeUuid(actorId)

  const copy: DbRow = { ...line }
  delete copy.id
  delete copy.created_at
  const { data: inserted, error: insertError } = await supabase
    .from('supplier_contract_cost_lines')
    .insert({
      ...copy,
      ...overrides,
      active: true,
      approval_status: 'approved',
      supersedes_cost_line_id: costLineId,
      created_by: actor,
      approved_at: now,
      approved_by: actor,
    })
    .select('id')
    .single()
  assertNoError(insertError)
  const newLineId = String((inserted as DbRow).id)

  const { error: supersedeError } = await supabase
    .from('supplier_contract_cost_lines')
    .update({ active: false, approval_status: 'superseded' })
    .eq('id', costLineId)
    .eq('active', true)
  assertNoError(supersedeError)

  await logManualEvent(
    'manual_line_update',
    actor,
    {
      cost_line_id: newLineId,
      superseded_cost_line_id: costLineId,
      supplier_contract_id: contractId,
      fields_changed: changedFields,
    },
    input.notes
  )

  return {
    costLineId: newLineId,
    supplierContractId: contractId,
    action: 'manual_line_update',
    supersededCostLineId: costLineId,
  }
}

/**
 * Deactivate (expire) an active cost line. The line is kept for history with
 * approval_status left as approved but active=false and an expiration date.
 */
export async function deactivateCostLine(
  costLineId: string,
  notes?: string | null,
  actorId?: string | null
): Promise<CostLineMutationResult> {
  assertConfigured()
  const supabase = createAdminClient()
  const { data: existing, error: fetchError } = await supabase
    .from('supplier_contract_cost_lines')
    .select('id, supplier_contract_id, active, approval_status')
    .eq('id', costLineId)
    .maybeSingle()
  assertNoError(fetchError)
  if (!existing) throw new Error('Cost line not found.')
  const line = existing as DbRow
  if (!line.active) throw new Error('Cost line is already inactive.')
  const contractId = safeUuid(String(line.supplier_contract_id ?? ''))
  if (!contractId) throw new Error('Cost line has no supplier contract.')

  const today = new Date().toISOString().slice(0, 10)
  const actor = safeUuid(actorId)
  const { error: updateError } = await supabase
    .from('supplier_contract_cost_lines')
    .update({ active: false, expiration_date: today })
    .eq('id', costLineId)
    .eq('active', true)
  assertNoError(updateError)

  await logManualEvent(
    'manual_line_deactivate',
    actor,
    { cost_line_id: costLineId, supplier_contract_id: contractId },
    notes
  )

  return { costLineId, supplierContractId: contractId, action: 'manual_line_deactivate', supersededCostLineId: null }
}
