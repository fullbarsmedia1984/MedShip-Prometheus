export type SupplierContractSummary = {
  id: string
  supplier_name: string
  contract_name: string | null
  contract_number: string | null
  status: string
  effective_date: string | null
  expiration_date: string | null
  updated_at: string
  active_line_count: number
  pending_line_count: number
}

export type ContractCostLine = {
  id: string
  supplier_contract_id: string | null
  distributor_sku: string | null
  manufacturer_name: string | null
  manufacturer_part_number: string | null
  model_number: string | null
  gtin: string | null
  item_description_raw: string | null
  cost: number
  currency: string
  raw_price_uom: string | null
  normalized_price_uom: string | null
  pack_size: number | null
  tier: string | null
  minimum_quantity: number | null
  effective_date: string | null
  expiration_date: string | null
  active: boolean
  approval_status: string
  internal_item_id: string | null
  hercules_catalog_item_id: string | null
  supersedes_cost_line_id: string | null
  source_batch_id: string | null
  source_file_name: string | null
  source_sheet_name: string | null
  source_row_number: number | null
  created_at: string
  approved_at: string | null
}

export type ManualCostLineInput = {
  cost: number
  currency?: string | null
  distributorSku?: string | null
  manufacturerName?: string | null
  manufacturerPartNumber?: string | null
  modelNumber?: string | null
  gtin?: string | null
  itemDescription?: string | null
  priceUom: string
  packSize?: number | null
  tier?: string | null
  minimumQuantity?: number | null
  effectiveDate?: string | null
  expirationDate?: string | null
  notes?: string | null
}

export type CostLineUpdateInput = {
  cost?: number | null
  priceUom?: string | null
  itemDescription?: string | null
  effectiveDate?: string | null
  expirationDate?: string | null
  packSize?: number | null
  tier?: string | null
  minimumQuantity?: number | null
  notes?: string | null
}

export type CostLineMutationResult = {
  costLineId: string
  supplierContractId: string
  action: 'manual_line_create' | 'manual_line_update' | 'manual_line_deactivate'
  supersededCostLineId: string | null
}

export type CostLineStatusFilter = 'active' | 'pending' | 'superseded' | 'rolled_back' | 'all'
