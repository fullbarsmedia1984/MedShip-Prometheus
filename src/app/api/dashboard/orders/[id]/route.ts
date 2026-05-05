import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getOrderById } from '@/lib/data'

type OrderDetailContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: OrderDetailContext) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const order = await getOrderById(id)

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
