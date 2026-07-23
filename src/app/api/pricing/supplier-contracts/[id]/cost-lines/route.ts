import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { createManualCostLine } from '@/lib/pricing/contract-costs'
import type { ManualCostLineInput } from '@/lib/pricing/contract-costs'

type CostLinesContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: CostLinesContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const body = (await request.json().catch(() => ({}))) as Partial<ManualCostLineInput>
    if (typeof body.cost !== 'number' || typeof body.priceUom !== 'string') {
      return NextResponse.json({ error: 'cost (number) and priceUom are required.' }, { status: 400 })
    }

    const result = await createManualCostLine(id, body as ManualCostLineInput, auth.user?.id ?? null)
    return NextResponse.json({ costLine: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
