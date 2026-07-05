import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HerculesApiClient } from '../api-client'
import type { HerculesApiPart } from '../api-source'
import {
  ingestCatalogPages,
  markCatalogIngestionFailed,
  startOrResumeCatalogIngestion,
  type CatalogIngestionDeps,
} from '../catalog-ingestion'
import {
  apiPartWithMultipleVendors,
  apiPartWithNumericCost,
  herculesApiEnvelope,
  herculesApiPartsPage,
} from '../api-fixtures'
import {
  InMemoryHerculesImportRepository,
  InMemoryHerculesIngestionRepository,
} from '../in-memory-repository'

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function partAt(index: number, updatedAt?: string): HerculesApiPart {
  return {
    ...apiPartWithNumericCost,
    _id: `catalog-part-${index}`,
    msId: `MS-catalog-${index}`,
    manufacturerPartNumber: `CAT-MPN-${index}`,
    updatedAt: updatedAt ?? `2026-06-0${(index % 5) + 1}T00:00:00.000Z`,
  }
}

/**
 * Serves a fixed catalog in pages, honoring limit/offset from the
 * request body like the real egress endpoint.
 */
function pagedCatalogFetch(
  parts: HerculesApiPart[],
  options: {
    rateLimitRemaining?: (call: number) => number
    failOnCall?: number
  } = {}
) {
  const calls: Array<{ limit: number; offset: number; body: Record<string, unknown> }> = []

  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    const limit = Number(body.limit ?? 10)
    const offset = Number(body.offset ?? 0)
    calls.push({ limit, offset, body })

    if (options.failOnCall !== undefined && calls.length === options.failOnCall) {
      throw new Error('Simulated network crash')
    }

    const pageData = parts.slice(offset, offset + limit)
    const remaining = options.rateLimitRemaining?.(calls.length) ?? 100

    return jsonResponse(
      herculesApiEnvelope(
        herculesApiPartsPage(pageData, { limit, offset, total: parts.length })
      ),
      {
        'X-RateLimit-Limit': '200',
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': '2026-06-03T13:00:00.000Z',
      }
    )
  }

  return { fetchImpl, calls }
}

function buildDeps(fetchImpl: typeof fetch): CatalogIngestionDeps & {
  importRepository: InMemoryHerculesImportRepository
  ingestionRepository: InMemoryHerculesIngestionRepository
} {
  return {
    client: new HerculesApiClient({
      appId: 'test-app',
      accessToken: 'test-token',
      fetchImpl,
    }),
    importRepository: new InMemoryHerculesImportRepository(),
    ingestionRepository: new InMemoryHerculesIngestionRepository(),
  }
}

