import 'server-only'

import { unstable_cache } from 'next/cache'
import { CACHE_TAGS, CACHE_TTL } from '@/lib/cache-tags'
import { createAdminClient } from '@/lib/supabase/admin'
import { toVectorLiteral } from './embeddings'
import { expandSearchQuery } from './search-expansion'
import type { JsonObject } from './types'

/**
 * Read models for the Supplier Catalog browser.
 *
 * Access model (product decision 2026-07-08): every signed-in role may
 * browse catalog attributes so reps can find products; supplier BUY
 * prices (list/contract) remain staff-and-above and are stripped
 * server-side for sales reps. Direct-DB RLS stays admin-only (Class P);
 * these queries run through the service role behind role-checked routes.
 */

export type CatalogSortOption = 'relevance' | 'newest' | 'price_asc' | 'price_desc'

export type CatalogSearchParams = {
  q?: string
  manufacturer?: string
  category?: string
  vendor?: string
  sort?: CatalogSortOption
  page: number
  pageSize: number
}

export type CatalogSearchItem = {
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
  imageUrl: string | null
  updatedAt: string | null
  vendors: string[]
  offerCount: number
  priceMin: number | null
  priceMax: number | null
}

export type CatalogSearchResult = {
  items: CatalogSearchItem[]
  hasMore: boolean
  /** Planner estimate; only present for the unfiltered browse view. */
  estimatedTotal: number | null
  page: number
  pageSize: number
}

