import { NextRequest, NextResponse } from 'next/server'
import { SALES_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getRepAliases } from '@/lib/reps'
import { getOrderById } from '@/lib/data'

type OrderDetailContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: OrderDetailContext) {
  try {
    const auth = await requireApiAuth(SALES_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const order = await getOrderById(id)

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Reps may only open their own orders (404, not 403, to avoid confirming
    // that a given order number exists).
    if (auth.role === 'sales_rep' && auth.user) {
      const aliases = await getRepAliases(auth.user.id)
      if (!aliases.includes(order.salesRepId)) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }
    }

    return NextResponse.json({ order })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
