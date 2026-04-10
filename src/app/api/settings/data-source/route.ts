import { NextResponse } from 'next/server'
import { getDataSourceMode, setDataSourceMode, clearDataSourceCache } from '@/lib/utils/app-settings'

// GET /api/settings/data-source — returns current mode
export async function GET() {
  try {
    const mode = await getDataSourceMode()
    return NextResponse.json({ mode })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/settings/data-source — updates the mode
// Body: { mode: 'seed' | 'live' }
export async function POST(req: Request) {
  try {
    const body = await req.json()
    if (body.mode !== 'seed' && body.mode !== 'live') {
      return NextResponse.json({ error: 'Invalid mode. Must be "seed" or "live".' }, { status: 400 })
    }

    await setDataSourceMode(body.mode)
    clearDataSourceCache()

    return NextResponse.json({ mode: body.mode })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
