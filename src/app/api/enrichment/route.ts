import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest'
import {
  ADMIN_API_AUTH_OPTIONS,
  STAFF_API_AUTH_OPTIONS,
  requireApiAuth,
} from '@/lib/auth'
import { isFirecrawlConfigured } from '@/lib/enrichment/env'
import { SupabaseEnrichmentRepository } from '@/lib/enrichment/repository'
import type { Competitor, EnrichmentPhase } from '@/lib/enrichment/types'
import { logSyncEvent } from '@/lib/utils/logger'

const PHASE_EVENTS: Record<EnrichmentPhase, 'enrichment/competitor.crawl' | 'enrichment/images.mirror' | 'enrichment/images.search'> = {
  competitor_crawl: 'enrichment/competitor.crawl',
  image_mirror: 'enrichment/images.mirror',
  search_sweep: 'enrichment/images.search',
}

/**
 * Item enrichment control endpoint.
 *
 * GET  -> recent runs + configuration state.
 * POST -> { action?: 'start' | 'cancel', phase: 'competitor_crawl' |
 *           'image_mirror' | 'search_sweep', competitor?, runId? }
 *
 * 'start' also resumes: an active run picks up from its checkpoint.
 */
export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const repository = new SupabaseEnrichmentRepository()
    const recentRuns = await repository.listRecentRuns(15)

    return NextResponse.json({
      firecrawlConfigured: isFirecrawlConfigured(),
      recentRuns,
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
      phase?: EnrichmentPhase
      competitor?: Competitor
      runId?: string
      reason?: string
    }
    const action = body.action ?? 'start'
    const phase = body.phase
    const requestedBy = auth.user?.email ?? (auth.isDevBypass ? 'local-dev-bypass' : 'unknown')

    if (!phase || !(phase in PHASE_EVENTS)) {
      return NextResponse.json(
        { error: "phase must be 'competitor_crawl', 'image_mirror', or 'search_sweep'" },
        { status: 400 }
      )
    }

    if (action === 'cancel') {
      if (!body.runId) {
        return NextResponse.json({ error: 'cancel requires runId' }, { status: 400 })
      }
      const repository = new SupabaseEnrichmentRepository()
      await repository.completeRun(body.runId, {
        status: 'cancelled',
        lastError: body.reason ?? `Cancelled by ${requestedBy}`,
      })

      await logSyncEvent({
        automation: 'P15_COMPETITOR_CRAWL',
        sourceSystem: 'prometheus',
        targetSystem: 'inngest',
        sourceRecordId: body.runId,
        status: 'dismissed',
        payload: { action: 'cancel', phase, runId: body.runId, requestedBy, reason: body.reason },
      })

      return NextResponse.json({ success: true, cancelled: body.runId })
    }

    if (phase === 'competitor_crawl') {
      const competitor = body.competitor
      if (competitor !== 'pocketnurse' && competitor !== 'diamedical') {
        return NextResponse.json(
          { error: "competitor_crawl requires competitor: 'pocketnurse' | 'diamedical'" },
          { status: 400 }
        )
      }
      if (competitor === 'pocketnurse' && !isFirecrawlConfigured()) {
        return NextResponse.json(
          { error: 'Firecrawl is not configured. Set FIRECRAWL_API_KEY.' },
          { status: 409 }
        )
      }

      const { ids } = await inngest.send({
        name: 'enrichment/competitor.crawl',
        data: { competitor, triggeredBy: `api:${requestedBy}` },
      })
      return NextResponse.json({
        success: true,
        message: `Competitor crawl (${competitor}) triggered`,
        eventId: ids[0],
      })
    }

    if (phase === 'search_sweep' && !isFirecrawlConfigured()) {
      return NextResponse.json(
        { error: 'Firecrawl is not configured. Set FIRECRAWL_API_KEY.' },
        { status: 409 }
      )
    }

    const { ids } = await inngest.send({
      name: PHASE_EVENTS[phase],
      data: { triggeredBy: `api:${requestedBy}` },
    })

    return NextResponse.json({
      success: true,
      message: `${phase} triggered`,
      eventId: ids[0],
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
