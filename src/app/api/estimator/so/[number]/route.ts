import { NextRequest, NextResponse } from 'next/server'
import { ESTIMATOR_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getSalesOrderSummary } from '@/lib/estimator/estimate-service'
import { SalesOrderNotFoundError } from '@/lib/estimator/so-service'

type SoContext = {
  params: Promise<{ number: string }>
}

export async function GET(_request: NextRequest, context: SoContext) {
  try {
    const auth = await requireApiAuth(ESTIMATOR_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { number } = await context.params
    const soNumber = decodeURIComponent(number).trim()
    if (!soNumber) {
      return NextResponse.json({ error: 'SO number is required' }, { status: 400 })
    }

    const summary = await getSalesOrderSummary(soNumber)
    return NextResponse.json({ summary })
  } catch (error) {
    if (error instanceof SalesOrderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
