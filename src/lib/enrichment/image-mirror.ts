import 'server-only'

import { mapWithConcurrency } from './concurrency'
import { downloadImage } from './image-download'
import type { SupabaseEnrichmentRepository } from './repository'
import type { EnrichmentRunRecord, ImageEnrichmentStatus, ImageSource } from './types'

export type ImageMirrorDeps = {
  repository: SupabaseEnrichmentRepository
  fetchImpl?: typeof fetch
}

export type MirrorBatchResult = {
  status: 'in_progress' | 'completed'
  counters: Record<string, number>
}

type ImageCandidate = {
  url: string
  source: ImageSource
}

/** Terminal states P16 never retries; P17 may still rescue no_source. */
const SKIP_STATES = new Set(['mirrored', 'hotlink_blocked', 'no_source', 'search_not_found'])
const MAX_SOURCE_FAILED_ATTEMPTS = 2
/** Try at most this many candidate URLs per item per pass. */
const MAX_CANDIDATES_PER_ITEM = 3

export async function startOrResumeMirror(
  deps: ImageMirrorDeps,
  input: { triggeredBy: string }
): Promise<{ run: EnrichmentRunRecord; resumed: boolean }> {
  const active = await deps.repository.getActiveRun('image_mirror', null)
  if (active) return { run: active, resumed: true }
  const run = await deps.repository.createRun({
    phase: 'image_mirror',
    competitor: null,
    triggeredBy: input.triggeredBy,
  })
  return { run, resumed: false }
}

function bump(counters: Record<string, number>, key: string, by = 1) {
  counters[key] = (counters[key] ?? 0) + by
}

/**
 * Mirror one image per catalog item into the catalog-images bucket,
 * walking the item table with a keyset cursor. Candidate sources per
 * item: its own Hercules image URLs first, then images of linked
 * competitor products. Content-addressed storage dedups identical
 * bytes across items.
 */
export async function mirrorImageBatch(
  deps: ImageMirrorDeps,
  input: {
    runId: string
    maxItems: number
    concurrency: number
    maxBytes: number
    timeoutMs: number
  }
): Promise<MirrorBatchResult> {
  const repository = deps.repository
  const run = await repository.getRun(input.runId)
  if (!run || run.status !== 'running') {
    return { status: 'completed', counters: run?.countersJson ?? {} }
  }

  const counters = { ...run.countersJson }
  const afterId = typeof run.cursorJson.lastItemId === 'string' ? run.cursorJson.lastItemId : null

  const items = await repository.listCatalogItemsForMirror(afterId, input.maxItems)
  if (items.length === 0) {
    await repository.completeRun(run.id, { status: 'completed' })
    return { status: 'completed', counters }
  }

  const itemIds = items.map((item) => item.id)
  const [states, competitorImages] = await Promise.all([
    repository.getItemImageStates(itemIds),
    repository.getCompetitorImagesByItem(itemIds),
  ])

  await mapWithConcurrency(items, input.concurrency, async (item) => {
    const state = states.get(item.id)
    if (state) {
      if (SKIP_STATES.has(state.imageStatus)) {
        bump(counters, 'skippedTerminal')
        return
      }
      if (state.imageStatus === 'source_failed' && state.imageAttempts >= MAX_SOURCE_FAILED_ATTEMPTS) {
        bump(counters, 'skippedTerminal')
        return
      }
    }

    const candidates: ImageCandidate[] = [
      ...item.imageUrls.map((url) => ({ url, source: 'hercules' as ImageSource })),
      ...(competitorImages.get(item.id) ?? []).flatMap((group) =>
        group.urls.map((url) => ({ url, source: group.source as ImageSource }))
      ),
    ].slice(0, MAX_CANDIDATES_PER_ITEM)

    if (candidates.length === 0) {
      await repository.setItemImageState(item.id, 'no_source')
      bump(counters, 'noSource')
      return
    }

    let sawBlocked = false
    for (const candidate of candidates) {
      const outcome = await mirrorOneCandidate(deps, item.id, candidate, input)
      if (outcome === 'mirrored') {
        await repository.setItemImageState(item.id, 'mirrored')
        bump(counters, 'mirrored')
        return
      }
      if (outcome === 'blocked') sawBlocked = true
    }

    const finalState: ImageEnrichmentStatus = sawBlocked ? 'hotlink_blocked' : 'source_failed'
    await repository.setItemImageState(item.id, finalState)
    bump(counters, sawBlocked ? 'hotlinkBlocked' : 'sourceFailed')
  })

  await repository.checkpointRun(run.id, {
    cursorJson: { ...run.cursorJson, lastItemId: items[items.length - 1].id },
    countersJson: counters,
    itemsProcessed: (run.itemsProcessed ?? 0) + items.length,
  })

  return { status: 'in_progress', counters }
}

async function mirrorOneCandidate(
  deps: ImageMirrorDeps,
  itemId: string,
  candidate: ImageCandidate,
  input: { maxBytes: number; timeoutMs: number }
): Promise<'mirrored' | 'blocked' | 'failed'> {
  const repository = deps.repository

  try {
    // Someone already mirrored this exact source URL: link, don't refetch.
    const bySourceUrl = await repository.findImageBySourceUrl(candidate.url)
    if (bySourceUrl) {
      const isPrimary = !(await repository.itemHasPrimaryImage(itemId))
      await repository.insertCatalogItemImage({
        itemId,
        storagePath: bySourceUrl.storagePath,
        sourceUrl: candidate.url,
        source: candidate.source,
        contentHash: bySourceUrl.contentHash,
        contentType: bySourceUrl.contentType,
        byteSize: bySourceUrl.byteSize,
        isPrimary,
      })
      return 'mirrored'
    }

    const downloaded = await downloadImage(candidate.url, {
      maxBytes: input.maxBytes,
      timeoutMs: input.timeoutMs,
      fetchImpl: deps.fetchImpl,
    })
    if (!downloaded.ok) {
      return downloaded.reason === 'blocked' ? 'blocked' : 'failed'
    }

    // Same bytes may already exist under another source URL.
    const storagePath =
      (await repository.findImageByHash(downloaded.sha256))?.storagePath ??
      `${downloaded.sha256.slice(0, 2)}/${downloaded.sha256}.${downloaded.extension}`

    await repository.uploadCatalogImage(storagePath, downloaded.bytes, downloaded.contentType)

    const isPrimary = !(await repository.itemHasPrimaryImage(itemId))
    await repository.insertCatalogItemImage({
      itemId,
      storagePath,
      sourceUrl: candidate.url,
      source: candidate.source,
      contentHash: downloaded.sha256,
      contentType: downloaded.contentType,
      byteSize: downloaded.bytes.byteLength,
      isPrimary,
    })
    return 'mirrored'
  } catch {
    return 'failed'
  }
}
