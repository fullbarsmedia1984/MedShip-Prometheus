import {
  HerculesApiError,
  HerculesEnvelopeValidationError,
  HerculesRateLimitExceededError,
  type HerculesApiClient,
  type HerculesApiRequestBody,
  type HerculesRateLimit,
} from './api-client'
import { normalizeHerculesApiPart, type HerculesApiPart } from './api-source'
import {
  emptyImportCounters,
  importHerculesSupplierItemsBatch,
} from './importer'
import type {
  HerculesImportJobCounters,
  HerculesImportRepository,
  HerculesIngestionRepository,
  HerculesIngestionRunRecord,
  HerculesIngestionRunType,
  JsonObject,
} from './types'

/**
 * Resumable, page-by-page ingestion of the Hercules parts catalog.
 *
 * Hercules records land in the hercules_* staging tables as supplier/
 * manufacturer catalog data — never directly in canonical Zeus products.
 * Every page checkpoint persists the offset cursor so a crashed or
 * interrupted run continues where it stopped instead of restarting,
 * and every rejected record keeps its raw payload in
 * hercules_ingestion_rejects.
 */

export type CatalogIngestionDeps = {
  client: HerculesApiClient
  importRepository: HerculesImportRepository
  ingestionRepository: HerculesIngestionRepository
}

export type StartCatalogIngestionOptions = {
  runType: HerculesIngestionRunType
  pageSize?: number
  /** Explicit delta lower bound; defaults to the stored watermark. */
  updatedSince?: string
  triggeredBy?: string
}

export type StartCatalogIngestionResult = {
  run: HerculesIngestionRunRecord
  resumed: boolean
}

export type IngestCatalogPagesStatus = 'in_progress' | 'completed' | 'rate_limited'

export type IngestCatalogPagesResult = {
  runId: string
  status: IngestCatalogPagesStatus
  pagesProcessed: number
  nextOffset: number
  totalRemote: number | null
  counters: HerculesImportJobCounters
  /** When to retry after a rate-limit pause (ISO timestamp). */
  resumeAt: string | null
}

export type IngestCatalogPagesOptions = {
  runId: string
  /** Pages to process in this invocation before yielding back to the caller. */
  maxPages: number
  /** Pause when the remaining rate-limit budget drops to this value. */
  lowRateLimitThreshold?: number
  /**
   * In-process retries for network-level fetch failures (DNS, connect
   * timeout, reset). Errors the API actually responded with are never
   * retried here — the caller's retry machinery owns those.
   */
  transientRetries?: number
  sleep?: (ms: number) => Promise<void>
  /** Concurrent item writes per page (DB round-trips dominate page time). */
  writeConcurrency?: number
}

export const HERCULES_MAX_PAGE_SIZE = 500
const DEFAULT_LOW_RATE_LIMIT_THRESHOLD = 10
const RATE_LIMIT_FALLBACK_DELAY_MS = 5 * 60 * 1000

function clampPageSize(pageSize: number | undefined) {
  if (!pageSize || !Number.isFinite(pageSize)) return HERCULES_MAX_PAGE_SIZE
  return Math.min(Math.max(Math.trunc(pageSize), 1), HERCULES_MAX_PAGE_SIZE)
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return Number.isFinite(Date.parse(value)) ? value : null
}

function maxIso(left: string | null, right: string | null) {
  if (!left) return right
  if (!right) return left
  return Date.parse(right) > Date.parse(left) ? right : left
}

function rateLimitResumeAt(rateLimit: HerculesRateLimit) {
  const reset = isoOrNull(rateLimit.reset)
  if (reset) return reset
  return new Date(Date.now() + RATE_LIMIT_FALLBACK_DELAY_MS).toISOString()
}

function rateLimitSnapshot(rateLimit: HerculesRateLimit): JsonObject {
  return {
    limit: rateLimit.limit,
    remaining: rateLimit.remaining,
    reset: rateLimit.reset,
  }
}

function requestBodyForRun(run: HerculesIngestionRunRecord): HerculesApiRequestBody {
  const body: HerculesApiRequestBody = {
    limit: run.pageSize,
    offset: run.nextOffset,
  }

  if (run.runType === 'delta' && run.updatedSince) {
    body.filters = [{ field: 'updatedAt', operator: 'gte', value: run.updatedSince }]
  }

  // Always page over the unique, immutable _id. Timestamp sorts
  // (createdAt/updatedAt) carry heavy ties from bulk imports, and the
  // backend's sort is not stable within ties — offset pagination then
  // duplicates and silently skips records across pages (observed ~33%
  // duplication on the real catalog). Delta windowing comes from the
  // updatedAt filter above, not the sort.
  body.sortBy = '_id'
  body.sortOrder = 'ASC'

  return body
}

