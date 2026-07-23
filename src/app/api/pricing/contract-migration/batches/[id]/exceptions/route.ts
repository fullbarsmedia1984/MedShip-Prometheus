import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getMigrationExceptionSummary, listMigrationExceptions } from '@/lib/pricing/contract-migration'

type ExceptionsContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: ExceptionsContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    // The list is bounded (most recent first); the summary carries the exact
    // totals and per-code counts so aggregates never depend on the bound.
    const [exceptions, summary] = await Promise.all([
      listMigrationExceptions(id),
      getMigrationExceptionSummary(id),
    ])

    return NextResponse.json({ exceptions, summary })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