describe('catalog ingestion engine', () => {
  it('ingests a multi-page catalog to completion and sets the watermark', async () => {
    const parts = Array.from({ length: 5 }, (_, index) =>
      partAt(index, `2026-06-0${index + 1}T00:00:00.000Z`)
    )
    const { fetchImpl, calls } = pagedCatalogFetch(parts)
    const deps = buildDeps(fetchImpl)

    const { run, resumed } = await startOrResumeCatalogIngestion(deps, {
      runType: 'full',
      pageSize: 2,
      triggeredBy: 'test',
    })
    assert.equal(resumed, false)
    assert.equal(run.runType, 'full')

    const result = await ingestCatalogPages(deps, { runId: run.id, maxPages: 10 })

    assert.equal(result.status, 'completed')
    assert.equal(result.counters.rowsSeen, 5)
    assert.equal(result.counters.rowsRejected, 0)
    assert.equal(result.nextOffset, 5)
    assert.equal(result.totalRemote, 5)
    // 3 pages of 2/2/1; the last page reports hasNext=false.
    assert.equal(calls.length, 3)
    // Full runs page over the stable, unique _id sort.
    assert.equal(calls[0].body.sortBy, '_id')

    assert.equal(deps.importRepository.catalogItems.size, 5)
    const finished = await deps.ingestionRepository.getRun(run.id)
    assert.equal(finished?.status, 'completed')
    assert.equal(finished?.counters.rowsSeen, 5)

    // Watermark is the max source updatedAt observed.
    assert.equal(
      await deps.ingestionRepository.getSyncWatermark('parts'),
      '2026-06-05T00:00:00.000Z'
    )

    // The linked import job is completed with the run counters.
    assert.equal(deps.importRepository.getImportJob(run.importJobId as string)?.status, 'success')
  })

  it('checkpoints per page and resumes after a crash without refetching earlier pages', async () => {
    const parts = Array.from({ length: 6 }, (_, index) => partAt(index))
    // Crash on the 3rd fetch (offset 4).
    const { fetchImpl, calls } = pagedCatalogFetch(parts, { failOnCall: 3 })
    const deps = buildDeps(fetchImpl)

    const { run } = await startOrResumeCatalogIngestion(deps, {
      runType: 'full',
      pageSize: 2,
    })

    await assert.rejects(
      () => ingestCatalogPages(deps, { runId: run.id, maxPages: 10, transientRetries: 0 }),
      /Simulated network crash/
    )

    // Two pages landed before the crash; checkpoint survived on the run.
    const crashed = await deps.ingestionRepository.getRun(run.id)
    assert.equal(crashed?.status, 'running')
    assert.equal(crashed?.nextOffset, 4)
    assert.equal(crashed?.counters.rowsSeen, 4)

    // A new start call resumes the same run instead of restarting.
    const resumed = await startOrResumeCatalogIngestion(deps, { runType: 'full' })
    assert.equal(resumed.resumed, true)
    assert.equal(resumed.run.id, run.id)

    const result = await ingestCatalogPages(deps, { runId: run.id, maxPages: 10 })
    assert.equal(result.status, 'completed')
    assert.equal(result.counters.rowsSeen, 6)

    // Resume continued at offset 4 — earlier pages were not refetched.
    const offsets = calls.map((call) => call.offset)
    assert.deepEqual(offsets, [0, 2, 4, 4])
    assert.equal(deps.importRepository.catalogItems.size, 6)
  })

  it('retries transient network failures in-process without losing the page', async () => {
    const parts = Array.from({ length: 4 }, (_, index) => partAt(index))
    // The 2nd fetch dies at the network level; the in-process retry
    // should re-issue it and finish the run in one invocation.
    const { fetchImpl, calls } = pagedCatalogFetch(parts, { failOnCall: 2 })
    const deps = buildDeps(fetchImpl)
    const sleeps: number[] = []

    const { run } = await startOrResumeCatalogIngestion(deps, {
      runType: 'full',
      pageSize: 2,
    })

    const result = await ingestCatalogPages(deps, {
      runId: run.id,
      maxPages: 10,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    assert.equal(result.status, 'completed')
    assert.equal(result.counters.rowsSeen, 4)
    assert.deepEqual(sleeps, [5000])
    // Offsets: page 0, failed fetch at 2, retried 2.
    assert.deepEqual(calls.map((call) => call.offset), [0, 2, 2])
  })

  it('stops mid-run when the page budget is spent and reports in_progress', async () => {
    const parts = Array.from({ length: 6 }, (_, index) => partAt(index))
    const { fetchImpl } = pagedCatalogFetch(parts)
    const deps = buildDeps(fetchImpl)

    const { run } = await startOrResumeCatalogIngestion(deps, {
      runType: 'full',
      pageSize: 2,
    })

    const first = await ingestCatalogPages(deps, { runId: run.id, maxPages: 2 })
    assert.equal(first.status, 'in_progress')
    assert.equal(first.nextOffset, 4)

    const second = await ingestCatalogPages(deps, { runId: run.id, maxPages: 2 })
    assert.equal(second.status, 'completed')
    assert.equal(second.counters.rowsSeen, 6)
  })

  it('pauses when the rate-limit budget runs low', async () => {
    const parts = Array.from({ length: 6 }, (_, index) => partAt(index))
    const { fetchImpl } = pagedCatalogFetch(parts, {
      rateLimitRemaining: (call) => (call >= 2 ? 5 : 100),
    })
    const deps = buildDeps(fetchImpl)

    const { run } = await startOrResumeCatalogIngestion(deps, {
      runType: 'full',
      pageSize: 2,
    })

    const result = await ingestCatalogPages(deps, {
      runId: run.id,
      maxPages: 10,
      lowRateLimitThreshold: 10,
    })

    assert.equal(result.status, 'rate_limited')
    assert.equal(result.resumeAt, '2026-06-03T13:00:00.000Z')
    // The page that carried the low header was still checkpointed.
    assert.equal(result.nextOffset, 4)

    const paused = await deps.ingestionRepository.getRun(run.id)
    assert.equal(paused?.status, 'running')
  })

  it('rejects unusable records but preserves their raw payload and finishes partial', async () => {
    const broken: HerculesApiPart = { description: 'no identifiers at all' }
    const parts = [partAt(0), broken, apiPartWithMultipleVendors]
    const { fetchImpl } = pagedCatalogFetch(parts)
    const deps = buildDeps(fetchImpl)

    const { run } = await startOrResumeCatalogIngestion(deps, {
      runType: 'full',
      pageSize: 10,
    })

    const result = await ingestCatalogPages(deps, { runId: run.id, maxPages: 10 })

    assert.equal(result.status, 'completed')
    assert.equal(result.counters.rowsSeen, 3)
    assert.equal(result.counters.rowsRejected, 1)

    assert.equal(deps.ingestionRepository.rejects.length, 1)
    const reject = deps.ingestionRepository.rejects[0]
    assert.equal(reject.recordIndex, 1)
    assert.equal(reject.herculesItemId, null)
    assert.deepEqual(reject.rawPayload, broken)

    // Good records still landed, including the multi-vendor one.
    assert.equal(deps.importRepository.catalogItems.size, 2)
    assert.equal(
      deps.importRepository.getImportJob(run.importJobId as string)?.status,
      'partial'
    )
  })

  it('runs a delta using the stored watermark and advances it', async () => {
    const parts = [partAt(0, '2026-06-10T10:00:00.000Z')]
    const { fetchImpl, calls } = pagedCatalogFetch(parts)
    const deps = buildDeps(fetchImpl)

    await deps.ingestionRepository.setSyncWatermark(
      'parts',
      '2026-06-01T00:00:00.000Z',
      'previous-run'
    )

    const { run } = await startOrResumeCatalogIngestion(deps, { runType: 'delta' })
    assert.equal(run.runType, 'delta')
    assert.equal(run.updatedSince, '2026-06-01T00:00:00.000Z')

    const result = await ingestCatalogPages(deps, { runId: run.id, maxPages: 10 })
    assert.equal(result.status, 'completed')

    // Delta requests filter on the watermark and page over the stable _id sort.
    assert.equal(calls[0].body.sortBy, '_id')
    assert.deepEqual(calls[0].body.filters, [
      { field: 'updatedAt', operator: 'gte', value: '2026-06-01T00:00:00.000Z' },
    ])

    assert.equal(
      await deps.ingestionRepository.getSyncWatermark('parts'),
      '2026-06-10T10:00:00.000Z'
    )
  })

  it('downgrades a delta run to full when no watermark exists', async () => {
    const parts = [partAt(0)]
    const { fetchImpl } = pagedCatalogFetch(parts)
    const deps = buildDeps(fetchImpl)

    const { run } = await startOrResumeCatalogIngestion(deps, { runType: 'delta' })
    assert.equal(run.runType, 'full')
    assert.equal(run.updatedSince, null)
  })

  it('marks a run and its import job failed', async () => {
    const parts = [partAt(0)]
    const { fetchImpl } = pagedCatalogFetch(parts)
    const deps = buildDeps(fetchImpl)

    const { run } = await startOrResumeCatalogIngestion(deps, { runType: 'full' })
    await markCatalogIngestionFailed(deps, run.id, 'operator gave up')

    const failed = await deps.ingestionRepository.getRun(run.id)
    assert.equal(failed?.status, 'failed')
    assert.equal(failed?.lastError, 'operator gave up')
    assert.equal(
      deps.importRepository.getImportJob(run.importJobId as string)?.status,
      'failed'
    )

    // A failed run no longer blocks new runs.
    const fresh = await startOrResumeCatalogIngestion(deps, { runType: 'full' })
    assert.equal(fresh.resumed, false)
    assert.notEqual(fresh.run.id, run.id)
  })
})