/**
 * Resume the active parts run if one exists, otherwise create a new one.
 * A delta run without a stored watermark (and no explicit updatedSince)
 * downgrades to a full run so nothing is silently skipped.
 */
export async function startOrResumeCatalogIngestion(
  deps: CatalogIngestionDeps,
  options: StartCatalogIngestionOptions
): Promise<StartCatalogIngestionResult> {
  const active = await deps.ingestionRepository.getActiveRun('parts')
  if (active) {
    return { run: active, resumed: true }
  }

  let runType = options.runType
  let updatedSince: string | null = null

  if (runType === 'delta') {
    updatedSince =
      isoOrNull(options.updatedSince) ??
      (await deps.ingestionRepository.getSyncWatermark('parts'))
    if (!updatedSince) {
      runType = 'full'
    }
  }

  const job = await deps.importRepository.createImportJob({
    sourceMode: 'api',
    supplierCode: null,
  })

  const run = await deps.ingestionRepository.createRun({
    resource: 'parts',
    runType,
    pageSize: clampPageSize(options.pageSize),
    updatedSince,
    importJobId: job.id,
    triggeredBy: options.triggeredBy ?? null,
  })

  return { run, resumed: false }
}

/**
 * Process up to maxPages pages from the run's checkpoint. Safe to call
 * repeatedly (and to re-call after a crash): the cursor only advances
 * after a page's records are fully upserted, and record upserts are
 * idempotent by source key.
 *
 * Throws on unexpected API/storage errors so the caller's retry
 * machinery (Inngest step retries) re-invokes from the last checkpoint.
 * Rate-limit exhaustion does not throw; it returns status 'rate_limited'
 * with a resumeAt timestamp.
 */
export async function ingestCatalogPages(
  deps: CatalogIngestionDeps,
  options: IngestCatalogPagesOptions
): Promise<IngestCatalogPagesResult> {
  const { client, importRepository, ingestionRepository } = deps
  const lowRateLimitThreshold =
    options.lowRateLimitThreshold ?? DEFAULT_LOW_RATE_LIMIT_THRESHOLD

  const run = await ingestionRepository.getRun(options.runId)
  if (!run) throw new Error(`Hercules ingestion run not found: ${options.runId}`)
  if (run.status !== 'running') {
    throw new Error(
      `Hercules ingestion run ${options.runId} is ${run.status}; cannot ingest pages`
    )
  }
  if (!run.importJobId) {
    throw new Error(`Hercules ingestion run ${options.runId} has no import job`)
  }

  const counters: HerculesImportJobCounters = { ...emptyImportCounters(), ...run.counters }
  let nextOffset = run.nextOffset
  let pagesFetched = run.pagesFetched
  let totalRemote = run.totalRemote
  let maxSourceUpdatedAt = run.maxSourceUpdatedAt
  let pagesProcessed = 0

  const result = (
    status: IngestCatalogPagesStatus,
    resumeAt: string | null = null
  ): IngestCatalogPagesResult => ({
    runId: run.id,
    status,
    pagesProcessed,
    nextOffset,
    totalRemote,
    counters,
    resumeAt,
  })

  const transientRetries = options.transientRetries ?? 3
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  while (pagesProcessed < options.maxPages) {
    let page
    let rateLimit
    let fetchAttempt = 0
    while (true) {
      try {
        ;({ page, rateLimit } = await client.listParts<HerculesApiPart>(
          requestBodyForRun({ ...run, nextOffset })
        ))
        break
      } catch (error) {
        if (error instanceof HerculesRateLimitExceededError) {
          return result('rate_limited', rateLimitResumeAt(client.lastRateLimit))
        }

        // API-level errors (auth, validation, malformed envelope) are not
        // transient; only network-level failures get retried in-process.
        const isTransient =
          !(error instanceof HerculesApiError) &&
          !(error instanceof HerculesEnvelopeValidationError)
        if (!isTransient || fetchAttempt >= transientRetries) throw error

        fetchAttempt += 1
        await sleep(Math.min(5_000 * fetchAttempt, 30_000))
      }
    }

    const pageEntries: Array<{
      recordIndex: number
      part: HerculesApiPart
      normalized: NonNullable<ReturnType<typeof normalizeHerculesApiPart>>
    }> = []

    for (const [recordIndex, rawPart] of page.data.entries()) {
      const part = rawPart as HerculesApiPart
      maxSourceUpdatedAt = maxIso(maxSourceUpdatedAt, isoOrNull(part.updatedAt))

      const normalized = normalizeHerculesApiPart(part, {
        useLegacyCostFallback: false,
      })

      if (!normalized) {
        counters.rowsSeen += 1
        counters.rowsRejected += 1
        await ingestionRepository.recordReject({
          runId: run.id,
          pageOffset: nextOffset,
          recordIndex,
          herculesItemId: null,
          errorMessage: 'Record has no usable identifier (_id or msId)',
          rawPayload: part,
        })
        continue
      }

      pageEntries.push({ recordIndex, part, normalized })
    }

    const writeResults = await importHerculesSupplierItemsBatch(
      pageEntries.map((entry) => entry.normalized),
      {
        repository: importRepository,
        jobId: run.importJobId,
        counters,
        concurrency: options.writeConcurrency,
      }
    )

    for (const [entryIndex, writeResult] of writeResults.entries()) {
      if (!writeResult.error) continue
      const entry = pageEntries[entryIndex]
      await ingestionRepository.recordReject({
        runId: run.id,
        pageOffset: nextOffset,
        recordIndex: entry.recordIndex,
        herculesItemId: entry.normalized.supplierItemId,
        errorMessage: writeResult.error.message,
        rawPayload: entry.part,
      })
    }

    nextOffset = page.metadata.offset + page.metadata.count
    pagesFetched += 1
    pagesProcessed += 1
    totalRemote = page.metadata.total

    await ingestionRepository.checkpointRun(run.id, {
      nextOffset,
      pagesFetched,
      totalRemote,
      counters,
      maxSourceUpdatedAt,
      rateLimitSnapshot: rateLimitSnapshot(rateLimit),
    })

    if (!page.metadata.hasNext || page.metadata.count === 0) {
      await completeCatalogIngestion(deps, { ...run, counters, maxSourceUpdatedAt })
      return result('completed')
    }

    if (rateLimit.remaining !== null && rateLimit.remaining <= lowRateLimitThreshold) {
      return result('rate_limited', rateLimitResumeAt(rateLimit))
    }
  }

  return result('in_progress')
}

