import { inngest } from '../client'
import { logger, logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createFirecrawlClientFromEnv,
  getEnrichmentConfig,
  isFirecrawlConfigured,
} from '@/lib/enrichment/env'
import { SupabaseEnrichmentRepository } from '@/lib/enrichment/repository'
import {
  searchSweepBatch,
  startOrResumeSearchSweep,
  type SearchSweepBatchResult,
  type SearchSweepDeps,
} from '@/lib/enrichment/search-sweep'

const AUTOMATION = 'P18_IMAGE_SEARCH_SWEEP' as const

function buildDeps(): SearchSweepDeps {
  return {
    repository: new SupabaseEnrichmentRepository(),
    getFirecrawl: () => createFirecrawlClientFromEnv(),
  }
}

async function isP18ScheduleActive() {
  const { data, error } = await createAdminClient()
    .from('sync_schedules')
    .select('is_active')
    .eq('automation', AUTOMATION)
    .maybeSingle()

  if (error) {
    logger.log('warn', AUTOMATION, 'Could not read sync schedule; skipping sweep cron', {
      error: error.message,
    })
    return false
  }
  return data?.is_active === true
}

/**
 * P18: Firecrawl image search for catalog items that P17 could not
 * cover from any known source. Strictly budget-capped per day; every
 * searched item's attempt counter bumps whether or not an image was
 * found, so the sweep converges over the long tail instead of
 * re-searching the same items.
 */
export const imageSearchSweep = inngest.createFunction(
  {
    id: 'enrichment-image-search-sweep',
    name: 'P18: Image Search Sweep (Firecrawl -> Storage)',
    retries: 3,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: 'enrichment/images.search' }],
    onFailure: async ({ error }) => {
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'firecrawl',
        targetSystem: 'prometheus',
        status: 'failed',
        errorMessage: `Search sweep paused after exhausting retries: ${error.message}. Send another P18 event to resume.`,
      })
      // No auto-resume: the sweep is discretionary spend, and the
      // daily cron will pick the run back up tomorrow anyway.
    },
  },
  async ({ event, step }) => {
    const startTime = Date.now()
    const config = getEnrichmentConfig()
    const triggeredBy = event.data.triggeredBy ?? 'event'

    if (!isFirecrawlConfigured()) {
      return { skipped: true, reason: 'FIRECRAWL_API_KEY is not configured' }
    }

    const start = await step.run('start-or-resume-run', async () => {
      const { run, resumed } = await startOrResumeSearchSweep(buildDeps(), { triggeredBy })
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'firecrawl',
        targetSystem: 'prometheus',
        sourceRecordId: run.id,
        status: 'running',
        payload: { runId: run.id, resumed, triggeredBy },
      })
      return { runId: run.id, resumed }
    })

    let lastResult: SearchSweepBatchResult | null = null

    for (let i = 0; i < config.maxStepsPerRun; i++) {
      lastResult = await step.run(`sweep-batch-${i}`, () =>
        searchSweepBatch(buildDeps(), {
          runId: start.runId,
          maxItems: config.searchItemsPerStep,
          dailyCreditBudget: config.searchDailyCreditBudget,
          maxBytes: config.imageMaxBytes,
          timeoutMs: config.imageTimeoutMs,
        })
      )

      if (lastResult.status === 'completed' || lastResult.status === 'budget_exhausted') break

      if (lastResult.status === 'rate_limited') {
        const resumeAt = lastResult.resumeAt ?? new Date(Date.now() + 5 * 60 * 1000).toISOString()
        logger.log('warn', AUTOMATION, 'Firecrawl rate limit reached; sleeping', {
          runId: start.runId,
          resumeAt,
        })
        await step.sleepUntil(`rate-limit-wait-${i}`, resumeAt)
      }
    }

    if (lastResult && lastResult.status === 'budget_exhausted') {
      // Park the run; tomorrow's cron resumes it under a fresh budget.
      logger.log('warn', AUTOMATION, 'Daily search credit budget exhausted; parking run', {
        runId: start.runId,
      })
      return { runId: start.runId, completed: false, parked: true, reason: 'budget_exhausted' }
    }

    if (!lastResult || lastResult.status !== 'completed') {
      await step.sendEvent('continue-sweep', {
        name: 'enrichment/images.search',
        data: { triggeredBy: 'continuation' },
      })
      return { runId: start.runId, completed: false, continued: true, counters: lastResult?.counters }
    }

    const finalResult = lastResult

    await step.run('finalize-run', async () => {
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'firecrawl',
        targetSystem: 'prometheus',
        sourceRecordId: start.runId,
        status: 'success',
        payload: { runId: start.runId, triggeredBy },
        response: finalResult.counters,
      })

      await updateSyncSchedule(AUTOMATION, {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: 'success',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: finalResult.counters.mirroredFromSearch ?? 0,
      })

      logger.log('info', AUTOMATION, 'Image search sweep completed', {
        runId: start.runId,
        counters: finalResult.counters,
      })
    })

    return { runId: start.runId, completed: true, counters: finalResult.counters }
  }
)

/**
 * P18 daily cron: resumes or starts the sweep each day under a fresh
 * credit budget. Gated by sync_schedules (seeded inactive).
 */
export const imageSearchSweepCron = inngest.createFunction(
  {
    id: 'enrichment-image-search-sweep-cron',
    name: 'P18: Image Search Sweep (cron)',
    retries: 1,
    triggers: [{ cron: '0 7 * * *' }],
  },
  async ({ step }) => {
    if (!isFirecrawlConfigured()) {
      return { skipped: true, reason: 'FIRECRAWL_API_KEY is not configured' }
    }
    if (!(await isP18ScheduleActive())) {
      return { skipped: true, reason: `${AUTOMATION} is disabled in sync_schedules` }
    }

    await step.sendEvent('trigger-search-sweep', {
      name: 'enrichment/images.search',
      data: { triggeredBy: 'cron' },
    })
    return { skipped: false }
  }
)
