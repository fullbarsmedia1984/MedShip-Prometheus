import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { publishMigrationBatch } from '@/lib/pricing/contract-migration'

type PublishContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: PublishContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const result = await publishMigrationBatch(id, {
      actorId: auth.user?.id ?? null,
      confirm: typeof body.confirm === 'string' ? body.confirm : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
    })

    return NextResponse.json({ publish: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