async function completeCatalogIngestion(
  deps: CatalogIngestionDeps,
  run: HerculesIngestionRunRecord
) {
  await deps.ingestionRepository.completeRun(run.id, { status: 'completed' })

  if (run.importJobId) {
    await deps.importRepository.completeImportJob(run.importJobId, {
      status: run.counters.rowsRejected > 0 ? 'partial' : 'success',
      counters: run.counters,
      errors:
        run.counters.rowsRejected > 0
          ? [
              `${run.counters.rowsRejected} record(s) rejected; raw payloads preserved in hercules_ingestion_rejects for run ${run.id}`,
            ]
          : [],
    })
  }

  // Advance the delta watermark. Prefer the max source updatedAt we saw;
  // for full runs without one, the run start time is a safe lower bound
  // (anything modified after it is >= the watermark on the next delta).
  const watermark =
    run.maxSourceUpdatedAt ?? (run.runType === 'full' ? run.startedAt : null)
  if (watermark) {
    await deps.ingestionRepository.setSyncWatermark('parts', watermark, run.id)
  }
}

/**
 * Mark a run (and its import job) failed. Called when retries are
 * exhausted; the checkpoint survives, so a later start call cannot
 * resume it — inspect, fix, and start a new run (full or delta).
 */
export async function markCatalogIngestionFailed(
  deps: Pick<CatalogIngestionDeps, 'importRepository' | 'ingestionRepository'>,
  runId: string,
  errorMessage: string
) {
  const run = await deps.ingestionRepository.getRun(runId)
  if (!run || run.status !== 'running') return

  await deps.ingestionRepository.completeRun(runId, {
    status: 'failed',
    lastError: errorMessage,
  })

  if (run.importJobId) {
    await deps.importRepository.completeImportJob(run.importJobId, {
      status: 'failed',
      counters: run.counters,
      errors: [errorMessage],
    })
  }
}

/**
 * Cancel the active run so a fresh one can start.
 */
export async function cancelCatalogIngestion(
  deps: Pick<CatalogIngestionDeps, 'importRepository' | 'ingestionRepository'>,
  runId: string,
  reason: string
) {
  const run = await deps.ingestionRepository.getRun(runId)
  if (!run || run.status !== 'running') return

  await deps.ingestionRepository.completeRun(runId, {
    status: 'cancelled',
    lastError: reason,
  })

  if (run.importJobId) {
    await deps.importRepository.completeImportJob(run.importJobId, {
      status: 'failed',
      counters: run.counters,
      errors: [`Cancelled: ${reason}`],
    })
  }
}
