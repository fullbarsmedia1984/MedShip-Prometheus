import { NextResponse, type NextRequest } from 'next/server'

import { requireApiAuth } from '@/lib/auth'
import { getInventoryDetail } from '@/app/dashboard/inventory/[id]/data'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, context: RouteContext<'/api/dashboard/inventory/[id]'>) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const detail = await getInventoryDetail(id)

    if (!detail) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
    }

    return NextResponse.json({ detail })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
