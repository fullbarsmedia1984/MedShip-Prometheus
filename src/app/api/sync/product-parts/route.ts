import { NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import {
  ADMIN_API_AUTH_OPTIONS,
  requireApiAuth,
} from '@/lib/auth'
import { withFishbowlSession } from '@/lib/fishbowl/session'
import { syncProductParts } from '@/lib/inventory/product-parts-sync'

// POST /api/sync/product-parts — trigger the P15 product-part mapping sync.
// Default: fire the Inngest event. Pass { inline: true } to run in-request.
export async function POST(request: Request) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    if (body?.inline) {
      const products = await withFishbowlSession(
        { automation: 'P15_PRODUCT_PARTS_SYNC', sourceSystem: 'fishbowl', targetSystem: 'prometheus' },
        (client) => syncProductParts(client)
      )
      return NextResponse.json({ triggered: true, inline: true, products })
    }

    await inngest.send({
      name: 'fishbowl/product-parts.sync',
      data: { triggeredAt: new Date().toISOString() },
    })
    return NextResponse.json({ triggered: true, message: 'Product-part mapping sync started' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
