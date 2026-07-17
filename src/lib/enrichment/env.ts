import { DEFAULT_FIRECRAWL_BASE_URL, FirecrawlClient } from '@/lib/firecrawl/client'

/**
 * Typed access to enrichment environment configuration.
 * Business logic should use these helpers, never raw process.env.
 */

export type FirecrawlEnvConfig = {
  apiKey: string
  baseUrl: string
  timeoutMs: number
}

export type EnrichmentEnvConfig = {
  /** Frontier URLs scraped per Inngest step (one checkpointed unit of work). */
  crawlUrlsPerStep: number
  /** Steps per Inngest run before chaining a continuation event. */
  maxStepsPerRun: number
  /** Firecrawl credits P15 may spend per day (all competitors combined). */
  crawlDailyCreditBudget: number
  /** Firecrawl credits P17 may spend per day. */
  searchDailyCreditBudget: number
  /** Catalog items examined per P16 step. */
  imageItemsPerStep: number
  /** Concurrent image downloads within a step. */
  imageConcurrency: number
  /** Reject images larger than this many bytes (bucket cap is 5 MB). */
  imageMaxBytes: number
  imageTimeoutMs: number
  /** Items handled per P17 step. */
  searchItemsPerStep: number
}

function intFromEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export function isFirecrawlConfigured() {
  return Boolean(process.env.FIRECRAWL_API_KEY)
}

export function getFirecrawlConfig(): FirecrawlEnvConfig {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    throw new Error('Firecrawl is not configured. Missing environment variable: FIRECRAWL_API_KEY')
  }
  return {
    apiKey,
    baseUrl: process.env.FIRECRAWL_API_BASE_URL || DEFAULT_FIRECRAWL_BASE_URL,
    timeoutMs: intFromEnv('FIRECRAWL_TIMEOUT_MS', 60_000, 1_000, 300_000),
  }
}

export function createFirecrawlClientFromEnv() {
  const config = getFirecrawlConfig()
  return new FirecrawlClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  })
}

export function getEnrichmentConfig(): EnrichmentEnvConfig {
  return {
    crawlUrlsPerStep: intFromEnv('ENRICHMENT_CRAWL_URLS_PER_STEP', 20, 1, 100),
    // Same infrastructure ceiling as P10: keep each Inngest run well
    // under ~15 minutes and chain continuation events for long work.
    maxStepsPerRun: intFromEnv('ENRICHMENT_MAX_STEPS_PER_RUN', 4, 1, 500),
    crawlDailyCreditBudget: intFromEnv('ENRICHMENT_CRAWL_DAILY_CREDIT_BUDGET', 2_000, 1, 1_000_000),
    searchDailyCreditBudget: intFromEnv('ENRICHMENT_SEARCH_DAILY_CREDIT_BUDGET', 500, 1, 1_000_000),
    imageItemsPerStep: intFromEnv('ENRICHMENT_IMAGE_ITEMS_PER_STEP', 100, 1, 1_000),
    imageConcurrency: intFromEnv('ENRICHMENT_IMAGE_CONCURRENCY', 6, 1, 16),
    imageMaxBytes: intFromEnv('ENRICHMENT_IMAGE_MAX_BYTES', 5_242_880, 1_024, 5_242_880),
    imageTimeoutMs: intFromEnv('ENRICHMENT_IMAGE_TIMEOUT_MS', 15_000, 1_000, 120_000),
    searchItemsPerStep: intFromEnv('ENRICHMENT_SEARCH_ITEMS_PER_STEP', 25, 1, 500),
  }
}
