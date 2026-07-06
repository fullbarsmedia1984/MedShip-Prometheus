import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getCatalogItemDetail } from '@/lib/hercules/catalog-browse'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const detail = await getCatalogItemDetail(id)

    if (!detail) {
      return NextResponse.json({ error: 'Catalog item not found' }, { status: 404 })
    }

    return NextResponse.json({ detail })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
