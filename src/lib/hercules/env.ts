import { HerculesApiClient, DEFAULT_HERCULES_API_BASE_URL } from './api-client'
import { HERCULES_MAX_PAGE_SIZE } from './catalog-ingestion'

/**
 * Typed access to Hercules API + ingestion environment configuration.
 * Business logic should use these helpers, never raw process.env.
 */

export type HerculesApiEnvConfig = {
  baseUrl: string
  appId: string
  accessToken: string
  timeoutMs: number
}

export type HerculesIngestionEnvConfig = {
  /** Egress page size; Hercules caps at 500. */
  pageSize: number
  /** Pages processed per Inngest step (one checkpointed unit of work). */
  pagesPerStep: number
  /** Steps per Inngest run before chaining a continuation event. */
  maxStepsPerRun: number
  /** Pause when X-RateLimit-Remaining drops to this value. */
  lowRateLimitThreshold: number
}

function intFromEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export function isHerculesApiConfigured() {
  return Boolean(process.env.HERCULES_API_APP_ID && process.env.HERCULES_API_ACCESS_TOKEN)
}

export function getHerculesApiConfig(): HerculesApiEnvConfig {
  const appId = process.env.HERCULES_API_APP_ID
  const accessToken = process.env.HERCULES_API_ACCESS_TOKEN

  const missing = [
    !appId && 'HERCULES_API_APP_ID',
    !accessToken && 'HERCULES_API_ACCESS_TOKEN',
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new Error(
      `Hercules API is not configured. Missing environment variables: ${missing.join(', ')}`
    )
  }

  return {
    baseUrl: process.env.HERCULES_API_BASE_URL || DEFAULT_HERCULES_API_BASE_URL,
    appId: appId as string,
    accessToken: accessToken as string,
    timeoutMs: intFromEnv('HERCULES_API_TIMEOUT_MS', 30_000, 1_000, 300_000),
  }
}

export function getHerculesIngestionConfig(): HerculesIngestionEnvConfig {
  return {
    pageSize: intFromEnv('HERCULES_INGEST_PAGE_SIZE', HERCULES_MAX_PAGE_SIZE, 1, HERCULES_MAX_PAGE_SIZE),
    pagesPerStep: intFromEnv('HERCULES_INGEST_PAGES_PER_STEP', 2, 1, 50),
    // Keep each Inngest run comfortably under ~15 minutes: observed
    // infrastructure kills runs at ~22.5 minutes ("upstream error"), so
    // long budgets must come from continuation-event chaining, not from
    // more steps per run. At ~100s/page, 6 steps x 2 pages ≈ 20 min max.
    maxStepsPerRun: intFromEnv('HERCULES_INGEST_MAX_STEPS_PER_RUN', 4, 1, 500),
    lowRateLimitThreshold: intFromEnv('HERCULES_INGEST_LOW_RATE_LIMIT_THRESHOLD', 10, 0, 100),
  }
}

export function createHerculesApiClientFromEnv() {
  const config = getHerculesApiConfig()
  return new HerculesApiClient({
    baseUrl: config.baseUrl,
    appId: config.appId,
    accessToken: config.accessToken,
    timeoutMs: config.timeoutMs,
  })
}
