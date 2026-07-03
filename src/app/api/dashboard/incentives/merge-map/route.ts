import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { inngest } from '@/inngest'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  INCENTIVE_CACHE_TAG,
  addMergeMapping,
  listMergeMappings,
  removeMergeMapping,
} from '@/lib/incentive/queries'

async function afterMergeMapChange() {
  revalidateTag(INCENTIVE_CACHE_TAG, { expire: 0 })
  // Classifications depend on the map; recompute (the DB dirty-flag trigger
  // also catches this, but the manual event makes the admin UI feel live).
  await inngest.send({ name: 'incentive/recompute', data: { triggeredBy: 'merge-map-edit' } })
}

export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const supabase = createAdminClient()
    const [mappings, candidates] = await Promise.all([
      listMergeMappings(),
      supabase.from('v_customer_merge_candidates').select('*').limit(200),
    ])
    if (candidates.error) throw candidates.error

    return NextResponse.json({ mappings, candidates: candidates.data ?? [] })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = (await request.json()) as {
      duplicateKey?: unknown
      canonicalKey?: unknown
      reason?: unknown
    }
    const duplicateKey = typeof body.duplicateKey === 'string' ? body.duplicateKey.trim() : ''
    const canonicalKey = typeof body.canonicalKey === 'string' ? body.canonicalKey.trim() : ''
    const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined

    if (!duplicateKey || !canonicalKey) {
      return NextResponse.json({ error: 'duplicateKey and canonicalKey are required' }, { status: 400 })
    }
    if (duplicateKey === canonicalKey) {
      return NextResponse.json({ error: 'duplicateKey and canonicalKey must differ' }, { status: 400 })
    }

    // Chain/cycle prevention is enforced by the DB trigger; surface its
    // message as a 400 rather than a 500.
    try {
      await addMergeMapping({
        duplicateKey,
        canonicalKey,
        reason,
        createdBy: auth.user?.email ?? (auth.isDevBypass ? 'local-dev-bypass' : null),
      })
    } catch (dbError) {
      const message = dbError instanceof Error ? dbError.message : String(dbError)
      if (/merge chains|canonical target|already mapped|duplicate key/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 400 })
      }
      throw dbError
    }

    await afterMergeMapChange()
    return NextResponse.json({ success: true, duplicateKey, canonicalKey })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = (await request.json()) as { duplicateKey?: unknown }
    const duplicateKey = typeof body.duplicateKey === 'string' ? body.duplicateKey.trim() : ''
    if (!duplicateKey) {
      return NextResponse.json({ error: 'duplicateKey is required' }, { status: 400 })
    }

    await removeMergeMapping(duplicateKey)
    await afterMergeMapChange()
    return NextResponse.json({ success: true, duplicateKey })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
