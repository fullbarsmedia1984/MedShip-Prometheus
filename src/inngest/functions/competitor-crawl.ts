import { inngest } from '../client'
import { logger, logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  crawlBatch,
  startOrResumeCrawl,
  type CompetitorCrawlDeps,
  type CrawlBatchResult,
} from '@/lib/enrichment/competitor-crawl'
import {
  createFirecrawlClientFromEnv,
  getEnrichmentConfig,
  isFirecrawlConfigured,
} from '@/lib/enrichment/env'
import { runExactMatching, runFuzzyMatching } from '@/lib/enrichment/matching'
import { SupabaseEnrichmentRepository } from '@/lib/enrichment/repository'
import { COMPETITORS, type Competitor } from '@/lib/enrichment/types'

const AUTOMATION = 'P16_COMPETITOR_CRAWL' as const

function buildDeps(): CompetitorCrawlDeps {
  return {
    repository: new SupabaseEnrichmentRepository(),
    getFirecrawl: () => createFirecrawlClientFromEnv(),
  }
}

async function isP16ScheduleActive() {
  const { data, error } = await createAdminClient()
    .from('sync_schedules')
    .select('is_active')
    .eq('automation', AUTOMATION)
    .maybeSingle()

  if (error) {
    logger.log('warn', AUTOMATION, 'Could not read sync schedule; skipping crawl cron', {
      error: error.message,
    })
    return false
  }
  return data?.is_active === true
}

/** Next 00:05 UTC — when the daily Firecrawl credit budget resets. */
function nextBudgetResetIso(): string {
  const next = new Date()
  next.setUTCDate(next.getUTCDate() + 1)
  next.setUTCHours(0, 5, 0, 0)
  return next.toISOString()
}

/**
 * P16: competitor catalogs -> competitor_products + price history.
 *
 * Pocket Nurse is discovered via Firecrawl /map and scraped page by
 * page (direct fetch first, Firecrawl fallback, budget-capped).
 * DiaMedical is paged straight out of its public SuiteCommerce items
 * API at zero credit cost. Runs checkpoint in enrichment_runs; when a
 * run needs more work than one Inngest execution allows, it chains a
 * continuation event. After a crawl completes, exact + fuzzy matching
 * link the products to hercules_catalog_items.
 */
