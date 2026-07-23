import { NextResponse, type NextRequest } from 'next/server'
import { CATALOG_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import {
  getCatalogItemDetail,
  getCatalogItemRawPayload,
  stripDetailPrices,
} from '@/lib/hercules/catalog-browse'

// No force-dynamic: reads go through the unstable_cache-wrapped catalog DAL
// (tag 'catalog-cache', busted by the nightly P10 ingest); the route itself is
// still rendered per-request because requireApiAuth reads cookies.

// Owner decision 2026-07-08: every signed-in role (sales reps,
// purchasing/quotes staff, admins) may see supplier cost.
const PRICE_ROLES = new Set(['superadmin', 'admin', 'staff', 'sales_manager', 'sales_rep', 'warehouse'])

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(CATALOG_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const canSeePrices = auth.role !== null && PRICE_ROLES.has(auth.role)
    const { id } = await context.params

    // Lazy path for the large raw Hercules JSONB payload: fetched only when
    // the detail page's collapsed toggle is opened, and gated to the same
    // roles that may see supplier cost (the toggle is only rendered for them).
    if (request.nextUrl.searchParams.get('raw') === '1') {
      if (!canSeePrices) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const rawPayload = await getCatalogItemRawPayload(id)
      if (rawPayload === null) {
        return NextResponse.json({ error: 'Catalog item not found' }, { status: 404 })
      }
      return NextResponse.json({ rawPayload })
    }

    let detail = await getCatalogItemDetail(id)

    if (!detail) {
      return NextResponse.json({ error: 'Catalog item not found' }, { status: 404 })
    }
    if (!canSeePrices) detail = stripDetailPrices(detail)

    return NextResponse.json({ detail, canSeePrices })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