export type CatalogFacets = {
  manufacturers: Array<{ name: string; count: number }>
  categories: Array<{ name: string; count: number }>
  vendors: Array<{ name: string; count: number }>
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

export type CatalogStoredImage = {
  url: string
  source: string
  isPrimary: boolean
}

export type CatalogCompetitorPrice = {
  competitor: string
  url: string
  title: string | null
  listPriceAmount: number | null
  currency: string
  priceStatus: string
  lastScrapedAt: string | null
  matchMethod: string
  matchConfidence: number | null
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
  /** Images mirrored into the catalog-images Storage bucket (P16/P17). */
  storedImages: CatalogStoredImage[]
  /** Competitor price book rows (P15); null once stripped for the role. */
  competitorPrices: CatalogCompetitorPrice[] | null
  createdAt: string | null
  updatedAt: string | null
  /**
   * Always `{}` in the standard detail read — the JSONB payload is large and
   * only shown behind a collapsed toggle, so it loads lazily through
   * getCatalogItemRawPayload (GET /api/hercules/catalog/[id]?raw=1).
   */
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

async function searchCatalogItemsUncached(
  params: CatalogSearchParams,
  queryEmbedding?: number[] | null
): Promise<CatalogSearchResult> {
  const supabase = createAdminClient()
  const page = Math.max(1, params.page)
  const pageSize = Math.min(Math.max(params.pageSize, 1), 100)

  const { data, error } = await supabase.rpc('hercules_catalog_search', {
    q: params.q ?? '',
    p_manufacturer: params.manufacturer ?? null,
    p_category: params.category ?? null,
    p_vendor: params.vendor ?? null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_qvec: queryEmbedding ? toVectorLiteral(queryEmbedding) : null,
    p_qexp: params.q ? expandSearchQuery(params.q) : null,
    p_sort: params.sort ?? 'relevance',
    p_facets: false,
  })
  assertNoError(error)

  const raw = (data ?? {}) as {
    items?: Array<Record<string, unknown>>
    hasMore?: boolean
    estimatedTotal?: number | null
  }

  return {
    page,
    pageSize,
    hasMore: Boolean(raw.hasMore),
    estimatedTotal: numberOrNull(raw.estimatedTotal),
    items: (raw.items ?? []).map((row) => ({
      id: String(row.id),
      herculesItemId: String(row.herculesItemId),
      msId: textOrNull(row.msId),
      description: textOrNull(row.description),
      brand: textOrNull(row.brand),
      manufacturerName: textOrNull(row.manufacturerName),
      manufacturerPartNumber: textOrNull(row.manufacturerPartNumber),
      category: textOrNull(row.category),
      subcategory: textOrNull(row.subcategory),
      status: textOrNull(row.status),
      imageUrl: textOrNull(row.imageUrl),
      updatedAt: textOrNull(row.updatedAt),
      vendors: Array.isArray(row.vendors) ? (row.vendors as string[]) : [],
      offerCount: numberOrNull(row.offerCount) ?? 0,
      priceMin: numberOrNull(row.priceMin),
      priceMax: numberOrNull(row.priceMax),
    })),
  }
}

// Catalog tables only change on the nightly P10 delta ingest, which busts
// CACHE_TAGS.catalog when it finishes — so every read here is safe to cache
// for CACHE_TTL.catalog. Auth/role handling stays in the routes; nothing
// per-request is captured inside the cached callbacks (the admin client is
// env-configured only).
const searchCatalogItemsCached = unstable_cache(
  async (params: CatalogSearchParams) => searchCatalogItemsUncached(params),
  ['hercules-catalog-search'],
  { revalidate: CACHE_TTL.catalog, tags: [CACHE_TAGS.catalog] }
)

export async function searchCatalogItems(
  params: CatalogSearchParams,
  queryEmbedding?: number[] | null
): Promise<CatalogSearchResult> {
  // Semantic searches carry a ~1.5k-float embedding; serializing it into the
  // cache key would bloat the data cache for near-zero hit rate, so only
  // lexical searches go through the cache.
  if (queryEmbedding && queryEmbedding.length > 0) {
    return searchCatalogItemsUncached(params, queryEmbedding)
  }
  return searchCatalogItemsCached(params)
}

/** Strip buy-side prices for roles below staff. */
export function stripSearchPrices(result: CatalogSearchResult): CatalogSearchResult {
  return {
    ...result,
    items: result.items.map((item) => ({ ...item, priceMin: null, priceMax: null })),
  }
}

export function stripDetailPrices(detail: CatalogItemDetail): CatalogItemDetail {
  return {
    ...detail,
    competitorPrices: null,
    offers: detail.offers.map((offer) => ({
      ...offer,
      uoms: offer.uoms.map((uom) => ({
        ...uom,
        listPriceAmount: null,
        contractPriceAmount: null,
        contractPriceStatus: null,
      })),
    })),
  }
}

async function getCatalogFacetsUncached(): Promise<CatalogFacets> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('hercules_catalog_facets')
  assertNoError(error)

  const raw = (data ?? {}) as Partial<CatalogFacets>

  return {
    manufacturers: raw.manufacturers ?? [],
    categories: raw.categories ?? [],
    vendors: raw.vendors ?? [],
    itemsWithOffers: raw.itemsWithOffers ?? 0,
    vendorOffers: raw.vendorOffers ?? 0,
    suppliers: raw.suppliers ?? 0,
  }
}

const getCatalogFacetsCached = unstable_cache(
  getCatalogFacetsUncached,
  ['hercules-catalog-facets'],
  { revalidate: CACHE_TTL.catalog, tags: [CACHE_TAGS.catalog] }
)

export async function getCatalogFacets(): Promise<CatalogFacets> {
  return getCatalogFacetsCached()
}

// Everything the detail view renders — deliberately NOT `*`: raw_payload (and
// any other wide columns) would otherwise ship on every detail read even
// though the UI only shows the payload inside a collapsed toggle.
const CATALOG_ITEM_DETAIL_SELECT = `
      id, hercules_item_id, ms_id, description, brand, manufacturer_name,
      manufacturer_hercules_id, manufacturer_part_number, category, subcategory,
      unspsc, country_of_origin, status, image_urls_json, created_at, updated_at,
      hercules_vendor_offers(
        id, vendor_name, supplier_code, vendor_product_title, is_primary,
        lead_time, minimum_order_quantity,
        hercules_suppliers(supplier_name, supplier_code),
        hercules_offer_uoms(
          id, uom_code, vendor_part_number, uom_title, package, per_quantity,
          list_price_amount, contract_price_amount, contract_price_status,
          currency, is_default, quantity_available, availability,
          weight, weight_unit, length, width, height, dimension_unit,
          gtin, hcpcs
        )
      )
    `

async function getCatalogItemDetailUncached(
  id: string
): Promise<CatalogItemDetail | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('hercules_catalog_items')
    .select(CATALOG_ITEM_DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle()

  assertNoError(error)
  if (!data) return null

  const row = data as DbRow
  const offers = Array.isArray(row.hercules_vendor_offers)
    ? (row.hercules_vendor_offers as DbRow[])
    : []

  // Enrichment reads are separate queries so a failure there never
  // breaks the core detail view.
  const [storedImages, competitorPrices] = await Promise.all([
    getStoredImages(supabase, id),
    getCompetitorPrices(supabase, id),
  ])

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
    storedImages,
    competitorPrices,
    createdAt: textOrNull(row.created_at),
    updatedAt: textOrNull(row.updated_at),
    // Loaded lazily via getCatalogItemRawPayload; see CatalogItemDetail.
    rawPayload: {},
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

const getCatalogItemDetailCached = unstable_cache(
  getCatalogItemDetailUncached,
  ['hercules-catalog-item-detail'],
  { revalidate: CACHE_TTL.catalog, tags: [CACHE_TAGS.catalog] }
)

export async function getCatalogItemDetail(
  id: string
): Promise<CatalogItemDetail | null> {
  return getCatalogItemDetailCached(id)
}

async function getCatalogItemRawPayloadUncached(
  id: string
): Promise<JsonObject | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('hercules_catalog_items')
    .select('raw_payload')
    .eq('id', id)
    .maybeSingle()
  assertNoError(error)
  if (!data) return null
  return ((data as DbRow).raw_payload as JsonObject | null) ?? {}
}

const getCatalogItemRawPayloadCached = unstable_cache(
  getCatalogItemRawPayloadUncached,
  ['hercules-catalog-item-raw-payload'],
  { revalidate: CACHE_TTL.catalog, tags: [CACHE_TAGS.catalog] }
)

/**
 * Lazy companion to getCatalogItemDetail: the raw Hercules JSONB payload,
 * fetched only when the detail page's collapsed toggle is opened.
 * Returns null when the item does not exist.
 */
export async function getCatalogItemRawPayload(
  id: string
): Promise<JsonObject | null> {
  return getCatalogItemRawPayloadCached(id)
}

async function getStoredImages(
  supabase: ReturnType<typeof createAdminClient>,
  itemId: string
): Promise<CatalogStoredImage[]> {
  try {
    const { data, error } = await supabase
      .from('catalog_item_images')
      .select('storage_path, source, is_primary')
      .eq('hercules_catalog_item_id', itemId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(6)
    assertNoError(error)

    return ((data ?? []) as DbRow[]).map((row) => ({
      // getPublicUrl is a pure string concat; no network round-trip.
      url: supabase.storage.from('catalog-images').getPublicUrl(String(row.storage_path)).data
        .publicUrl,
      source: String(row.source),
      isPrimary: Boolean(row.is_primary),
    }))
  } catch (error) {
    console.error('stored image lookup failed:', error)
    return []
  }
}

async function getCompetitorPrices(
  supabase: ReturnType<typeof createAdminClient>,
  itemId: string
): Promise<CatalogCompetitorPrice[]> {
  try {
    const { data, error } = await supabase
      .from('catalog_item_competitor_links')
      .select(
        'match_method, match_confidence, competitor_products(competitor, url, title, list_price_amount, currency, price_status, last_scraped_at)'
      )
      .eq('hercules_catalog_item_id', itemId)
      .eq('status', 'active')
      .limit(10)
    assertNoError(error)

    const prices: CatalogCompetitorPrice[] = []
    for (const row of (data ?? []) as DbRow[]) {
      const product = row.competitor_products as DbRow | null
      if (!product) continue
      prices.push({
        competitor: String(product.competitor),
        url: String(product.url),
        title: textOrNull(product.title),
        listPriceAmount: numberOrNull(product.list_price_amount),
        currency: textOrNull(product.currency) ?? 'USD',
        priceStatus: textOrNull(product.price_status) ?? 'unknown',
        lastScrapedAt: textOrNull(product.last_scraped_at),
        matchMethod: String(row.match_method),
        matchConfidence: numberOrNull(row.match_confidence),
      })
    }
    return prices
  } catch (error) {
    console.error('competitor price lookup failed:', error)
    return []
  }
}

// Semantic search stays dark until the embedding backfill + ANN index are
// in place; the switch is the app_settings row so no redeploy is needed.
let semanticFlagCache: { value: boolean; expires: number } | null = null

export async function isSemanticSearchEnabled(): Promise<boolean> {
  if (semanticFlagCache && semanticFlagCache.expires > Date.now()) {
    return semanticFlagCache.value
  }
  try {
    const { data } = await createAdminClient()
      .from('app_settings')
      .select('value')
      .eq('key', 'hercules_semantic_search')
      .maybeSingle()
    const value = String(data?.value ?? '').replace(/"/g, '') === 'on'
    semanticFlagCache = { value, expires: Date.now() + 60_000 }
    return value
  } catch {
    return false
  }
}

/**
 * Fire-and-forget search telemetry: what reps search, what returns
 * nothing (feeds the synonym dictionary), and how slow it was.
 */
export function logCatalogSearch(entry: {
  q: string
  manufacturer?: string | null
  category?: string | null
  vendor?: string | null
  sort?: string | null
  resultCount: number
  hasMore: boolean
  tookMs: number
  role?: string | null
}): void {
  void createAdminClient()
    .from('hercules_search_log')
    .insert({
      q: entry.q,
      manufacturer: entry.manufacturer ?? null,
      category: entry.category ?? null,
      vendor: entry.vendor ?? null,
      sort: entry.sort ?? null,
      result_count: entry.resultCount,
      has_more: entry.hasMore,
      took_ms: entry.tookMs,
      role: entry.role ?? null,
    })
    .then(({ error }) => {
      if (error) console.error('search log insert failed:', error.message)
    })
}
