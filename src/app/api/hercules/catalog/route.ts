import { NextRequest, NextResponse } from 'next/server'
import { CATALOG_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import {
  getCatalogFacets,
  isSemanticSearchEnabled,
  logCatalogSearch,
  searchCatalogItems,
  stripSearchPrices,
  type CatalogSortOption,
} from '@/lib/hercules/catalog-browse'
import { embedQuery } from '@/lib/hercules/embeddings'

export const dynamic = 'force-dynamic'

// Owner decision 2026-07-08: every signed-in role (sales reps,
// purchasing/quotes staff, admins) may see supplier cost.
const PRICE_ROLES = new Set(['superadmin', 'admin', 'staff', 'sales_manager', 'sales_rep', 'warehouse'])

/**
 * Supplier Catalog search endpoint. All signed-in roles may browse
 * catalog attributes; supplier buy prices are stripped for sales roles.
 *
 * GET /api/hercules/catalog?q=&manufacturer=&category=&vendor=&page=&pageSize=[&facets=1]
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(CATALOG_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const canSeePrices = auth.role !== null && PRICE_ROLES.has(auth.role)
    const params = request.nextUrl.searchParams

    // Hybrid search: embed the query when semantic search is switched on
    // (app_settings). embedQuery degrades to null — lexical-only — on any
    // provider failure, so search never breaks on OpenAI hiccups.
    const q = params.get('q') ?? undefined
    const queryEmbedding =
      q && (await isSemanticSearchEnabled()) ? await embedQuery(q) : null

    const sortParam = params.get('sort')
    const sort: CatalogSortOption = ['relevance', 'newest', 'price_asc', 'price_desc'].includes(
      sortParam ?? ''
    )
      ? (sortParam as CatalogSortOption)
      : 'relevance'

    const startedAt = Date.now()
    let result = await searchCatalogItems({
      q,
      manufacturer: params.get('manufacturer') ?? undefined,
      category: params.get('category') ?? undefined,
      vendor: params.get('vendor') ?? undefined,
      sort,
      page: Number(params.get('page') ?? '1') || 1,
      pageSize: Number(params.get('pageSize') ?? '25') || 25,
    }, queryEmbedding)

    // Telemetry on real searches (not default browsing); zero-result
    // queries feed the synonym dictionary.
    if (q && result.page === 1) {
      logCatalogSearch({
        q,
        manufacturer: params.get('manufacturer'),
        category: params.get('category'),
        vendor: params.get('vendor'),
        sort,
        resultCount: result.items.length,
        hasMore: result.hasMore,
        tookMs: Date.now() - startedAt,
        role: auth.role,
      })
    }

    if (!canSeePrices) result = stripSearchPrices(result)

    // Facets are additive UI sugar — never let a slow aggregate under
    // ingestion load take the whole page down.
    let facets = null
    if (params.get('facets') === '1') {
      try {
        facets = await getCatalogFacets()
      } catch {
        facets = null
      }
    }

    return NextResponse.json({ result, facets, canSeePrices })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
