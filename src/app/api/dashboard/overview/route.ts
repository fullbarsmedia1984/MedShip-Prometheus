import { NextResponse } from 'next/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getOverviewPayload } from '@/lib/overview-payload'

export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    return NextResponse.json(await getOverviewPayload())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
