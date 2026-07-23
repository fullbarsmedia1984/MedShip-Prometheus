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

// No force-dynamic: reads go through the unstable_cache-wrapped catalog DAL
// (tag 'catalog-cache', busted by the nightly P10 ingest); the route itself is
// still rendered per-request because requireApiAuth reads cookies.

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
    // Facets are additive UI sugar — fetch them alongside the search rather
    // than after it, and never let a slow aggregate under ingestion load take
    // the whole page down.
    const facetsPromise: Promise<Awaited<ReturnType<typeof getCatalogFacets>> | null> =
      params.get('facets') === '1' ? getCatalogFacets().catch(() => null) : Promise.resolve(null)

    const [searchResult, facets] = await Promise.all([
      searchCatalogItems({
        q,
        manufacturer: params.get('manufacturer') ?? undefined,
        category: params.get('category') ?? undefined,
        vendor: params.get('vendor') ?? undefined,
        sort,
        page: Number(params.get('page') ?? '1') || 1,
        pageSize: Number(params.get('pageSize') ?? '25') || 25,
      }, queryEmbedding),
      facetsPromise,
    ])

    // Telemetry on real searches (not default browsing); zero-result
    // queries feed the synonym dictionary.
    if (q && searchResult.page === 1) {
      logCatalogSearch({
        q,
        manufacturer: params.get('manufacturer'),
        category: params.get('category'),
        vendor: params.get('vendor'),
        sort,
        resultCount: searchResult.items.length,
        hasMore: searchResult.hasMore,
        tookMs: Date.now() - startedAt,
        role: auth.role,
      })
    }

    const result = canSeePrices ? searchResult : stripSearchPrices(searchResult)

    return NextResponse.json({ result, facets, canSeePrices })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
