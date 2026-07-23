import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { SupabaseEnrichmentRepository } from '@/lib/enrichment/repository'
import type { ImageSource } from '@/lib/enrichment/types'
import { logSyncEvent } from '@/lib/utils/logger'

const SOURCES = new Set(['all', 'hercules', 'pocketnurse', 'diamedical', 'web_search'])

/**
 * Enrichment image review gallery.
 *
 * GET  -> newest stored images (keyset via ?before=<ISO>), filterable
 *         by ?source=. Admin-only, like the rest of the enrichment
 *         review surface.
 * POST -> { action: 'reject', imageId } (admin) — removes the image
 *         link and marks the item so no automation refills it.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const params = request.nextUrl.searchParams
    const sourceParam = params.get('source') ?? 'web_search'
    if (!SOURCES.has(sourceParam)) {
      return NextResponse.json(
        { error: "source must be 'all', 'hercules', 'pocketnurse', 'diamedical', or 'web_search'" },
        { status: 400 }
      )
    }
    const before = params.get('before')
    const limit = Math.min(Math.max(Number(params.get('limit')) || 48, 1), 120)

    const repository = new SupabaseEnrichmentRepository()
    const [images, counts] = await Promise.all([
      repository.listReviewImages({
        source: sourceParam as ImageSource | 'all',
        before,
        limit,
      }),
      repository.countImagesBySource(),
    ])

    return NextResponse.json({
      images,
      counts,
      nextBefore: images.length === limit ? images[images.length - 1].createdAt : null,
      canReject: auth.role === 'superadmin' || auth.role === 'admin',
    })
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

    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      imageId?: string
    }
    if (body.action !== 'reject' || !body.imageId) {
      return NextResponse.json({ error: "requires action: 'reject' and imageId" }, { status: 400 })
    }

    const repository = new SupabaseEnrichmentRepository()
    const result = await repository.rejectImage(body.imageId)
    if (!result) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }

    await logSyncEvent({
      automation: 'P18_IMAGE_SEARCH_SWEEP',
      sourceSystem: 'prometheus',
      targetSystem: 'prometheus',
      sourceRecordId: body.imageId,
      status: 'dismissed',
      payload: {
        action: 'reject-image',
        imageId: body.imageId,
        itemId: result.itemId,
        requestedBy: auth.user?.email ?? 'unknown',
      },
    })

    return NextResponse.json({ success: true, itemId: result.itemId })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
