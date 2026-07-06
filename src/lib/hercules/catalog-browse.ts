import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { JsonObject } from './types'

/**
 * Read models for the Supplier Catalog browser. Hercules staging data is
 * Class P (admin-only); every consumer of these queries must sit behind
 * ADMIN_API_AUTH_OPTIONS.
 */

export type CatalogListParams = {
  q?: string
  manufacturer?: string
  category?: string
  page: number
  pageSize: number
}

export type CatalogListItem = {
  id: string
  herculesItemId: string
  msId: string | null
  description: string | null
  brand: string | null
  manufacturerName: string | null
  manufacturerPartNumber: string | null
  category: string | null
  subcategory: string | null
  status: string | null
  vendorOfferCount: number
  updatedAt: string | null
}

export type CatalogListResult = {
  data: CatalogListItem[]
  page: number
  pageSize: number
  total: number
}

export type CatalogFacets = {
  manufacturers: Array<{ name: string; count: number }>
  categories: Array<{ name: string; count: number }>
  itemsWithOffers: number
  vendorOffers: number
  suppliers: number
}

export type CatalogUomDetail = {
  id: string
  uomCode: string | null
  vendorPartNumber: string | null
  uomTitle: string | null
  package: string | null
  perQuantity: number | null
  listPriceAmount: number | null
  contractPriceAmount: number | null
  contractPriceStatus: string | null
  currency: string
  isDefault: boolean | null
  quantityAvailable: number | null
  availability: string | null
  weight: number | null
  weightUnit: string | null
  length: number | null
  width: number | null
  height: number | null
  dimensionUnit: string | null
  gtin: string | null
  hcpcs: string | null
}

export type CatalogOfferDetail = {
  id: string
  vendorName: string
  supplierName: string | null
  supplierCode: string | null
  vendorProductTitle: string | null
  isPrimary: boolean
  leadTime: string | null
  minimumOrderQuantity: number | null
  uoms: CatalogUomDetail[]
}

export type CatalogItemDetail = {
  id: string
  herculesItemId: string
  msId: string | null
  description: string | null
  brand: string | null
  manufacturerName: string | null
  manufacturerHerculesId: string | null
  manufacturerPartNumber: string | null
  category: string | null
  subcategory: string | null
  unspsc: string | null
  countryOfOrigin: string | null
  status: string | null
  imageUrls: string[]
  createdAt: string | null
  updatedAt: string | null
  rawPayload: JsonObject
  offers: CatalogOfferDetail[]
}

type DbRow = Record<string, unknown>

function assertNoError(error: unknown) {
  if (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'Unknown Supabase error'
    throw new Error(message)
  }
}

