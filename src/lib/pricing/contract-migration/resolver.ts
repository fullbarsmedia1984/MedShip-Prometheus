import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { ActiveSupplierCost, ActiveSupplierCostQuery, ActiveSupplierCostResult } from './types'

const RESOLVER_SELECT =
  'id, supplier_contract_id, supplier_name, internal_item_id, distributor_sku, manufacturer_name, manufacturer_part_number, model_number, gtin, item_description_raw, cost, currency, raw_price_uom, normalized_price_uom, pack_size, tier, minimum_quantity, effective_date, expiration_date, source_batch_id, approved_at'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

function missingRelation(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; message?: string }
  const message = candidate.message?.toLowerCase() ?? ''
  return candidate.code === '42P01' || candidate.code === 'PGRST205' || message.includes('does not exist')
}

function nonEmptyText(value?: string | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function safeIsoDate(value?: string | null) {
  const text = nonEmptyText(value)
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const parsed = new Date(`${text}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : text
}

/**
 * Read path for the active negotiated supplier cost: returns only cost lines
 * that are active, approved, and within their effective window as of the query
 * date. Buy-side supplier costs only — never touches customer sell pricing.
 * Requires at least one scoping filter so callers cannot dump the full table
 * by accident.
 */
export async function resolveActiveSupplierCosts(
  query: ActiveSupplierCostQuery = {}
): Promise<ActiveSupplierCostResult> {
  const supplierContractId = nonEmptyText(query.supplierContractId)
  const supplierName = nonEmptyText(query.supplierName)
  const internalItemId = nonEmptyText(query.internalItemId)
  const distributorSku = nonEmptyText(query.distributorSku)
  const manufacturerPartNumber = nonEmptyText(query.manufacturerPartNumber)
  const gtin = nonEmptyText(query.gtin)
  const priceUom = nonEmptyText(query.priceUom)

  if (
    !supplierContractId &&
    !supplierName &&
    !internalItemId &&
    !distributorSku &&
    !manufacturerPartNumber &&
    !gtin
  ) {
    throw new Error(
      'At least one filter is required: supplierContractId, supplierName, internalItemId, distributorSku, manufacturerPartNumber, or gtin.'
    )
  }

  const asOfDate = safeIsoDate(query.asOfDate) ?? new Date().toISOString().slice(0, 10)
  const limit = Math.min(Math.max(1, Math.trunc(query.limit ?? DEFAULT_LIMIT)), MAX_LIMIT)

  const supabase = createAdminClient()
  let request = supabase
    .from('supplier_contract_cost_lines')
    .select(RESOLVER_SELECT)
    .eq('active', true)
    .eq('approval_status', 'approved')
    .or(`effective_date.is.null,effective_date.lte.${asOfDate}`)
    .or(`expiration_date.is.null,expiration_date.gte.${asOfDate}`)

  if (supplierContractId) request = request.eq('supplier_contract_id', supplierContractId)
  if (supplierName) request = request.ilike('supplier_name', escapeLikePattern(supplierName))
  if (internalItemId) request = request.eq('internal_item_id', internalItemId)
  if (distributorSku) request = request.ilike('distributor_sku', escapeLikePattern(distributorSku))
  if (manufacturerPartNumber) {
    request = request.ilike('manufacturer_part_number', escapeLikePattern(manufacturerPartNumber))
  }
  if (gtin) request = request.ilike('gtin', escapeLikePattern(gtin))
  if (priceUom) request = request.ilike('normalized_price_uom', escapeLikePattern(priceUom))

  const { data, error } = await request
    .order('effective_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    if (missingRelation(error)) return { asOfDate, count: 0, lines: [] }
    throw new Error(
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'Unknown Supabase error'
    )
  }

  const lines = (data ?? []) as unknown as ActiveSupplierCost[]
  return { asOfDate, count: lines.length, lines }
}
