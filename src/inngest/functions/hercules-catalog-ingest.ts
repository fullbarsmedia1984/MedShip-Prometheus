import { inngest } from '../client'
import { logger, logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ingestCatalogPages,
  startOrResumeCatalogIngestion,
  type CatalogIngestionDeps,
  type IngestCatalogPagesResult,
} from '@/lib/hercules/catalog-ingestion'
import {
  createHerculesApiClientFromEnv,
  getHerculesIngestionConfig,
  isHerculesApiConfigured,
} from '@/lib/hercules/env'
import { SupabaseHerculesIngestionRepository } from '@/lib/hercules/ingestion-repository'
import { SupabaseHerculesPricingRepository } from '@/lib/hercules/supabase-repository'
import type { HerculesIngestionRunType } from '@/lib/hercules/types'

const AUTOMATION = 'P10_HERCULES_CATALOG_INGEST' as const

function buildDeps(): CatalogIngestionDeps {
  return {
    client: createHerculesApiClientFromEnv(),
    importRepository: new SupabaseHerculesPricingRepository(),
    ingestionRepository: new SupabaseHerculesIngestionRepository(),
  }
}

async function isP10ScheduleActive() {
  const { data, error } = await createAdminClient()
    .from('sync_schedules')
    .select('is_active')
    .eq('automation', AUTOMATION)
    .maybeSingle()

  if (error) {
    logger.log('warn', AUTOMATION, 'Could not read sync schedule; skipping delta cron', {
      error: error.message,
    })
    return false
  }

  return data?.is_active === true
}

/**
 * P10: Hercules parts catalog -> Prometheus supplier catalog staging.
 *
 * Reads /api/v1/parts/list page by page and upserts into the hercules_*
 * staging tables (never canonical Zeus products). The run checkpoint
 * lives in hercules_ingestion_runs; each step resumes from it, so
 * crashes, deploys, and rate-limit pauses never restart the import.
 * When a run needs more work than one Inngest run allows, it chains a
 * continuation event to itself.
 */
