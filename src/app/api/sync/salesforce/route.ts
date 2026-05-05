import { NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'

// POST /api/sync/salesforce — triggers a full sync
export async function POST() {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    await inngest.send({
      name: 'medship/sf.full-sync',
      data: { triggeredAt: new Date().toISOString() },
    })
    return NextResponse.json({ triggered: true, message: 'Sync started' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET /api/sync/salesforce — returns current sync state
export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const supabase = createAdminClient()
    const { data: syncState } = await supabase
      .from('sf_sync_state')
      .select('*')
      .order('table_name')

    return NextResponse.json({ syncState: syncState ?? [] })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
