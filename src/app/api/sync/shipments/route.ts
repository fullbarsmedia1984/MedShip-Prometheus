import { NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import {
  ADMIN_API_AUTH_OPTIONS,
  requireApiAuth,
} from '@/lib/auth'
import { syncRecentShipments } from '@/lib/warehouse-board/shipments-sync'

// POST /api/sync/shipments — trigger the P12 shipments cache sync.
// Default: fire the Inngest event. Pass { inline: true } to run in-request.
export async function POST(request: Request) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    if (body?.inline) {
      const shipments = await syncRecentShipments()
      return NextResponse.json({ triggered: true, inline: true, shipments })
    }

    await inngest.send({
      name: 'fishbowl/shipments.sync',
      data: { triggeredAt: new Date().toISOString() },
    })
    return NextResponse.json({ triggered: true, message: 'Shipments sync started' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
