import { NextRequest, NextResponse } from 'next/server'
import { SALES_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { resolveRepScope } from '@/lib/sales-scope'
import { getScopedOrderById } from '@/lib/orders-payload'

type OrderDetailContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: OrderDetailContext) {
  try {
    const auth = await requireApiAuth(SALES_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    // Reps may only open their own orders — getScopedOrderById resolves
    // out-of-scope rows to null so this surfaces 404, not 403 (avoids
    // confirming that a given order number exists).
    const repScope = await resolveRepScope(auth.role, auth.user)
    const order = await getScopedOrderById(id, repScope)

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    return NextResponse.json({ order })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
