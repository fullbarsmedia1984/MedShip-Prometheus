import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { CACHE_TAGS } from '@/lib/cache-tags'
import {
  buildKitImportPreview,
  extractKitImportOrderNumbers,
  type KitImportKnownOrder,
  type KitImportOverlay,
} from '@/lib/kits/import'
import { createAdminClient } from '@/lib/supabase/admin'

type ImportMode = 'preview' | 'commit'

const OVERLAY_SELECT = [
  'so_number',
  'earliest_need_by',
  'absolute_need_by',
  'transit_days',
  'rep',
  'table_location',
  'notes',
].join(',')

async function loadImportContext(
  supabase: ReturnType<typeof createAdminClient>,
  soNumbers: string[]
) {
  const knownOrders = new Map<string, KitImportKnownOrder>()
  const existingOverlays = new Map<string, KitImportOverlay>()

  for (let index = 0; index < soNumbers.length; index += 200) {
    const batch = soNumbers.slice(index, index + 200)
    const [ordersResult, overlaysResult] = await Promise.all([
      supabase
        .from('fb_sales_orders')
        .select('so_number,status')
        .in('so_number', batch),
      supabase
        .from('kit_orders')
        .select(OVERLAY_SELECT)
        .in('so_number', batch),
    ])

    if (ordersResult.error) {
      throw new Error(`Could not verify Fishbowl kit orders: ${ordersResult.error.message}`)
    }
    if (overlaysResult.error) {
      throw new Error(`Could not read existing kit operations data: ${overlaysResult.error.message}`)
    }

    for (const row of ordersResult.data ?? []) {
      const known = row as KitImportKnownOrder
      knownOrders.set(known.so_number, known)
    }
    for (const row of overlaysResult.data ?? []) {
      const overlay = row as unknown as KitImportOverlay
      existingOverlays.set(overlay.so_number, overlay)
    }
  }

  return { knownOrders, existingOverlays }
}

// POST /api/kits/import
//
// Preview is the default and never writes. Commit requires the digest returned
// by a preview of the same source against the same live rows. Blank cells mean
// "leave unchanged", and exact header aliases prevent "Sub Notes" from being
// mistaken for the workbook's separate Notes column.
export async function POST(request: Request) {
  const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
  if (!auth.authorized) return auth.response

  try {
    const body = await request.json().catch(() => null)
    const text = body?.csv ? String(body.csv) : ''
    const mode: ImportMode = body?.mode === 'commit' ? 'commit' : 'preview'
    const confirmDigest = body?.confirmDigest ? String(body.confirmDigest) : null

    if (!text.trim()) {
      return NextResponse.json({ error: 'csv required' }, { status: 400 })
    }

    const soNumbers = extractKitImportOrderNumbers(text)
    const supabase = createAdminClient()
    const { knownOrders, existingOverlays } = await loadImportContext(supabase, soNumbers)
    const preview = buildKitImportPreview({
      text,
      knownOrders,
      existingOverlays,
    })

    if (mode === 'preview') {
      return NextResponse.json({ mode, preview })
    }

    if (!confirmDigest || confirmDigest !== preview.digest) {
      return NextResponse.json(
        {
          error: 'The import preview is stale. Preview the workbook again before applying it.',
          mode: 'preview',
          preview,
        },
        { status: 409 }
      )
    }

    if (preview.blockingErrors.length > 0) {
      return NextResponse.json(
        {
          error: 'Resolve the import validation errors before applying changes.',
          mode: 'preview',
          preview,
        },
        { status: 422 }
      )
    }

    if (preview.changes.length === 0) {
      return NextResponse.json({
        mode,
        applied: 0,
        auditLogged: true,
        preview,
      })
    }

    const { data: appliedCount, error: applyError } = await supabase.rpc(
      'apply_kit_import',
      {
        p_changes: preview.changes,
        p_digest: preview.digest,
        p_actor_user_id: auth.user?.id ?? null,
        p_actor_email: auth.user?.email ?? null,
      }
    )

    if (applyError) {
      throw new Error(`Kit import failed without completing: ${applyError.message}`)
    }
    if (Number(appliedCount) !== preview.changes.length) {
      throw new Error(
        `Kit import verification failed: expected ${preview.changes.length} rows, received ${Number(appliedCount)}.`
      )
    }

    // Bulk overlay writes feed the cached workbench/wallboard DALs.
    revalidateTag(CACHE_TAGS.kits, { expire: 0 })
    revalidateTag(CACHE_TAGS.wallboard, { expire: 0 })

    return NextResponse.json({
      mode,
      applied: preview.changes.length,
      auditLogged: true,
      preview,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown kit import error' },
      { status: 500 }
    )
  }
}
