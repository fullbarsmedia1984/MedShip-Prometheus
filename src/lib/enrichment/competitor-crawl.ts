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

/** Direct page fetches per batch; polite to the competitor's origin. */
const DIRECT_FETCH_CONCURRENCY = 3
const DIRECT_FETCH_TIMEOUT_MS = 30_000
const SUITECOMMERCE_PAGE_SIZE = 50
const MAX_URL_FAILS = 3

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
// URL filtering (pocketnurse)
// ------------------------------------------------------------------

const POCKETNURSE_NON_PRODUCT_SLUGS = new Set([
  'catalog-request',
  'email-subscribe',
  'about-us',
  'contact',
  'contact-us',
  'careers',
  'search',
  'cart',
  'wishlist',
  'login',
  'logout',
  'privacy-policy',
  'terms-and-conditions',
  'shipping-returns',
  'sitemap',
  'blog',
  'news',
  'faq',
])

/**
 * Magento product URLs on pocketnurse.com are single root-level slugs
 * under /default/ (e.g. /default/06-93-0056-demo-doser-...). Category
 * and account pages live under deeper paths and are excluded; slug
 * false-positives cost one free direct fetch and get marked
 * not_product by the parser.
 */
export function filterPocketnurseProductUrls(urls: string[]): string[] {
  const kept = new Set<string>()
  for (const raw of urls) {
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      continue
    }
    if (!/(^|\.)pocketnurse\.com$/i.test(parsed.hostname)) continue

    const match = parsed.pathname.match(/^\/default\/([a-z0-9][a-z0-9-]*)\/?$/i)
    if (!match) continue
    const slug = match[1].toLowerCase()
    if (POCKETNURSE_NON_PRODUCT_SLUGS.has(slug)) continue

    kept.add(`https://www.pocketnurse.com/default/${match[1]}`)
  }
  return [...kept]
}

// ------------------------------------------------------------------
// Direct fetch with Firecrawl fallback (pocketnurse)
// ------------------------------------------------------------------

type PageFetchResult =
  | { ok: true; html: string; viaFirecrawl: boolean }
  | { ok: false; reason: 'blocked' | 'fetch_error'; detail: string }

async function fetchPageDirect(
  url: string,
  fetchImpl: typeof fetch
): Promise<PageFetchResult | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DIRECT_FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    if (response.status === 403 || response.status === 429 || response.status === 503) {
      return null // looks bot-blocked; caller may try Firecrawl
    }
    if (!response.ok) {
      return { ok: false, reason: 'fetch_error', detail: `HTTP ${response.status}` }
    }

    const html = await response.text()
    // A served-but-empty shell also signals blocking/JS-walling.
    if (html.length < 5_000) return null
    return { ok: true, html, viaFirecrawl: false }
  } catch (error) {
    return {
      ok: false,
      reason: 'fetch_error',
      detail: error instanceof Error ? error.message : 'fetch failed',
    }
  } finally {
    clearTimeout(timeout)
  }
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
  input: { runId: string; maxUrls: number; dailyCreditBudget: number }
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

/**
 * Pocket Nurse: discover product URLs once per run via Firecrawl /map,
 * then drain the frontier with direct fetches (free) falling back to
 * Firecrawl /scrape (1 credit) only when the origin blocks us.
 */
