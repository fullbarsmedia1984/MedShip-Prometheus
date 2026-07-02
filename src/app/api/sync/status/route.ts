import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'

/**
 * Sync status endpoint
 *
 * Returns current status of all automations and recent sync events.
 *
 * GET /api/sync/status
 * GET /api/sync/status?automation=P2_INVENTORY_SYNC
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const supabase = await createClient()

    const searchParams = request.nextUrl.searchParams
    const automation = searchParams.get('automation')

    // Get sync schedules (last run info)
    const { data: schedules, error: schedulesError } = await supabase
      .from('sync_schedules')
      .select('*')
      .order('automation')

    if (schedulesError) {
      return NextResponse.json(
        { error: schedulesError.message },
        { status: 500 }
      )
    }

    const scheduleRows = automation
      ? (schedules || []).filter((schedule) => schedule.automation === automation)
      : (schedules || [])

    // Get recent sync events
    let eventsQuery = supabase
      .from('sync_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (automation) {
      eventsQuery = eventsQuery.eq('automation', automation)
    }

    const { data: events, error: eventsError } = await eventsQuery

    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 500 })
    }

    let latestErrorQuery = supabase
      .from('sync_events')
      .select('automation,status,error_message,created_at,completed_at')
      .not('error_message', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200)

    if (automation) {
      latestErrorQuery = latestErrorQuery.eq('automation', automation)
    } else if (scheduleRows.length > 0) {
      latestErrorQuery = latestErrorQuery.in(
        'automation',
        scheduleRows.map((schedule) => schedule.automation)
      )
    }

    const { data: latestErrorEvents, error: latestErrorError } =
      await latestErrorQuery

    if (latestErrorError) {
      return NextResponse.json(
        { error: latestErrorError.message },
        { status: 500 }
      )
    }

    const latestErrorByAutomation = new Map<
      string,
      {
        status: string
        error_message: string | null
        created_at: string
        completed_at: string | null
      }
    >()

    for (const event of latestErrorEvents || []) {
      if (!latestErrorByAutomation.has(event.automation)) {
        latestErrorByAutomation.set(event.automation, event)
      }
    }

    // Calculate stats per automation
    const stats = scheduleRows.map((schedule) => {
      const automationEvents = (events || []).filter(
        (e) => e.automation === schedule.automation
      )
      const latestError = latestErrorByAutomation.get(schedule.automation)
      const last24h = automationEvents.filter(
        (e) => new Date(e.created_at) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      )

      const successCount = last24h.filter((e) => e.status === 'success').length
      const failedCount = last24h.filter((e) => e.status === 'failed').length
      const pendingCount = last24h.filter(
        (e) => e.status === 'pending' || e.status === 'retrying'
      ).length

      return {
        automation: schedule.automation,
        cronExpression: schedule.cron_expression,
        isActive: schedule.is_active,
        lastRunAt: schedule.last_run_at,
        lastRunStatus: schedule.last_run_status,
        lastRunDurationMs: schedule.last_run_duration_ms,
        nextRunAt: schedule.next_run_at,
        recordsProcessed: schedule.records_processed,
        latestError: latestError
          ? {
              message: latestError.error_message,
              status: latestError.status,
              createdAt: latestError.created_at,
              completedAt: latestError.completed_at,
            }
          : null,
        stats24h: {
          success: successCount,
          failed: failedCount,
          pending: pendingCount,
          total: last24h.length,
          successRate:
            last24h.length > 0
              ? Math.round((successCount / last24h.length) * 100)
              : 0,
        },
      }
    })

    // Get failed events that can be retried
    const failedEvents = (events || [])
      .filter((e) => e.status === 'failed' && e.retry_count < e.max_retries)
      .slice(0, 20)

    return NextResponse.json({
      success: true,
      data: {
        automations: stats,
        recentEvents: (events || []).slice(0, 20).map((e) => ({
          id: e.id,
          automation: e.automation,
          sourceSystem: e.source_system,
          targetSystem: e.target_system,
          sourceRecordId: e.source_record_id,
          targetRecordId: e.target_record_id,
          status: e.status,
          errorMessage: e.error_message,
          retryCount: e.retry_count,
          createdAt: e.created_at,
          completedAt: e.completed_at,
        })),
        failedEvents: failedEvents.map((e) => ({
          id: e.id,
          automation: e.automation,
          sourceRecordId: e.source_record_id,
          errorMessage: e.error_message,
          retryCount: e.retry_count,
          maxRetries: e.max_retries,
          createdAt: e.created_at,
        })),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
