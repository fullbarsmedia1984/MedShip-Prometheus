import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { rollbackMigrationBatch } from '@/lib/pricing/contract-migration'

type RollbackContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RollbackContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const result = await rollbackMigrationBatch(id, {
      actorId: auth.user?.id ?? null,
      confirm: typeof body.confirm === 'string' ? body.confirm : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
    })

    return NextResponse.json({ rollback: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
