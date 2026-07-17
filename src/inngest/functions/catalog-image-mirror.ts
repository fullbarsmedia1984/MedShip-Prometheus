import { inngest } from '../client'
import { logger, logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEnrichmentConfig } from '@/lib/enrichment/env'
import {
  mirrorImageBatch,
  startOrResumeMirror,
  type ImageMirrorDeps,
  type MirrorBatchResult,
} from '@/lib/enrichment/image-mirror'
import { SupabaseEnrichmentRepository } from '@/lib/enrichment/repository'

const AUTOMATION = 'P17_CATALOG_IMAGE_MIRROR' as const

function buildDeps(): ImageMirrorDeps {
  return { repository: new SupabaseEnrichmentRepository() }
}

async function isP17ScheduleActive() {
  const { data, error } = await createAdminClient()
    .from('sync_schedules')
    .select('is_active')
    .eq('automation', AUTOMATION)
    .maybeSingle()

  if (error) {
    logger.log('warn', AUTOMATION, 'Could not read sync schedule; skipping mirror cron', {
      error: error.message,
    })
    return false
  }
  return data?.is_active === true
}

/**
 * P17: mirror known product-image URLs into the catalog-images
 * Storage bucket. Sources per item: the Hercules image_urls_json
 * (330k+ items, mostly medline.com) and images of linked competitor
 * products from P15. Spends no Firecrawl credits — downloads are
 * plain fetches. The keyset cursor in enrichment_runs makes the
 * 748k-item walk resumable across executions via continuation events.
 */
export const catalogImageMirror = inngest.createFunction(
  {
    id: 'enrichment-catalog-image-mirror',
    name: 'P17: Catalog Image Mirror (web -> Storage)',
    retries: 3,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: 'enrichment/images.mirror' }],
    onFailure: async ({ error }) => {
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'web',
        targetSystem: 'prometheus',
        status: 'failed',
        errorMessage: `Image mirror paused after exhausting retries: ${error.message}. Send another P17 event to resume from the checkpoint.`,
      })

      const active = await new SupabaseEnrichmentRepository().getActiveRun('image_mirror', null)
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
        name: 'enrichment/images.mirror',
        data: { triggeredBy: 'auto-resume-after-failure' },
      })
    },
  },
  async ({ event, step }) => {
    const startTime = Date.now()
    const config = getEnrichmentConfig()
    const triggeredBy = event.data.triggeredBy ?? 'event'

    const start = await step.run('start-or-resume-run', async () => {
      const deps = buildDeps()
      // Self-heals environments where the migration could not touch
      // storage.buckets; a no-op everywhere else.
      await deps.repository.ensureCatalogImagesBucket()

      const { run, resumed } = await startOrResumeMirror(deps, { triggeredBy })
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'web',
        targetSystem: 'prometheus',
        sourceRecordId: run.id,
        status: 'running',
        payload: { runId: run.id, resumed, triggeredBy, cursor: run.cursorJson },
      })
      return { runId: run.id, resumed }
    })

    let lastResult: MirrorBatchResult | null = null

    for (let i = 0; i < config.maxStepsPerRun; i++) {
      lastResult = await step.run(`mirror-batch-${i}`, () =>
        mirrorImageBatch(buildDeps(), {
          runId: start.runId,
          maxItems: config.imageItemsPerStep,
          concurrency: config.imageConcurrency,
          maxBytes: config.imageMaxBytes,
          timeoutMs: config.imageTimeoutMs,
        })
      )
      if (lastResult.status === 'completed') break
    }

    if (!lastResult || lastResult.status !== 'completed') {
      await step.sendEvent('continue-mirror', {
        name: 'enrichment/images.mirror',
        data: { triggeredBy: 'continuation' },
      })
      return { runId: start.runId, completed: false, continued: true, counters: lastResult?.counters }
    }

    const finalResult = lastResult

    await step.run('finalize-run', async () => {
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'web',
        targetSystem: 'prometheus',
        sourceRecordId: start.runId,
        status: 'success',
        payload: { runId: start.runId, triggeredBy },
        response: finalResult.counters,
      })

      await updateSyncSchedule(AUTOMATION, {
        lastRunAt: new Date().toISOString(),
        lastRunStatus:
          (finalResult.counters.sourceFailed ?? 0) + (finalResult.counters.hotlinkBlocked ?? 0) > 0
            ? 'partial'
            : 'success',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: finalResult.counters.mirrored ?? 0,
      })

      logger.log('info', AUTOMATION, 'Catalog image mirror run completed', {
        runId: start.runId,
        counters: finalResult.counters,
      })
    })

    return { runId: start.runId, completed: true, counters: finalResult.counters }
  }
)

/**
 * P17 daily cron: keep mirroring as new items and competitor links
 * appear. Gated by sync_schedules (seeded inactive).
 */
export const catalogImageMirrorCron = inngest.createFunction(
  {
    id: 'enrichment-catalog-image-mirror-cron',
    name: 'P17: Catalog Image Mirror (cron)',
    retries: 1,
    triggers: [{ cron: '0 5 * * *' }],
  },
  async ({ step }) => {
    if (!(await isP17ScheduleActive())) {
      return { skipped: true, reason: `${AUTOMATION} is disabled in sync_schedules` }
    }

    await step.sendEvent('trigger-image-mirror', {
      name: 'enrichment/images.mirror',
      data: { triggeredBy: 'cron' },
    })
    return { skipped: false }
  }
)
