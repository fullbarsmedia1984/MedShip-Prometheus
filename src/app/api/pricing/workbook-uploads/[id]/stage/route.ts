import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { stageWorkbookUpload } from '@/lib/pricing/excel-ingestion'

type StageContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: StageContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    if (typeof body.profileId !== 'string' || !body.profileId) {
      return NextResponse.json({ error: 'profileId is required.' }, { status: 400 })
    }

    const stage = await stageWorkbookUpload(id, body.profileId, auth.user?.id ?? null)
    return NextResponse.json({ stage })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
