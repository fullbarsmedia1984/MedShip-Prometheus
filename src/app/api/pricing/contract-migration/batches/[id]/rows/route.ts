import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { listMigrationRows } from '@/lib/pricing/contract-migration'

type RowsContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RowsContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('pageSize') ?? 25)))
    const result = await listMigrationRows(id, page, pageSize)

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