function textOrNull(value: unknown) {
  return typeof value === 'string' && value ? value : null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// PostgREST .or() filter values cannot contain these unescaped; strip them
// rather than escape so a search never turns into a filter-syntax error.
function sanitizeSearchTerm(term: string) {
  return term.replace(/[,()."\\]/g, ' ').trim()
}

export async function listCatalogItems(
  params: CatalogListParams
): Promise<CatalogListResult> {
  const supabase = createAdminClient()
  const page = Math.max(1, params.page)
  const pageSize = Math.min(Math.max(params.pageSize, 1), 100)
  const from = (page - 1) * pageSize

  let query = supabase
    .from('hercules_catalog_items')
    .select(
      'id, hercules_item_id, ms_id, description, brand, manufacturer_name, manufacturer_part_number, category, subcategory, status, updated_at, hercules_vendor_offers(count)',
      { count: 'exact' }
    )

  const q = params.q ? sanitizeSearchTerm(params.q) : ''
  if (q) {
    query = query.or(
      `description.ilike.%${q}%,manufacturer_part_number.ilike.%${q}%,manufacturer_name.ilike.%${q}%`
    )
  }
  if (params.manufacturer) query = query.eq('manufacturer_name', params.manufacturer)
  if (params.category) query = query.eq('category', params.category)

  const { data, error, count } = await query
    .order('updated_at', { ascending: false })
    .range(from, from + pageSize - 1)

  assertNoError(error)

  return {
    page,
    pageSize,
    total: count ?? 0,
    data: ((data ?? []) as DbRow[]).map((row) => ({
      id: String(row.id),
      herculesItemId: String(row.hercules_item_id),
      msId: textOrNull(row.ms_id),
      description: textOrNull(row.description),
      brand: textOrNull(row.brand),
      manufacturerName: textOrNull(row.manufacturer_name),
      manufacturerPartNumber: textOrNull(row.manufacturer_part_number),
      category: textOrNull(row.category),
      subcategory: textOrNull(row.subcategory),
      status: textOrNull(row.status),
      vendorOfferCount: numberOrNull(
        (row.hercules_vendor_offers as Array<{ count?: unknown }> | null)?.[0]?.count
      ) ?? 0,
      updatedAt: textOrNull(row.updated_at),
    })),
  }
}

export async function getCatalogFacets(): Promise<CatalogFacets> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('hercules_catalog_facets')
  assertNoError(error)

  const raw = (data ?? {}) as {
    manufacturers?: Array<{ name: string; count: number }>
    categories?: Array<{ name: string; count: number }>
    itemsWithOffers?: number
    vendorOffers?: number
    suppliers?: number
  }

  return {
    manufacturers: raw.manufacturers ?? [],
    categories: raw.categories ?? [],
    itemsWithOffers: raw.itemsWithOffers ?? 0,
    vendorOffers: raw.vendorOffers ?? 0,
    suppliers: raw.suppliers ?? 0,
  }
}

export async function getCatalogItemDetail(
  id: string
): Promise<CatalogItemDetail | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('hercules_catalog_items')
    .select(
      `
      *,
      hercules_vendor_offers(
        id, vendor_name, supplier_code, vendor_product_title, is_primary,
        lead_time, minimum_order_quantity,
        hercules_suppliers(supplier_name, supplier_code),
        hercules_offer_uoms(*)
      )
    `
    )
    .eq('id', id)
    .maybeSingle()

  assertNoError(error)
  if (!data) return null

  const row = data as DbRow
  const offers = Array.isArray(row.hercules_vendor_offers)
    ? (row.hercules_vendor_offers as DbRow[])
    : []

  return {
    id: String(row.id),
    herculesItemId: String(row.hercules_item_id),
    msId: textOrNull(row.ms_id),
    description: textOrNull(row.description),
    brand: textOrNull(row.brand),
    manufacturerName: textOrNull(row.manufacturer_name),
    manufacturerHerculesId: textOrNull(row.manufacturer_hercules_id),
    manufacturerPartNumber: textOrNull(row.manufacturer_part_number),
    category: textOrNull(row.category),
    subcategory: textOrNull(row.subcategory),
    unspsc: textOrNull(row.unspsc),
    countryOfOrigin: textOrNull(row.country_of_origin),
    status: textOrNull(row.status),
    imageUrls: Array.isArray(row.image_urls_json) ? (row.image_urls_json as string[]) : [],
    createdAt: textOrNull(row.created_at),
    updatedAt: textOrNull(row.updated_at),
    rawPayload: (row.raw_payload as JsonObject | null) ?? {},
    offers: offers.map((offer) => {
      const supplier = offer.hercules_suppliers as DbRow | null
      const uoms = Array.isArray(offer.hercules_offer_uoms)
        ? (offer.hercules_offer_uoms as DbRow[])
        : []

      return {
        id: String(offer.id),
        vendorName: String(offer.vendor_name),
        supplierName: textOrNull(supplier?.supplier_name),
        supplierCode:
          textOrNull(supplier?.supplier_code) ?? textOrNull(offer.supplier_code),
        vendorProductTitle: textOrNull(offer.vendor_product_title),
        isPrimary: Boolean(offer.is_primary),
        leadTime: textOrNull(offer.lead_time),
        minimumOrderQuantity: numberOrNull(offer.minimum_order_quantity),
        uoms: uoms.map((uom) => ({
          id: String(uom.id),
          uomCode: textOrNull(uom.uom_code),
          vendorPartNumber: textOrNull(uom.vendor_part_number),
          uomTitle: textOrNull(uom.uom_title),
          package: textOrNull(uom.package),
          perQuantity: numberOrNull(uom.per_quantity),
          listPriceAmount: numberOrNull(uom.list_price_amount),
          contractPriceAmount: numberOrNull(uom.contract_price_amount),
          contractPriceStatus: textOrNull(uom.contract_price_status),
          currency: textOrNull(uom.currency) ?? 'USD',
          isDefault: typeof uom.is_default === 'boolean' ? uom.is_default : null,
          quantityAvailable: numberOrNull(uom.quantity_available),
          availability: textOrNull(uom.availability),
          weight: numberOrNull(uom.weight),
          weightUnit: textOrNull(uom.weight_unit),
          length: numberOrNull(uom.length),
          width: numberOrNull(uom.width),
          height: numberOrNull(uom.height),
          dimensionUnit: textOrNull(uom.dimension_unit),
          gtin: textOrNull(uom.gtin),
          hcpcs: textOrNull(uom.hcpcs),
        })),
      }
    }),
  }
}