export const herculesCatalogIngest = inngest.createFunction(
  {
    id: 'hercules-catalog-ingest',
    name: 'P10: Hercules Catalog Ingest (Hercules -> Prometheus)',
    retries: 3,
    // The offset cursor is single-writer; never run two ingestion
    // executions concurrently.
    concurrency: [{ limit: 1 }],
    triggers: [{ event: 'hercules/catalog.ingest' }],
    onFailure: async ({ error }) => {
      // Leave the run in 'running' so the checkpoint stays resumable —
      // the next hercules/catalog.ingest event picks up where it stopped.
      // Cancel via POST /api/hercules/ingest {action:"cancel"} if needed.
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'hercules',
        targetSystem: 'prometheus',
        status: 'failed',
        errorMessage: `Ingestion run paused after exhausting retries: ${error.message}. Send another P10 ingest event to resume from the checkpoint.`,
      })

      // Self-heal transient outages: re-send the ingest event so the
      // active run resumes from its checkpoint. Guard against a crash
      // loop by giving up when failures pile up within the hour — at
      // that point it stays down until someone investigates.
      const active = await new SupabaseHerculesIngestionRepository().getActiveRun('parts')
      if (!active) return

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { count } = await createAdminClient()
        .from('sync_events')
        .select('id', { count: 'exact', head: true })
        .eq('automation', AUTOMATION)
        .eq('status', 'failed')
        .gte('created_at', oneHourAgo)

      if ((count ?? 0) > 4) {
        logger.log('error', AUTOMATION, 'Too many failures in the last hour; not auto-resuming', {
          runId: active.id,
          failuresLastHour: count,
        })
        return
      }

      await inngest.send({
        name: 'hercules/catalog.ingest',
        data: { runType: active.runType, triggeredBy: 'auto-resume-after-failure' },
      })
    },
  },
  async ({ event, step }) => {
    const startTime = Date.now()
    const config = getHerculesIngestionConfig()
    const requestedRunType: HerculesIngestionRunType =
      event.data.runType === 'delta' ? 'delta' : 'full'
    const triggeredBy = event.data.triggeredBy ?? 'event'

    const start = await step.run('start-or-resume-run', async () => {
      const { run, resumed } = await startOrResumeCatalogIngestion(buildDeps(), {
        runType: requestedRunType,
        pageSize: event.data.pageSize,
        triggeredBy,
      })

      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'hercules',
        targetSystem: 'prometheus',
        sourceRecordId: run.id,
        status: 'running',
        payload: {
          runId: run.id,
          runType: run.runType,
          resumed,
          nextOffset: run.nextOffset,
          pageSize: run.pageSize,
          updatedSince: run.updatedSince,
          triggeredBy,
        },
      })

      return { runId: run.id, resumed, runType: run.runType }
    })

    let lastResult: IngestCatalogPagesResult | null = null

    for (let i = 0; i < config.maxStepsPerRun; i++) {
      lastResult = await step.run(`ingest-pages-${i}`, () =>
        ingestCatalogPages(buildDeps(), {
          runId: start.runId,
          maxPages: config.pagesPerStep,
          lowRateLimitThreshold: config.lowRateLimitThreshold,
        })
      )

      if (lastResult.status === 'completed') break

      if (lastResult.status === 'rate_limited') {
        const resumeAt =
          lastResult.resumeAt ?? new Date(Date.now() + 5 * 60 * 1000).toISOString()
        logger.log('warn', AUTOMATION, 'Hercules rate limit reached; sleeping', {
          runId: start.runId,
          resumeAt,
        })
        await step.sleepUntil(`rate-limit-wait-${i}`, resumeAt)
      }
    }

    if (!lastResult || lastResult.status !== 'completed') {
      // Budget for this Inngest run is spent; chain a continuation so the
      // run keeps draining from its checkpoint in a fresh execution.
      await step.sendEvent('continue-ingestion', {
        name: 'hercules/catalog.ingest',
        data: { runType: start.runType, triggeredBy: 'continuation' },
      })

      return {
        runId: start.runId,
        completed: false,
        continued: true,
        nextOffset: lastResult?.nextOffset ?? null,
        totalRemote: lastResult?.totalRemote ?? null,
      }
    }

    const finalResult = lastResult

    await step.run('finalize-run', async () => {
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'hercules',
        targetSystem: 'prometheus',
        sourceRecordId: start.runId,
        status: 'success',
        payload: {
          runId: start.runId,
          runType: start.runType,
          triggeredBy,
          nextOffset: finalResult.nextOffset,
          totalRemote: finalResult.totalRemote,
        },
        response: finalResult.counters as unknown as Record<string, unknown>,
      })

      await updateSyncSchedule(AUTOMATION, {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: finalResult.counters.rowsRejected > 0 ? 'partial' : 'success',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: finalResult.counters.rowsSeen,
      })

      logger.log('info', AUTOMATION, 'Hercules catalog ingestion run completed', {
        runId: start.runId,
        runType: start.runType,
        counters: finalResult.counters,
      })
    })

    return {
      runId: start.runId,
      completed: true,
      continued: false,
      counters: finalResult.counters,
      totalRemote: finalResult.totalRemote,
    }
  }
)

/**
 * P10 delta cron: nightly incremental pull of parts changed since the
 * last completed run's watermark. Gated by the sync_schedules row
 * (inserted inactive by migration 024) so it stays off until the
 * initial full import is done and ops enables it.
 */
export const herculesCatalogDeltaCron = inngest.createFunction(
  {
    id: 'hercules-catalog-delta-cron',
    name: 'P10: Hercules Catalog Delta Sync (cron)',
    retries: 1,
    triggers: [{ cron: '0 6 * * *' }],
  },
  async ({ step }) => {
    if (!isHerculesApiConfigured()) {
      return { skipped: true, reason: 'Hercules API credentials not configured' }
    }

    if (!(await isP10ScheduleActive())) {
      return { skipped: true, reason: `${AUTOMATION} is disabled in sync_schedules` }
    }

    await step.sendEvent('trigger-delta-ingestion', {
      name: 'hercules/catalog.ingest',
      data: { runType: 'delta', triggeredBy: 'cron' },
    })

    return { skipped: false, triggered: 'delta' }
  }
)
