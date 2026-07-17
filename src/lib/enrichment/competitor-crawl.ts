import 'server-only'

import {
  FirecrawlInsufficientCreditsError,
  FirecrawlRateLimitError,
  type FirecrawlClient,
} from '@/lib/firecrawl/client'
import { withRetry, apiRetryOptions, isRetryableError } from '@/lib/utils/retry'
import { mapWithConcurrency } from './concurrency'
import { normalizeSuiteCommerceItem, parseCompetitorProductHtml } from './product-parser'
import type { SupabaseEnrichmentRepository } from './repository'
import type { Competitor, CrawlBatchStatus, EnrichmentRunRecord } from './types'
import { COMPETITOR_DOMAINS } from './types'

export type CompetitorCrawlDeps = {
  repository: SupabaseEnrichmentRepository
  /** Lazy so DiaMedical (API-only, no credits) works without a key. */
  getFirecrawl: () => FirecrawlClient
  fetchImpl?: typeof fetch
}

export type CrawlBatchResult = {
  status: CrawlBatchStatus
  resumeAt: string | null
  counters: Record<string, number>
  creditsUsed: number
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const SUITECOMMERCE_PAGE_SIZE = 50

// ------------------------------------------------------------------
// Run lifecycle
// ------------------------------------------------------------------

export async function startOrResumeCrawl(
  deps: CompetitorCrawlDeps,
  input: { competitor: Competitor; triggeredBy: string }
): Promise<{ run: EnrichmentRunRecord; resumed: boolean }> {
  const active = await deps.repository.getActiveRun('competitor_crawl', input.competitor)
  if (active) return { run: active, resumed: true }

  const run = await deps.repository.createRun({
    phase: 'competitor_crawl',
    competitor: input.competitor,
    triggeredBy: input.triggeredBy,
  })
  return { run, resumed: false }
}

export async function cancelCrawl(
  deps: CompetitorCrawlDeps,
  runId: string,
  reason: string
): Promise<void> {
  await deps.repository.completeRun(runId, { status: 'cancelled', lastError: reason })
}

// ------------------------------------------------------------------
// Batch crawling
// ------------------------------------------------------------------

function readCounters(run: EnrichmentRunRecord): Record<string, number> {
  return { ...run.countersJson }
}

function bump(counters: Record<string, number>, key: string, by = 1) {
  counters[key] = (counters[key] ?? 0) + by
}

/**
 * One checkpointed unit of crawl work. Returns instead of throwing on
 * rate limits and budget exhaustion so the Inngest layer can decide
 * whether to sleep, continue, or park the run.
 */
export async function crawlBatch(
  deps: CompetitorCrawlDeps,
  input: { runId: string; maxUrls: number; dailyCreditBudget: number; pocketnurseCrawlLimit: number }
): Promise<CrawlBatchResult> {
  const run = await deps.repository.getRun(input.runId)
  if (!run || run.status !== 'running') {
    return {
      status: 'completed',
      resumeAt: null,
      counters: run ? readCounters(run) : {},
      creditsUsed: run?.creditsUsed ?? 0,
    }
  }
  if (!run.competitor) throw new Error(`Crawl run ${run.id} has no competitor`)

  if (run.competitor === 'diamedical') {
    return crawlDiamedicalBatch(deps, run)
  }
  return crawlPocketnurseBatch(deps, run, input)
}

/**
 * DiaMedical: NetSuite SuiteCommerce serves the whole catalog from a
 * public JSON API — no scraping, no Firecrawl credits. One API page
 * per batch call keeps steps small and resumable.
 */
async function crawlDiamedicalBatch(
  deps: CompetitorCrawlDeps,
  run: EnrichmentRunRecord
): Promise<CrawlBatchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const counters = readCounters(run)
  const offset = Number(run.cursorJson.offset ?? 0)
  const baseUrl = `https://${COMPETITOR_DOMAINS.diamedical}`
  const apiUrl =
    `${baseUrl}/api/items?limit=${SUITECOMMERCE_PAGE_SIZE}&offset=${offset}` +
    `&fieldset=search&country=US&currency=USD&language=en`

  const page = await withRetry(async () => {
    const response = await fetchImpl(apiUrl, {
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`SuiteCommerce items API returned HTTP ${response.status}`)
    }
    return (await response.json()) as { total?: number; items?: unknown[] }
  }, apiRetryOptions())

  const items = Array.isArray(page.items) ? page.items : []
  const total = typeof page.total === 'number' ? page.total : null

  await mapWithConcurrency(items, 4, async (item) => {
    const normalized = normalizeSuiteCommerceItem(item, baseUrl)
    if (!normalized) {
      bump(counters, 'itemsSkipped')
      return
    }
    const result = await deps.repository.upsertCompetitorProduct(
      'diamedical',
      normalized.url,
      normalized.product
    )
    bump(counters, 'productsUpserted')
    if (result.isNew) bump(counters, 'productsNew')
    if (result.priceChanged) bump(counters, 'pricePoints')
  })

  bump(counters, 'apiPages')
  const nextOffset = offset + items.length
  const done = items.length === 0 || (total !== null && nextOffset >= total)

  await deps.repository.checkpointRun(run.id, {
    cursorJson: { ...run.cursorJson, offset: nextOffset, total },
    countersJson: counters,
    itemsProcessed: (run.itemsProcessed ?? 0) + items.length,
  })

  if (done) {
    await deps.repository.completeRun(run.id, { status: 'completed' })
    return { status: 'completed', resumeAt: null, counters, creditsUsed: run.creditsUsed }
  }
  return { status: 'in_progress', resumeAt: null, counters, creditsUsed: run.creditsUsed }
}