export const competitorCrawl = inngest.createFunction(
  {
    id: 'enrichment-competitor-crawl',
    name: 'P16: Competitor Catalog Crawl (web -> Prometheus)',
    retries: 3,
    // One crawl per competitor at a time; the run cursor is single-writer.
    concurrency: [{ limit: 1, key: 'event.data.competitor' }],
    triggers: [{ event: 'enrichment/competitor.crawl' }],
    onFailure: async ({ event, error }) => {
      const competitor = (event?.data?.event?.data?.competitor ?? 'unknown') as string
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'web',
        targetSystem: 'prometheus',
        status: 'failed',
        errorMessage: `Crawl paused after exhausting retries (${competitor}): ${error.message}. Send another P15 event to resume from the checkpoint.`,
      })

      if (competitor !== 'pocketnurse' && competitor !== 'diamedical') return
      const active = await new SupabaseEnrichmentRepository().getActiveRun(
        'competitor_crawl',
        competitor
      )
      if (!active) return

      // Crash-loop guard: stop auto-resuming when failures pile up.
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
        name: 'enrichment/competitor.crawl',
        data: { competitor, triggeredBy: 'auto-resume-after-failure' },
      })
    },
  },
  async ({ event, step }) => {
    const startTime = Date.now()
    const config = getEnrichmentConfig()
    const competitor = event.data.competitor as Competitor
    if (competitor !== 'pocketnurse' && competitor !== 'diamedical') {
      return { skipped: true, reason: `Unknown competitor: ${String(event.data.competitor)}` }
    }
    // DiaMedical never spends credits; Pocket Nurse needs the key for
    // the Firecrawl /crawl discovery job.
    if (competitor === 'pocketnurse' && !isFirecrawlConfigured()) {
      return { skipped: true, reason: 'FIRECRAWL_API_KEY is not configured' }
    }
    const triggeredBy = event.data.triggeredBy ?? 'event'

    // A continuation event only ever resumes the run it belongs to. If
    // that run already finished (e.g. a continuation queued before a
    // redeploy fires afterward), do nothing — otherwise we'd start a
    // fresh full crawl, which for Pocket Nurse means a new billed
    // Firecrawl /crawl job.
    const isContinuation = /continuation|auto-resume/i.test(triggeredBy)
    if (isContinuation) {
      const active = await new SupabaseEnrichmentRepository().getActiveRun(
        'competitor_crawl',
        competitor
      )
      if (!active) {
        return { skipped: true, reason: 'no active run to continue' }
      }
    }

    const start = await step.run('start-or-resume-run', async () => {
      const { run, resumed } = await startOrResumeCrawl(buildDeps(), { competitor, triggeredBy })
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'web',
        targetSystem: 'prometheus',
        sourceRecordId: run.id,
        status: 'running',
        payload: { runId: run.id, competitor, resumed, triggeredBy },
      })
      return { runId: run.id, resumed }
    })

    let lastResult: CrawlBatchResult | null = null

    for (let i = 0; i < config.maxStepsPerRun; i++) {
      lastResult = await step.run(`crawl-batch-${i}`, () =>
        crawlBatch(buildDeps(), {
          runId: start.runId,
          maxUrls: config.crawlUrlsPerStep,
          dailyCreditBudget: config.crawlDailyCreditBudget,
          pocketnurseCrawlLimit: config.pocketnurseCrawlLimit,
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
      // Daily credits are spent. Park until the ledger resets, then
      // chain a continuation so the run finishes over multiple days.
      const resumeAt = nextBudgetResetIso()
      logger.log('warn', AUTOMATION, 'Daily crawl credit budget exhausted; resuming tomorrow', {
        runId: start.runId,
        resumeAt,
      })
      await step.sleepUntil('budget-wait', resumeAt)
      await step.sendEvent('continue-after-budget', {
        name: 'enrichment/competitor.crawl',
        data: { competitor, triggeredBy: 'budget-continuation' },
      })
      return { runId: start.runId, completed: false, continued: true, reason: 'budget_exhausted' }
    }

    if (!lastResult || lastResult.status !== 'completed') {
      await step.sendEvent('continue-crawl', {
        name: 'enrichment/competitor.crawl',
        data: { competitor, triggeredBy: 'continuation' },
      })
      return { runId: start.runId, completed: false, continued: true }
    }

    const finalResult = lastResult

    // Link freshly crawled products to catalog items. Exact passes are
    // cheap; fuzzy is keyset-batched and bounded per run.
    const matching = await step.run('run-matching', async () => {
      const exact = await runExactMatching()
      const fuzzy = await runFuzzyMatching({ batchSize: 500, maxBatches: 20 })
      return { exact, fuzzy }
    })

    await step.run('finalize-run', async () => {
      await logSyncEvent({
        automation: AUTOMATION,
        sourceSystem: 'web',
        targetSystem: 'prometheus',
        sourceRecordId: start.runId,
        status: 'success',
        payload: { runId: start.runId, competitor, triggeredBy, matching },
        response: finalResult.counters,
      })

      await updateSyncSchedule(AUTOMATION, {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: (finalResult.counters.failed ?? 0) > 0 ? 'partial' : 'success',
        lastRunDurationMs: Date.now() - startTime,
        recordsProcessed: finalResult.counters.productsUpserted ?? 0,
      })

      logger.log('info', AUTOMATION, 'Competitor crawl completed', {
        runId: start.runId,
        competitor,
        counters: finalResult.counters,
        matching,
      })
    })

    return {
      runId: start.runId,
      completed: true,
      counters: finalResult.counters,
      matching,
    }
  }
)

/**
 * P16 weekly cron: re-crawl both competitor catalogs for price and
 * assortment freshness. Gated by sync_schedules (seeded inactive).
 */
export const competitorCrawlCron = inngest.createFunction(
  {
    id: 'enrichment-competitor-crawl-cron',
    name: 'P16: Competitor Catalog Crawl (cron)',
    retries: 1,
    triggers: [{ cron: '0 4 * * 0' }],
  },
  async ({ step }) => {
    if (!(await isP16ScheduleActive())) {
      return { skipped: true, reason: `${AUTOMATION} is disabled in sync_schedules` }
    }

    const triggered: Competitor[] = []
    for (const competitor of COMPETITORS) {
      if (competitor === 'pocketnurse' && !isFirecrawlConfigured()) continue
      await step.sendEvent(`trigger-crawl-${competitor}`, {
        name: 'enrichment/competitor.crawl',
        data: { competitor, triggeredBy: 'cron' },
      })
      triggered.push(competitor)
    }

    return { skipped: false, triggered }
  }
)
