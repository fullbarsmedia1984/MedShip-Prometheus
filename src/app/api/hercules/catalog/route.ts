import { NextRequest, NextResponse } from 'next/server'
import { SALES_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import {
  getCatalogFacets,
  searchCatalogItems,
  stripSearchPrices,
} from '@/lib/hercules/catalog-browse'

export const dynamic = 'force-dynamic'

// Owner decision 2026-07-08: every signed-in role (sales reps,
// purchasing/quotes staff, admins) may see supplier cost.
const PRICE_ROLES = new Set(['superadmin', 'admin', 'staff', 'sales_manager', 'sales_rep'])

/**
 * Supplier Catalog search endpoint. All signed-in roles may browse
 * catalog attributes; supplier buy prices are stripped for sales roles.
 *
 * GET /api/hercules/catalog?q=&manufacturer=&category=&vendor=&page=&pageSize=[&facets=1]
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(SALES_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const canSeePrices = auth.role !== null && PRICE_ROLES.has(auth.role)
    const params = request.nextUrl.searchParams

    let result = await searchCatalogItems({
      q: params.get('q') ?? undefined,
      manufacturer: params.get('manufacturer') ?? undefined,
      category: params.get('category') ?? undefined,
      vendor: params.get('vendor') ?? undefined,
      page: Number(params.get('page') ?? '1') || 1,
      pageSize: Number(params.get('pageSize') ?? '25') || 25,
    })
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
