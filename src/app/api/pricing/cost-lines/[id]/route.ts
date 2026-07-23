import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { deactivateCostLine, updateCostLine } from '@/lib/pricing/contract-costs'
import type { CostLineUpdateInput } from '@/lib/pricing/contract-costs'

type CostLineContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, context: CostLineContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const body = (await request.json().catch(() => ({}))) as CostLineUpdateInput & { action?: string }

    if (body.action === 'deactivate') {
      const result = await deactivateCostLine(id, body.notes ?? null, auth.user?.id ?? null)
      return NextResponse.json({ costLine: result })
    }

    const result = await updateCostLine(id, body, auth.user?.id ?? null)
    return NextResponse.json({ costLine: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
