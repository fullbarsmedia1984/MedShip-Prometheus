import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { runContractMigrationPreflight } from '@/lib/pricing/contract-migration'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Filesystem dry-run preflight is local/dev only. Register uploaded artifacts for production use.' },
        { status: 400 }
      )
    }

    const body = (await request.json()) as { dryRunPath?: unknown }
    if (typeof body.dryRunPath !== 'string' || !body.dryRunPath.trim()) {
      return NextResponse.json({ error: 'dryRunPath is required.' }, { status: 400 })
    }

    const result = await runContractMigrationPreflight(body.dryRunPath)
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
