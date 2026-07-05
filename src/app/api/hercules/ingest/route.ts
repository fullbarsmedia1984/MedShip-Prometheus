import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { cancelCatalogIngestion } from '@/lib/hercules/catalog-ingestion'
import { isHerculesApiConfigured } from '@/lib/hercules/env'
import { SupabaseHerculesIngestionRepository } from '@/lib/hercules/ingestion-repository'
import { SupabaseHerculesPricingRepository } from '@/lib/hercules/supabase-repository'
import { logSyncEvent } from '@/lib/utils/logger'

/**
 * Hercules catalog ingestion control endpoint.
 *
 * GET  -> active run, recent runs, and the delta watermark.
 * POST -> { action?: 'start' | 'cancel', runType?: 'full' | 'delta',
 *           pageSize?: number, runId?: string (cancel only) }
 *
 * 'start' also resumes: if a run is already active, the ingest event
 * picks it up from its checkpoint instead of creating a new one.
 */
export async function GET() {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const repository = new SupabaseHerculesIngestionRepository()
    const [activeRun, recentRuns, watermark] = await Promise.all([
      repository.getActiveRun('parts'),
      repository.listRecentRuns(10),
      repository.getSyncWatermark('parts'),
    ])

    return NextResponse.json({
      configured: isHerculesApiConfigured(),
      activeRun,
      recentRuns,
      watermark,
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
      action?: 'start' | 'cancel'
      runType?: 'full' | 'delta'
      pageSize?: number
      runId?: string
      reason?: string
    }
    const action = body.action ?? 'start'
    const requestedBy = auth.user?.email ?? (auth.isDevBypass ? 'local-dev-bypass' : 'unknown')

    if (action === 'cancel') {
      if (!body.runId) {
        return NextResponse.json({ error: 'cancel requires runId' }, { status: 400 })
      }

      await cancelCatalogIngestion(
        {
          importRepository: new SupabaseHerculesPricingRepository(),
          ingestionRepository: new SupabaseHerculesIngestionRepository(),
        },
        body.runId,
        body.reason ?? `Cancelled by ${requestedBy}`
      )

      await logSyncEvent({
        automation: 'P10_HERCULES_CATALOG_INGEST',
        sourceSystem: 'prometheus',
        targetSystem: 'hercules',
        sourceRecordId: body.runId,
        status: 'dismissed',
        payload: { action: 'cancel', runId: body.runId, requestedBy, reason: body.reason },
      })

      return NextResponse.json({ success: true, cancelled: body.runId })
    }

    if (!isHerculesApiConfigured()) {
      return NextResponse.json(
        {
          error:
            'Hercules API is not configured. Set HERCULES_API_APP_ID and HERCULES_API_ACCESS_TOKEN.',
        },
        { status: 409 }
      )
    }

    const runType = body.runType === 'delta' ? 'delta' : 'full'
    const eventData = {
      runType,
      pageSize: body.pageSize,
      triggeredBy: `api:${requestedBy}`,
    }

    const auditEventId = await logSyncEvent({
      automation: 'P10_HERCULES_CATALOG_INGEST',
      sourceSystem: 'prometheus',
      targetSystem: 'inngest',
      status: 'pending',
      payload: { action: 'start', ...eventData },
    })

    const { ids } = await inngest.send({
      name: 'hercules/catalog.ingest',
      data: eventData,
    })

    return NextResponse.json({
      success: true,
      message: `Hercules catalog ingestion (${runType}) triggered`,
      eventId: ids[0],
      auditEventId,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
