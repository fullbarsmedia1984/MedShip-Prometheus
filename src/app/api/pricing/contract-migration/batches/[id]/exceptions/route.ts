import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { listMigrationExceptions } from '@/lib/pricing/contract-migration'

type ExceptionsContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: ExceptionsContext) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const exceptions = await listMigrationExceptions(id)

    return NextResponse.json({ exceptions })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
