import { NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/sync/salesforce — triggers a full sync
export async function POST() {
  try {
    await inngest.send({
      name: 'medship/sf.full-sync',
      data: { triggeredAt: new Date().toISOString() },
    })
    return NextResponse.json({ triggered: true, message: 'Sync started' })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// GET /api/sync/salesforce — returns current sync state
export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data: syncState } = await supabase
      .from('sf_sync_state')
      .select('*')
      .order('table_name')

    return NextResponse.json({ syncState: syncState ?? [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
