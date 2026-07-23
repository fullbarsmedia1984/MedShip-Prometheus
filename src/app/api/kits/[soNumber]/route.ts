import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { CACHE_TAGS } from '@/lib/cache-tags'
import { KITS_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// PATCH /api/kits/[soNumber] — upsert the human ops overlay for a kit order.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ soNumber: string }> }
) {
  const auth = await requireApiAuth(KITS_API_AUTH_OPTIONS)
  if (!auth.authorized) return auth.response

  const { soNumber: raw } = await params
  const soNumber = decodeURIComponent(raw)
  const supabase = createAdminClient()

  // Only real -KIT sales orders get an overlay row.
  const { data: so } = await supabase
    .from('fb_sales_orders')
    .select('so_number')
    .eq('so_number', soNumber)
    .maybeSingle()
  if (!so || !/-KIT/i.test(soNumber)) {
    return NextResponse.json({ error: 'Not a kit order' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Bad body' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  const dateField = (key: 'earliest_need_by' | 'absolute_need_by') => {
    if (body[key] === undefined) return
    if (body[key] === null || body[key] === '') patch[key] = null
    else if (DATE_RE.test(String(body[key]))) patch[key] = body[key]
    else throw new Error(`${key} must be YYYY-MM-DD`)
  }
  try {
    dateField('earliest_need_by')
    dateField('absolute_need_by')
    if (body.transit_days !== undefined) {
      const n = body.transit_days === null ? null : Number(body.transit_days)
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 30)) {
        throw new Error('transit_days must be 0-30')
      }
      patch.transit_days = n
    }
    if (body.rep !== undefined) {
      patch.rep = body.rep ? String(body.rep).trim().toUpperCase().slice(0, 8) : null
    }
    if (body.table_location !== undefined) {
      patch.table_location = body.table_location
        ? String(body.table_location).trim().slice(0, 16)
        : null
    }
    if (body.kit_list_printed !== undefined) {
      patch.kit_list_printed = Boolean(body.kit_list_printed)
    }
    if (body.sub_kit_status !== undefined) {
      if (
        body.sub_kit_status !== null &&
        !['received', 'pack_as_needed'].includes(body.sub_kit_status)
      ) {
        throw new Error('sub_kit_status invalid')
      }
      patch.sub_kit_status = body.sub_kit_status
    }
    if (body.notes !== undefined) {
      patch.notes = body.notes ? String(body.notes).slice(0, 2000) : null
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid field' },
      { status: 400 }
    )
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()
  patch.updated_by = auth.user?.id ?? null

  const { data, error } = await supabase
    .from('kit_orders')
    .upsert({ so_number: soNumber, ...patch }, { onConflict: 'so_number' })
    .select('*')
    .single()
  if (error) {
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }

  // The workbench/wallboard read kit_orders through cached DALs; bust them so
  // the edit survives the client's router.refresh().
  revalidateTag(CACHE_TAGS.kits, { expire: 0 })
  revalidateTag(CACHE_TAGS.wallboard, { expire: 0 })

  return NextResponse.json({ ops: data })
}
