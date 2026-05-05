import { NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getDataSourceMode, setDataSourceMode, clearDataSourceCache } from '@/lib/utils/app-settings'

// GET /api/settings/data-source — returns current mode
export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const mode = await getDataSourceMode()
    return NextResponse.json({ mode })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// POST /api/settings/data-source — updates the mode
// Body: { mode: 'seed' | 'live' }
export async function POST(req: Request) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = await req.json()
    if (body.mode !== 'seed' && body.mode !== 'live') {
      return NextResponse.json({ error: 'Invalid mode. Must be "seed" or "live".' }, { status: 400 })
    }

    await setDataSourceMode(body.mode)
    clearDataSourceCache()

    return NextResponse.json({ mode: body.mode })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