/** Wait this long between polls while the crawl job is still scraping. */
const CRAWL_POLL_INTERVAL_MS = 45_000

/**
 * Pocket Nurse (Magento, JS-walled, shallow sitemap): drive a Firecrawl
 * /crawl job that follows links across the live site and returns each
 * page's rawHtml. We parse the crawl results directly (the parser
 * returns null for non-product pages), so discovery and content come
 * from the one job — no separate /map or /scrape. The job id + a
 * skip offset live in the run cursor, so polling resumes across Inngest
 * executions. ~1 Firecrawl credit per page crawled, capped by
 * pocketnurseCrawlLimit.
 */
async function crawlPocketnurseBatch(
  deps: CompetitorCrawlDeps,
  run: EnrichmentRunRecord,
  input: { pocketnurseCrawlLimit: number }
): Promise<CrawlBatchResult> {
  const counters = readCounters(run)
  let creditsUsed = run.creditsUsed
  const cursor = run.cursorJson
  const crawlId = typeof cursor.crawlId === 'string' ? cursor.crawlId : null

  const firecrawlRetry = {
    ...apiRetryOptions(),
    retryOn: (e: unknown) =>
      !(e instanceof FirecrawlInsufficientCreditsError) && isRetryableError(e),
  }

  // Start the crawl job once per run, then let the crawler accumulate
  // pages before the first poll.
  if (!crawlId) {
    try {
      const { id } = await withRetry(
        () =>
          deps.getFirecrawl().startCrawl(`https://${COMPETITOR_DOMAINS.pocketnurse}`, {
            limit: input.pocketnurseCrawlLimit,
            formats: ['rawHtml'],
          }),
        firecrawlRetry
      )
      await deps.repository.checkpointRun(run.id, {
        cursorJson: { ...cursor, crawlId: id, pagesProcessed: 0 },
        countersJson: counters,
      })
    } catch (error) {
      if (error instanceof FirecrawlInsufficientCreditsError) {
        return { status: 'budget_exhausted', resumeAt: null, counters, creditsUsed }
      }
      if (error instanceof FirecrawlRateLimitError) {
        const resumeAt = new Date(Date.now() + (error.retryAfterMs ?? 5 * 60 * 1000)).toISOString()
        return { status: 'rate_limited', resumeAt, counters, creditsUsed }
      }
      throw error
    }
    return {
      status: 'rate_limited',
      resumeAt: new Date(Date.now() + CRAWL_POLL_INTERVAL_MS).toISOString(),
      counters,
      creditsUsed,
    }
  }

  // Poll the job from where we left off (stable append-only ordering).
  const pagesProcessed = Number(cursor.pagesProcessed ?? 0)
  let status
  try {
    status = await withRetry(
      () => deps.getFirecrawl().getCrawlStatus(crawlId, { skip: pagesProcessed }),
      firecrawlRetry
    )
  } catch (error) {
    if (error instanceof FirecrawlInsufficientCreditsError) {
      return { status: 'budget_exhausted', resumeAt: null, counters, creditsUsed }
    }
    if (error instanceof FirecrawlRateLimitError) {
      const resumeAt = new Date(Date.now() + (error.retryAfterMs ?? 5 * 60 * 1000)).toISOString()
      return { status: 'rate_limited', resumeAt, counters, creditsUsed }
    }
    throw error
  }

  // Record the job's cumulative credit spend as a delta into the ledger.
  if (status.creditsUsed > creditsUsed) {
    await deps.repository.addCredits('competitor_crawl', status.creditsUsed - creditsUsed)
    creditsUsed = status.creditsUsed
  }

  for (const page of status.data) {
    bump(counters, 'pagesCrawled')
    if (!page.rawHtml) continue
    const pageUrl = page.metadata.sourceURL ?? `https://${COMPETITOR_DOMAINS.pocketnurse}`
    const parsed = parseCompetitorProductHtml(page.rawHtml, pageUrl, 'pocketnurse')
    if (!parsed) {
      bump(counters, 'notProduct')
      continue
    }
    const result = await deps.repository.upsertCompetitorProduct('pocketnurse', pageUrl, parsed)
    bump(counters, 'productsUpserted')
    if (result.isNew) bump(counters, 'productsNew')
    if (result.priceChanged) bump(counters, 'pricePoints')
  }

  const newProcessed = pagesProcessed + status.data.length
  await deps.repository.checkpointRun(run.id, {
    cursorJson: { ...cursor, crawlId, pagesProcessed: newProcessed },
    countersJson: counters,
    creditsUsed,
    itemsProcessed: newProcessed,
  })

  // Terminal: job finished and we've drained all its results.
  if (
    (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') &&
    status.data.length === 0
  ) {
    await deps.repository.completeRun(run.id, {
      status: 'completed',
      lastError: status.status === 'completed' ? null : `crawl job ${status.status}`,
    })
    return { status: 'completed', resumeAt: null, counters, creditsUsed }
  }

  // Still scraping with nothing new yet: wait before re-polling.
  if (status.data.length === 0) {
    return {
      status: 'rate_limited',
      resumeAt: new Date(Date.now() + CRAWL_POLL_INTERVAL_MS).toISOString(),
      counters,
      creditsUsed,
    }
  }

  // Got a page of results; more are likely ready — keep draining promptly.
  return { status: 'in_progress', resumeAt: null, counters, creditsUsed }
}
