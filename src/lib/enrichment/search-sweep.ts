import 'server-only'

import {
  FirecrawlInsufficientCreditsError,
  FirecrawlRateLimitError,
  type FirecrawlClient,
} from '@/lib/firecrawl/client'
import { downloadImage } from './image-download'
import type { SupabaseEnrichmentRepository, SearchSweepTarget } from './repository'
import type { EnrichmentRunRecord } from './types'

export type SearchSweepDeps = {
  repository: SupabaseEnrichmentRepository
  getFirecrawl: () => FirecrawlClient
  fetchImpl?: typeof fetch
}

export type SearchSweepBatchResult = {
  status: 'in_progress' | 'completed' | 'budget_exhausted' | 'rate_limited'
  resumeAt: string | null
  counters: Record<string, number>
  creditsUsed: number
}

/** Firecrawl bills search at 2 credits per 10 results per source. */
const CREDITS_PER_SEARCH = 2
const SEARCH_RESULT_LIMIT = 5
const MAX_SEARCH_ATTEMPTS = 2
/** Try downloading at most this many image hits per item. */
const MAX_IMAGE_HITS_TRIED = 3

export async function startOrResumeSearchSweep(
  deps: SearchSweepDeps,
  input: { triggeredBy: string }
): Promise<{ run: EnrichmentRunRecord; resumed: boolean }> {
  const active = await deps.repository.getActiveRun('search_sweep', null)
  if (active) return { run: active, resumed: true }
  const run = await deps.repository.createRun({
    phase: 'search_sweep',
    competitor: null,
    triggeredBy: input.triggeredBy,
  })
  return { run, resumed: false }
}

function bump(counters: Record<string, number>, key: string, by = 1) {
  counters[key] = (counters[key] ?? 0) + by
}

function buildSearchQuery(target: SearchSweepTarget): string | null {
  const name = target.brand?.trim() || null
  const manufacturer = target.manufacturerName?.trim() || null
  const mpn = target.manufacturerPartNumber?.trim() || null

  // An MPN alone is too ambiguous; require a name or manufacturer.
  if (mpn && (manufacturer || name)) {
    return [`"${mpn}"`, manufacturer ?? '', name ?? ''].filter(Boolean).join(' ').slice(0, 200)
  }
  if (name) return [name, manufacturer ?? ''].filter(Boolean).join(' ').slice(0, 200)
  return null
}

/**
 * P17: Firecrawl image search for items no known source could cover.
 * Every processed item gets its search_attempts bumped (found or
 * not), so the eligible set strictly shrinks and the sweep converges
 * without a cursor.
 */
export async function searchSweepBatch(
  deps: SearchSweepDeps,
  input: {
    runId: string
    maxItems: number
    dailyCreditBudget: number
    maxBytes: number
    timeoutMs: number
  }
): Promise<SearchSweepBatchResult> {
  const repository = deps.repository
  const run = await repository.getRun(input.runId)
  if (!run || run.status !== 'running') {
    return {
      status: 'completed',
      resumeAt: null,
      counters: run?.countersJson ?? {},
      creditsUsed: run?.creditsUsed ?? 0,
    }
  }

  const counters = { ...run.countersJson }
  let creditsUsed = run.creditsUsed

  const targets = await repository.listSearchSweepTargets(input.maxItems, MAX_SEARCH_ATTEMPTS)
  if (targets.length === 0) {
    await repository.completeRun(run.id, { status: 'completed' })
    return { status: 'completed', resumeAt: null, counters, creditsUsed }
  }

  let processed = 0

  // Sequential on purpose: each search is billed, and rate limits or
  // budget exhaustion must stop the batch immediately.
  for (const target of targets) {
    const spentToday = await repository.getTodaysCredits('search_sweep')
    if (spentToday + CREDITS_PER_SEARCH > input.dailyCreditBudget) {
      await checkpoint()
      return { status: 'budget_exhausted', resumeAt: null, counters, creditsUsed }
    }

    const query = buildSearchQuery(target)
    if (!query) {
      await repository.bumpItemSearchAttempt(target.itemId, 'search_not_found')
      bump(counters, 'unsearchable')
      processed += 1
      continue
    }

    let imageHits: Array<{ imageUrl?: string; url?: string }>
    try {
      const result = await deps.getFirecrawl().search(query, {
        limit: SEARCH_RESULT_LIMIT,
        sources: ['images'],
      })
      creditsUsed += CREDITS_PER_SEARCH
      await repository.addCredits('search_sweep', CREDITS_PER_SEARCH)
      bump(counters, 'searches')
      imageHits = result.images
    } catch (error) {
      if (error instanceof FirecrawlRateLimitError) {
        await checkpoint()
        const resumeAt = new Date(Date.now() + (error.retryAfterMs ?? 5 * 60 * 1000)).toISOString()
        return { status: 'rate_limited', resumeAt, counters, creditsUsed }
      }
      if (error instanceof FirecrawlInsufficientCreditsError) {
        await checkpoint()
        return { status: 'budget_exhausted', resumeAt: null, counters, creditsUsed }
      }
      throw error
    }

    let mirrored = false
    for (const hit of imageHits.slice(0, MAX_IMAGE_HITS_TRIED)) {
      const imageUrl = hit.imageUrl
      if (!imageUrl) continue

      const downloaded = await downloadImage(imageUrl, {
        maxBytes: input.maxBytes,
        timeoutMs: input.timeoutMs,
        referer: hit.url,
        fetchImpl: deps.fetchImpl,
      })
      if (!downloaded.ok) continue

      const storagePath =
        (await repository.findImageByHash(downloaded.sha256))?.storagePath ??
        `${downloaded.sha256.slice(0, 2)}/${downloaded.sha256}.${downloaded.extension}`
      await repository.uploadCatalogImage(storagePath, downloaded.bytes, downloaded.contentType)

      const isPrimary = !(await repository.itemHasPrimaryImage(target.itemId))
      await repository.insertCatalogItemImage({
        itemId: target.itemId,
        storagePath,
        sourceUrl: imageUrl,
        source: 'web_search',
        contentHash: downloaded.sha256,
        contentType: downloaded.contentType,
        byteSize: downloaded.bytes.byteLength,
        isPrimary,
      })
      mirrored = true
      break
    }

    await repository.bumpItemSearchAttempt(
      target.itemId,
      mirrored ? 'mirrored' : 'search_not_found'
    )
    bump(counters, mirrored ? 'mirroredFromSearch' : 'searchNotFound')
    processed += 1
  }

  await checkpoint()
  return { status: 'in_progress', resumeAt: null, counters, creditsUsed }

  async function checkpoint() {
    await repository.checkpointRun(run!.id, {
      countersJson: counters,
      creditsUsed,
      itemsProcessed: (run!.itemsProcessed ?? 0) + processed,
    })
  }
}
