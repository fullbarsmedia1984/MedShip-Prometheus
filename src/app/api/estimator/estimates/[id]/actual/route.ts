import { NextRequest, NextResponse } from 'next/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { recordActualBoxes } from '@/lib/estimator/repositories'

type ActualContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: ActualContext) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const body = (await request.json()) as { actualBoxesUsed?: unknown }
    if (body.actualBoxesUsed === undefined || body.actualBoxesUsed === null) {
      return NextResponse.json({ error: 'actualBoxesUsed is required' }, { status: 400 })
    }

    const recordedBy = auth.user?.email ?? (auth.isDevBypass ? 'dev-bypass' : null)
    await recordActualBoxes(id, body.actualBoxesUsed, recordedBy)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