async function crawlPocketnurseBatch(
  deps: CompetitorCrawlDeps,
  run: EnrichmentRunRecord,
  input: { maxUrls: number; dailyCreditBudget: number }
): Promise<CrawlBatchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const counters = readCounters(run)
  let creditsUsed = run.creditsUsed

  const spendCredits = async (n: number) => {
    creditsUsed += n
    await deps.repository.addCredits('competitor_crawl', n)
  }

  // Discovery once per run: /map the domain and seed the frontier.
  if (!run.cursorJson.discovered) {
    const spentToday = await deps.repository.getTodaysCredits('competitor_crawl')
    if (spentToday + 1 > input.dailyCreditBudget) {
      return { status: 'budget_exhausted', resumeAt: null, counters, creditsUsed }
    }

    try {
      const mapped = await withRetry(
        () => deps.getFirecrawl().map(`https://${COMPETITOR_DOMAINS.pocketnurse}`, { limit: 30_000 }),
        { ...apiRetryOptions(), retryOn: (e) => !(e instanceof FirecrawlInsufficientCreditsError) && isRetryableError(e) }
      )
      await spendCredits(1)

      const productUrls = filterPocketnurseProductUrls(mapped.links.map((l) => l.url))
      const inserted = await deps.repository.insertDiscoveredUrls('pocketnurse', productUrls)
      bump(counters, 'urlsDiscovered', inserted)

      await deps.repository.checkpointRun(run.id, {
        cursorJson: { ...run.cursorJson, discovered: true, mappedTotal: mapped.links.length },
        countersJson: counters,
        creditsUsed,
      })
    } catch (error) {
      if (error instanceof FirecrawlRateLimitError) {
        const resumeAt = new Date(Date.now() + (error.retryAfterMs ?? 5 * 60 * 1000)).toISOString()
        return { status: 'rate_limited', resumeAt, counters, creditsUsed }
      }
      if (error instanceof FirecrawlInsufficientCreditsError) {
        return { status: 'budget_exhausted', resumeAt: null, counters, creditsUsed }
      }
      throw error
    }
  }

  const claimed = await deps.repository.claimPendingUrls('pocketnurse', input.maxUrls)
  if (claimed.length === 0) {
    await deps.repository.completeRun(run.id, { status: 'completed' })
    return { status: 'completed', resumeAt: null, counters, creditsUsed }
  }

  let budgetExhausted = false
  let rateLimitedUntil: string | null = null

  await mapWithConcurrency(claimed, DIRECT_FETCH_CONCURRENCY, async (claimedUrl) => {
    try {
      let page = await fetchPageDirect(claimedUrl.url, fetchImpl)

      if (page === null) {
        // Origin blocked the plain fetch; try Firecrawl within budget.
        const spentToday = await deps.repository.getTodaysCredits('competitor_crawl')
        if (budgetExhausted || spentToday + 1 > input.dailyCreditBudget) {
          budgetExhausted = true
          return // stays pending for a future budget window
        }
        try {
          const scraped = await deps.getFirecrawl().scrape(claimedUrl.url, { formats: ['rawHtml'] })
          await spendCredits(1)
          bump(counters, 'firecrawlFallbacks')
          page = scraped.rawHtml
            ? { ok: true, html: scraped.rawHtml, viaFirecrawl: true }
            : { ok: false, reason: 'fetch_error', detail: 'Firecrawl returned no rawHtml' }
        } catch (error) {
          if (error instanceof FirecrawlRateLimitError) {
            rateLimitedUntil = new Date(
              Date.now() + (error.retryAfterMs ?? 5 * 60 * 1000)
            ).toISOString()
            return // stays pending
          }
          if (error instanceof FirecrawlInsufficientCreditsError) {
            budgetExhausted = true
            return // stays pending
          }
          page = {
            ok: false,
            reason: 'fetch_error',
            detail: error instanceof Error ? error.message : 'Firecrawl scrape failed',
          }
        }
      }

      if (!page.ok) {
        bump(counters, 'failed')
        await deps.repository.bumpUrlFailure(claimedUrl.id, page.detail, MAX_URL_FAILS)
        return
      }

      const parsed = parseCompetitorProductHtml(page.html, claimedUrl.url, 'pocketnurse')
      if (!parsed) {
        bump(counters, 'notProduct')
        await deps.repository.markUrl(claimedUrl.id, 'not_product')
        return
      }

      const result = await deps.repository.upsertCompetitorProduct(
        'pocketnurse',
        claimedUrl.url,
        parsed
      )
      bump(counters, 'urlsScraped')
      bump(counters, 'productsUpserted')
      if (result.isNew) bump(counters, 'productsNew')
      if (result.priceChanged) bump(counters, 'pricePoints')
      await deps.repository.markUrl(claimedUrl.id, 'scraped')
    } catch (error) {
      bump(counters, 'failed')
      await deps.repository.bumpUrlFailure(
        claimedUrl.id,
        error instanceof Error ? error.message : 'unknown error',
        MAX_URL_FAILS
      )
    }
  })

  await deps.repository.checkpointRun(run.id, {
    countersJson: counters,
    creditsUsed,
    itemsProcessed: (run.itemsProcessed ?? 0) + claimed.length,
  })

  if (rateLimitedUntil) {
    return { status: 'rate_limited', resumeAt: rateLimitedUntil, counters, creditsUsed }
  }
  if (budgetExhausted) {
    return { status: 'budget_exhausted', resumeAt: null, counters, creditsUsed }
  }

  const remaining = await deps.repository.countPendingUrls('pocketnurse')
  if (remaining === 0) {
    await deps.repository.completeRun(run.id, { status: 'completed' })
    return { status: 'completed', resumeAt: null, counters, creditsUsed }
  }
  return { status: 'in_progress', resumeAt: null, counters, creditsUsed }
}
