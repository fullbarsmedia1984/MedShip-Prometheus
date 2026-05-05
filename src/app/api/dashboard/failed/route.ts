import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getFailedSyncs } from '@/lib/data'

export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    return NextResponse.json({ failedSyncs: await getFailedSyncs() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
