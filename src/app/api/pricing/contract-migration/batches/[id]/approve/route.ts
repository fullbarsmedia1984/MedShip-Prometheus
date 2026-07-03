import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { approveMigrationBatch } from '@/lib/pricing/contract-migration'

type ApprovalContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: ApprovalContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const result = await approveMigrationBatch(id, {
      reviewerId: auth.user?.id ?? null,
      reviewerIdentifier: typeof body.reviewerIdentifier === 'string' ? body.reviewerIdentifier : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
    })

    return NextResponse.json({ approval: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
