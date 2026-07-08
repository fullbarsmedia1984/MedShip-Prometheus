import { NextResponse, type NextRequest } from 'next/server'
import { SALES_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getCatalogItemDetail, stripDetailPrices } from '@/lib/hercules/catalog-browse'

export const dynamic = 'force-dynamic'

const PRICE_ROLES = new Set(['superadmin', 'admin', 'staff'])

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(SALES_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const canSeePrices = auth.role !== null && PRICE_ROLES.has(auth.role)
    const { id } = await context.params
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
