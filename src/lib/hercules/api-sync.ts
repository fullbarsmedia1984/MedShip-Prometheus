import { ApiHerculesPricingSource } from './api-source'
import { importHerculesPricing } from './importer'
import type {
  HerculesApiSyncStateInput,
  HerculesApiSyncStateRepository,
  HerculesImportRepository,
  HerculesSupplierItemPayload,
  JsonObject,
} from './types'

const MAX_PAGE_SIZE = 500

type PageSource = {
  mode: 'api'
  supplierCode?: string
  getSupplierItems(): AsyncIterable<HerculesSupplierItemPayload>
}

type HerculesApiSyncOptions = {
  importRepository: HerculesImportRepository
  syncStateRepository: HerculesApiSyncStateRepository
  createSource: (input: {
    pageSize: number
    initialOffset?: number
    updatedSince?: string
    supplierCode?: string
  }) => ApiHerculesPricingSource
  supplierCode?: string
  pageSize?: number
  now?: () => Date
}

type HerculesApiSyncResult = {
  sourceKey: string
  supplierCode: string | null
  fullBackfillStartedAt: string
  fullBackfillImportJobIds: string[]
  deltaImportJobIds: string[]
  deltaCursor: string
}

function normalizeSupplierCode(value: string | undefined) {
  const text = value?.trim().toUpperCase()
  return text || null
}

function syncSourceKey(supplierCode: string | null) {
  return `hercules-api-parts:${supplierCode ?? 'ALL'}`
}

function clampPageSize(pageSize: number | undefined) {
  if (pageSize === undefined) return MAX_PAGE_SIZE
  if (!Number.isFinite(pageSize) || pageSize <= 0) return MAX_PAGE_SIZE
  return Math.min(Math.floor(pageSize), MAX_PAGE_SIZE)
}

function syncStatusFromImportStatus(status: string): HerculesApiSyncStateInput['status'] {
  if (status === 'success' || status === 'failed' || status === 'partial') return status
  return 'failed'
}

function pageArraySource(input: {
  supplierCode: string | null
  items: HerculesSupplierItemPayload[]
}): PageSource {
  return {
    mode: 'api',
    supplierCode: input.supplierCode ?? undefined,
    async *getSupplierItems() {
      for (const item of input.items) {
        yield item
      }
    },
  }
}

function stateInput(input: {
  sourceKey: string
  supplierCode: string | null
  phase: HerculesApiSyncStateInput['phase']
  status: HerculesApiSyncStateInput['status']
  pageLimit: number
  nextOffset: number | null
  backfillStartedAt: string | null
  backfillCompletedAt: string | null
  deltaCursor: string | null
  lastProcessedUpdatedAt: string | null
  lastImportJobId: string | null
  lastError?: string | null
  metadata?: JsonObject
}): HerculesApiSyncStateInput {
  return {
    sourceKey: input.sourceKey,
    supplierCode: input.supplierCode,
    phase: input.phase,
    status: input.status,
    pageLimit: input.pageLimit,
    nextOffset: input.nextOffset,
    backfillStartedAt: input.backfillStartedAt,
    backfillCompletedAt: input.backfillCompletedAt,
    deltaCursor: input.deltaCursor,
    lastProcessedUpdatedAt: input.lastProcessedUpdatedAt,
    lastImportJobId: input.lastImportJobId,
    lastError: input.lastError ?? null,
    metadata: input.metadata ?? {},
  }
}

