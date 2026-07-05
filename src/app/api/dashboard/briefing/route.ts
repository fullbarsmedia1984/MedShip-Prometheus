import { NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, MANAGER_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { generateAndStoreCeoBriefing, getLatestCeoBriefing } from '@/lib/incentive/briefing'

export async function GET() {
  try {
    const auth = await requireApiAuth(MANAGER_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    return NextResponse.json({ briefing: await getLatestCeoBriefing() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Manual regenerate (admin) — e.g. after fixing aliases or a big order lands.
export async function POST() {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    return NextResponse.json({ briefing: await generateAndStoreCeoBriefing() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
