import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getCatalogFacets, listCatalogItems } from '@/lib/hercules/catalog-browse'

export const dynamic = 'force-dynamic'

/**
 * Supplier Catalog browse endpoint (Class P data — admin only).
 *
 * GET /api/hercules/catalog?q=&manufacturer=&category=&page=&pageSize=
 * Add &facets=1 to include facet aggregates (fetched once per page load).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    const result = await listCatalogItems({
      q: params.get('q') ?? undefined,
      manufacturer: params.get('manufacturer') ?? undefined,
      category: params.get('category') ?? undefined,
      page: Number(params.get('page') ?? '1') || 1,
      pageSize: Number(params.get('pageSize') ?? '25') || 25,
    })

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

    return NextResponse.json({ result, facets })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