export async function runHerculesApiBackfillThenDelta(
  options: HerculesApiSyncOptions
): Promise<HerculesApiSyncResult> {
  const supplierCode = normalizeSupplierCode(options.supplierCode)
  const sourceKey = syncSourceKey(supplierCode)
  const pageSize = clampPageSize(options.pageSize)
  const now = options.now ?? (() => new Date())
  const existing = await options.syncStateRepository.getApiSyncState(sourceKey)
  const backfillStartedAt =
    existing?.backfillStartedAt ?? now().toISOString()
  const fullBackfillImportJobIds: string[] = []
  const deltaImportJobIds: string[] = []

  await options.syncStateRepository.upsertApiSyncState(
    stateInput({
      sourceKey,
      supplierCode,
      phase: 'full_backfill',
      status: 'running',
      pageLimit: pageSize,
      nextOffset: existing?.nextOffset ?? 0,
      backfillStartedAt,
      backfillCompletedAt: existing?.backfillCompletedAt ?? null,
      deltaCursor: existing?.deltaCursor ?? null,
      lastProcessedUpdatedAt: existing?.lastProcessedUpdatedAt ?? null,
      lastImportJobId: existing?.lastImportJobId ?? null,
    })
  )

  try {
    const fullSource = options.createSource({
      pageSize,
      initialOffset: existing?.nextOffset ?? 0,
      supplierCode: supplierCode ?? undefined,
    })

    for await (const page of fullSource.getSupplierItemPages()) {
      const result = await importHerculesPricing(
        pageArraySource({ supplierCode, items: page.items }),
        options.importRepository
      )
      fullBackfillImportJobIds.push(result.jobId)

      await options.syncStateRepository.upsertApiSyncState(
        stateInput({
          sourceKey,
          supplierCode,
          phase: 'full_backfill',
          status: page.hasNext ? 'running' : syncStatusFromImportStatus(result.status),
          pageLimit: pageSize,
          nextOffset: page.nextOffset,
          backfillStartedAt,
          backfillCompletedAt: page.hasNext ? null : now().toISOString(),
          deltaCursor: page.hasNext ? null : backfillStartedAt,
          lastProcessedUpdatedAt: page.latestProcessedUpdatedAt,
          lastImportJobId: result.jobId,
          lastError: result.errors[0] ?? null,
          metadata: {
            lastPageOffset: page.offset,
            lastPageCount: page.count,
          },
        })
      )
    }

    const deltaCursor = backfillStartedAt
    const deltaSource = options.createSource({
      pageSize,
      updatedSince: deltaCursor,
      supplierCode: supplierCode ?? undefined,
    })

    await options.syncStateRepository.upsertApiSyncState(
      stateInput({
        sourceKey,
        supplierCode,
        phase: 'delta',
        status: 'running',
        pageLimit: pageSize,
        nextOffset: 0,
        backfillStartedAt,
        backfillCompletedAt: now().toISOString(),
        deltaCursor,
        lastProcessedUpdatedAt: null,
        lastImportJobId: fullBackfillImportJobIds.at(-1) ?? null,
      })
    )

    for await (const page of deltaSource.getSupplierItemPages()) {
      const result = await importHerculesPricing(
        pageArraySource({ supplierCode, items: page.items }),
        options.importRepository
      )
      deltaImportJobIds.push(result.jobId)

      await options.syncStateRepository.upsertApiSyncState(
        stateInput({
          sourceKey,
          supplierCode,
          phase: 'delta',
          status: page.hasNext ? 'running' : syncStatusFromImportStatus(result.status),
          pageLimit: pageSize,
          nextOffset: page.nextOffset,
          backfillStartedAt,
          backfillCompletedAt: now().toISOString(),
          deltaCursor: page.latestProcessedUpdatedAt ?? deltaCursor,
          lastProcessedUpdatedAt: page.latestProcessedUpdatedAt,
          lastImportJobId: result.jobId,
          lastError: result.errors[0] ?? null,
          metadata: {
            lastPageOffset: page.offset,
            lastPageCount: page.count,
          },
        })
      )
    }

    return {
      sourceKey,
      supplierCode,
      fullBackfillStartedAt: backfillStartedAt,
      fullBackfillImportJobIds,
      deltaImportJobIds,
      deltaCursor,
    }
  } catch (error) {
    await options.syncStateRepository.upsertApiSyncState(
      stateInput({
        sourceKey,
        supplierCode,
        phase: 'full_backfill',
        status: 'failed',
        pageLimit: pageSize,
        nextOffset: existing?.nextOffset ?? 0,
        backfillStartedAt,
        backfillCompletedAt: null,
        deltaCursor: existing?.deltaCursor ?? null,
        lastProcessedUpdatedAt: existing?.lastProcessedUpdatedAt ?? null,
        lastImportJobId: existing?.lastImportJobId ?? null,
        lastError: error instanceof Error ? error.message : 'Unknown Hercules API sync error',
      })
    )
    throw error
  }
}

export const herculesApiSyncSourceKey = syncSourceKey
