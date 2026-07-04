import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { inngest } from '@/inngest'
import { ADMIN_API_AUTH_OPTIONS, STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { SALES_DASHBOARD_CACHE_TAG } from '@/lib/data'
import { createAdminClient } from '@/lib/supabase/admin'
import { INCENTIVE_CACHE_TAG, resolveRepAlias } from '@/lib/incentive/queries'

export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const supabase = createAdminClient()
    const [unmapped, sfUsers] = await Promise.all([
      supabase.from('v_incentive_unmapped_salespersons').select('*').limit(500),
      supabase.from('sf_users').select('sf_id, name').eq('is_active', true).order('name'),
    ])
    if (unmapped.error) throw unmapped.error
    if (sfUsers.error) throw sfUsers.error

    return NextResponse.json({ unmapped: unmapped.data ?? [], sfUsers: sfUsers.data ?? [] })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = (await request.json()) as {
      fishbowlSalesperson?: unknown
      action?: unknown
      displayName?: unknown
      sfUserId?: unknown
      notes?: unknown
    }

    const fishbowlSalesperson =
      typeof body.fishbowlSalesperson === 'string' ? body.fishbowlSalesperson.trim() : ''
    const action = body.action
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined
    const sfUserId = typeof body.sfUserId === 'string' && body.sfUserId.trim() ? body.sfUserId.trim() : null
    const notes = typeof body.notes === 'string' ? body.notes.trim() : null

    if (!fishbowlSalesperson) {
      return NextResponse.json({ error: 'fishbowlSalesperson is required' }, { status: 400 })
    }
    if (action !== 'assign' && action !== 'house' && action !== 'system') {
      return NextResponse.json({ error: "action must be 'assign', 'house', or 'system'" }, { status: 400 })
    }
    if (action === 'assign' && !displayName) {
      return NextResponse.json({ error: 'displayName is required when assigning to a rep' }, { status: 400 })
    }

    await resolveRepAlias({ fishbowlSalesperson, action, displayName, sfUserId, notes })

    // Alias edits feed both the legacy sales dashboard and the incentive layer.
    revalidateTag(SALES_DASHBOARD_CACHE_TAG, { expire: 0 })
    revalidateTag(INCENTIVE_CACHE_TAG, { expire: 0 })
    await inngest.send({ name: 'incentive/recompute', data: { triggeredBy: 'alias-edit' } })

    return NextResponse.json({ success: true, fishbowlSalesperson, action })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
