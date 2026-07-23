import { NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ADMIN_API_AUTH_OPTIONS,
  STAFF_API_AUTH_OPTIONS,
  requireApiAuth,
} from '@/lib/auth'
import { withFishbowlSession } from '@/lib/fishbowl/session'
import {
  syncOpenPoLines,
  syncPurchaseOrders,
} from '@/lib/warehouse-board/po-sync'

// POST /api/sync/purchase-orders — trigger the P11 PO sync.
// Default: fire the Inngest event. Pass { inline: true } to run in-request
// (initial backfill / environments without an Inngest worker).
export async function POST(request: Request) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    if (body?.inline) {
      const result = await withFishbowlSession(
        { automation: 'P11_PO_SYNC', sourceSystem: 'fishbowl', targetSystem: 'prometheus' },
        async (client) => {
          const sync = await syncPurchaseOrders(client)
          const openLines = await syncOpenPoLines(client)
          return { ...sync, openLines }
        }
      )
      return NextResponse.json({ triggered: true, inline: true, ...result })
    }

    await inngest.send({
      name: 'fishbowl/purchase-orders.sync',
      data: { triggeredAt: new Date().toISOString() },
    })
    return NextResponse.json({ triggered: true, message: 'PO sync started' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET /api/sync/purchase-orders — cache freshness/counts
export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const supabase = createAdminClient()
    const [pos, lines, newest] = await Promise.all([
      supabase.from('fb_purchase_orders').select('id', { count: 'exact', head: true }),
      supabase
        .from('fb_purchase_order_items')
        .select('id', { count: 'exact', head: true }),
      supabase
        .from('fb_purchase_orders')
        .select('last_synced_at')
        .order('last_synced_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    return NextResponse.json({
      purchaseOrders: pos.count ?? 0,
      lines: lines.count ?? 0,
      lastSyncedAt: newest.data?.last_synced_at ?? null,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
