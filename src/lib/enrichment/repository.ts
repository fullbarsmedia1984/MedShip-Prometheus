import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  Competitor,
  CrawlUrlStatus,
  EnrichmentPhase,
  EnrichmentRunRecord,
  EnrichmentRunStatus,
  ImageEnrichmentStatus,
  ImageSource,
  ParsedCompetitorProduct,
} from './types'

type DbRow = Record<string, unknown>

function assertNoError(error: unknown) {
  if (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'Unknown Supabase error'
    throw new Error(message)
  }
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toRun(row: DbRow): EnrichmentRunRecord {
  return {
    id: String(row.id),
    phase: row.phase as EnrichmentPhase,
    competitor: (row.competitor as Competitor | null) ?? null,
    status: row.status as EnrichmentRunStatus,
    cursorJson: (row.cursor_json as Record<string, unknown>) ?? {},
    countersJson: (row.counters_json as Record<string, number>) ?? {},
    creditsUsed: toNumber(row.credits_used, 0),
    itemsProcessed: toNumber(row.items_processed, 0),
    lastError: (row.last_error as string | null) ?? null,
    triggeredBy: (row.triggered_by as string | null) ?? null,
    startedAt: String(row.started_at),
    completedAt: (row.completed_at as string | null) ?? null,
  }
}

export type ClaimedCrawlUrl = {
  id: string
  url: string
}

export type StoredImageRecord = {
  storagePath: string
  contentHash: string
  contentType: string
  byteSize: number
}

export type MirrorCandidateItem = {
  id: string
  imageUrls: string[]
}

export type ItemImageState = {
  imageStatus: string
  imageAttempts: number
}

function toStoredImage(row: DbRow): StoredImageRecord {
  return {
    storagePath: String(row.storage_path),
    contentHash: String(row.content_hash),
    contentType: String(row.content_type),
    byteSize: toNumber(row.byte_size, 0),
  }
}

export type ReviewImage = {
  id: string
  itemId: string
  productName: string | null
  manufacturerName: string | null
  storagePath: string
  url: string
  source: ImageSource
  sourceUrl: string
  isPrimary: boolean
  createdAt: string
}

export type SearchSweepTarget = {
  itemId: string
  searchAttempts: number
  imageStatus: string
  brand: string | null
  manufacturerName: string | null
  manufacturerPartNumber: string | null
}

export const CATALOG_IMAGES_BUCKET = 'catalog-images'

export type CompetitorProductUpsertResult = {
  id: string
  isNew: boolean
  priceChanged: boolean
}

export class SupabaseEnrichmentRepository {
  private readonly supabase = createAdminClient()

  // ----------------------------------------------------------------
  // Runs
  // ----------------------------------------------------------------

  async createRun(input: {
    phase: EnrichmentPhase
    competitor: Competitor | null
    triggeredBy: string | null
  }): Promise<EnrichmentRunRecord> {
    const { data, error } = await this.supabase
      .from('enrichment_runs')
      .insert({
        phase: input.phase,
        competitor: input.competitor,
        triggered_by: input.triggeredBy,
        status: 'running',
      })
      .select('*')
      .single()

    assertNoError(error)
    return toRun(data as DbRow)
  }

  async getRun(id: string): Promise<EnrichmentRunRecord | null> {
    const { data, error } = await this.supabase
      .from('enrichment_runs')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    assertNoError(error)
    return data ? toRun(data as DbRow) : null
  }

  async getActiveRun(
    phase: EnrichmentPhase,
    competitor: Competitor | null
  ): Promise<EnrichmentRunRecord | null> {
    let query = this.supabase
      .from('enrichment_runs')
      .select('*')
      .eq('phase', phase)
      .eq('status', 'running')

    query = competitor === null ? query.is('competitor', null) : query.eq('competitor', competitor)

    const { data, error } = await query.maybeSingle()
    assertNoError(error)
    return data ? toRun(data as DbRow) : null
  }

  async checkpointRun(
    id: string,
    input: {
      cursorJson?: Record<string, unknown>
      countersJson?: Record<string, number>
      creditsUsed?: number
      itemsProcessed?: number
    }
  ) {
    const now = new Date().toISOString()
    const update: DbRow = { last_activity_at: now, updated_at: now }
    if (input.cursorJson !== undefined) update.cursor_json = input.cursorJson
    if (input.countersJson !== undefined) update.counters_json = input.countersJson
    if (input.creditsUsed !== undefined) update.credits_used = input.creditsUsed
    if (input.itemsProcessed !== undefined) update.items_processed = input.itemsProcessed

    const { error } = await this.supabase.from('enrichment_runs').update(update).eq('id', id)
    assertNoError(error)
  }

  async completeRun(
    id: string,
    input: { status: Exclude<EnrichmentRunStatus, 'running'>; lastError?: string | null }
  ) {
    const now = new Date().toISOString()
    const { error } = await this.supabase
      .from('enrichment_runs')
      .update({
        status: input.status,
        last_error: input.lastError ?? null,
        completed_at: now,
        last_activity_at: now,
        updated_at: now,
      })
      .eq('id', id)

    assertNoError(error)
  }

  async listRecentRuns(limit = 10): Promise<EnrichmentRunRecord[]> {
    const { data, error } = await this.supabase
      .from('enrichment_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit)

    assertNoError(error)
    return ((data ?? []) as DbRow[]).map(toRun)
  }

  // ----------------------------------------------------------------
  // URL frontier
  // ----------------------------------------------------------------

  /** Insert newly discovered URLs, ignoring ones already known. */
  async insertDiscoveredUrls(competitor: Competitor, urls: string[]): Promise<number> {
    if (urls.length === 0) return 0
    let inserted = 0
    // Chunk to keep request bodies reasonable at /map scale.
    for (let i = 0; i < urls.length; i += 500) {
      const chunk = urls.slice(i, i + 500).map((url) => ({ competitor, url }))
      const { data, error } = await this.supabase
        .from('competitor_crawl_urls')
        .upsert(chunk, { onConflict: 'competitor,url', ignoreDuplicates: true })
        .select('id')

      assertNoError(error)
      inserted += (data ?? []).length
    }
    return inserted
  }

  async claimPendingUrls(competitor: Competitor, limit: number): Promise<ClaimedCrawlUrl[]> {
    const { data, error } = await this.supabase
      .from('competitor_crawl_urls')
      .select('id, url')
      .eq('competitor', competitor)
      .eq('status', 'pending')
      .order('discovered_at', { ascending: true })
      .limit(limit)

    assertNoError(error)
    return ((data ?? []) as DbRow[]).map((row) => ({ id: String(row.id), url: String(row.url) }))
  }

  async countPendingUrls(competitor: Competitor): Promise<number> {
    const { count, error } = await this.supabase
      .from('competitor_crawl_urls')
      .select('id', { count: 'exact', head: true })
      .eq('competitor', competitor)
      .eq('status', 'pending')

    assertNoError(error)
    return count ?? 0
  }

  async markUrl(id: string, status: CrawlUrlStatus, errorMessage?: string | null) {
    const update: DbRow = {
      status,
      last_scraped_at: new Date().toISOString(),
      last_error: errorMessage ?? null,
    }
    const { error } = await this.supabase.from('competitor_crawl_urls').update(update).eq('id', id)
    assertNoError(error)
  }

  async bumpUrlFailure(id: string, errorMessage: string, maxFails: number) {
    const { data, error } = await this.supabase
      .from('competitor_crawl_urls')
      .select('fail_count')
      .eq('id', id)
      .single()
    assertNoError(error)

    const failCount = toNumber((data as DbRow).fail_count, 0) + 1
    const { error: updateError } = await this.supabase
      .from('competitor_crawl_urls')
      .update({
        fail_count: failCount,
        status: failCount >= maxFails ? 'failed' : 'pending',
        last_error: errorMessage,
        last_scraped_at: new Date().toISOString(),
      })
      .eq('id', id)
    assertNoError(updateError)
  }

  // ----------------------------------------------------------------
  // Competitor products + price history
  // ----------------------------------------------------------------

  /**
   * Upsert the current page state and append a price point when the
   * price or its status changed since the last observation.
   */
  async upsertCompetitorProduct(
    competitor: Competitor,
    url: string,
    parsed: ParsedCompetitorProduct
  ): Promise<CompetitorProductUpsertResult> {
    const { data: existing, error: readError } = await this.supabase
      .from('competitor_products')
      .select('id, list_price_amount, price_status')
      .eq('competitor', competitor)
      .eq('url', url)
      .maybeSingle()
    assertNoError(readError)

    const now = new Date().toISOString()
    const row = {
      competitor,
      url,
      title: parsed.title,
      brand: parsed.brand,
      sku: parsed.sku,
      mpn: parsed.mpn,
      gtin: parsed.gtin,
      description: parsed.description,
      list_price_amount: parsed.listPriceAmount,
      currency: parsed.currency,
      price_status: parsed.priceStatus,
      availability: parsed.availability,
      image_urls_json: parsed.imageUrls,
      parse_source: parsed.parseSource,
      raw_payload: parsed.rawPayload,
      last_scraped_at: now,
      updated_at: now,
    }

    const { data, error } = await this.supabase
      .from('competitor_products')
      .upsert(row, { onConflict: 'competitor,url' })
      .select('id')
      .single()
    assertNoError(error)

    const id = String((data as DbRow).id)
    // Compare as number|null. Note Number(null) === 0, so a null price
    // must be normalized to null explicitly — otherwise a null-price
    // product looks like it changed (0 vs null) on every re-scrape and
    // appends a redundant price point each time.
    const previousAmount =
      existing && (existing as DbRow).list_price_amount != null
        ? Number((existing as DbRow).list_price_amount)
        : null
    const newAmount = parsed.listPriceAmount ?? null
    const priceChanged =
      !existing ||
      (existing as DbRow).price_status !== parsed.priceStatus ||
      previousAmount !== newAmount

    if (priceChanged) {
      const { error: priceError } = await this.supabase.from('competitor_price_points').insert({
        competitor_product_id: id,
        list_price_amount: parsed.listPriceAmount,
        currency: parsed.currency,
        price_status: parsed.priceStatus,
      })
      assertNoError(priceError)
    }

    return { id, isNew: !existing, priceChanged }
  }

  // ----------------------------------------------------------------
  // Daily credit budget
  // ----------------------------------------------------------------

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10)
  }

  async getTodaysCredits(phase: 'competitor_crawl' | 'search_sweep'): Promise<number> {
    const { data, error } = await this.supabase
      .from('enrichment_daily_budget')
      .select('credits_used')
      .eq('day', this.todayKey())
      .eq('phase', phase)
      .maybeSingle()

    assertNoError(error)
    return data ? toNumber((data as DbRow).credits_used, 0) : 0
  }

  async addCredits(phase: 'competitor_crawl' | 'search_sweep', credits: number) {
    if (credits <= 0) return
    const day = this.todayKey()
    const current = await this.getTodaysCredits(phase)
    const { error } = await this.supabase.from('enrichment_daily_budget').upsert(
      {
        day,
        phase,
        credits_used: current + credits,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'day,phase' }
    )
    assertNoError(error)
  }

  // ----------------------------------------------------------------
  // Per-item enrichment state
  // ----------------------------------------------------------------

  async setItemImageState(itemId: string, status: ImageEnrichmentStatus) {
    const now = new Date().toISOString()
    const { data, error } = await this.supabase
      .from('catalog_item_enrichment_state')
      .select('image_attempts')
      .eq('hercules_catalog_item_id', itemId)
      .maybeSingle()
    assertNoError(error)

    const attempts = data ? toNumber((data as DbRow).image_attempts, 0) + 1 : 1
    const { error: upsertError } = await this.supabase.from('catalog_item_enrichment_state').upsert(
      {
        hercules_catalog_item_id: itemId,
        image_status: status,
        image_attempts: attempts,
        last_image_attempt_at: now,
        updated_at: now,
      },
      { onConflict: 'hercules_catalog_item_id' }
    )
    assertNoError(upsertError)
  }

  async bumpItemSearchAttempt(itemId: string, status: ImageEnrichmentStatus) {
    const now = new Date().toISOString()
    const { data, error } = await this.supabase
      .from('catalog_item_enrichment_state')
      .select('search_attempts')
      .eq('hercules_catalog_item_id', itemId)
      .maybeSingle()
    assertNoError(error)

    const attempts = data ? toNumber((data as DbRow).search_attempts, 0) + 1 : 1
    const { error: upsertError } = await this.supabase.from('catalog_item_enrichment_state').upsert(
      {
        hercules_catalog_item_id: itemId,
        image_status: status,
        search_attempts: attempts,
        last_search_at: now,
        updated_at: now,
      },
      { onConflict: 'hercules_catalog_item_id' }
    )
    assertNoError(upsertError)
  }

  // ----------------------------------------------------------------
  // Mirrored images
  // ----------------------------------------------------------------

  /** Any item already mirrored this exact source URL? (cheap re-run skip) */
  async findImageBySourceUrl(sourceUrl: string): Promise<StoredImageRecord | null> {
    const { data, error } = await this.supabase
      .from('catalog_item_images')
      .select('storage_path, content_hash, content_type, byte_size')
      .eq('source_url', sourceUrl)
      .limit(1)
      .maybeSingle()
    assertNoError(error)
    return data ? toStoredImage(data as DbRow) : null
  }

  /** Is this content hash already stored (any item)? */
  async findImageByHash(contentHash: string): Promise<StoredImageRecord | null> {
    const { data, error } = await this.supabase
      .from('catalog_item_images')
      .select('storage_path, content_hash, content_type, byte_size')
      .eq('content_hash', contentHash)
      .limit(1)
      .maybeSingle()
    assertNoError(error)
    return data ? toStoredImage(data as DbRow) : null
  }

  async insertCatalogItemImage(input: {
    itemId: string
    storagePath: string
    sourceUrl: string
    source: ImageSource
    contentHash: string
    contentType: string
    byteSize: number
    isPrimary: boolean
  }): Promise<boolean> {
    const { error } = await this.supabase.from('catalog_item_images').insert({
      hercules_catalog_item_id: input.itemId,
      storage_path: input.storagePath,
      source_url: input.sourceUrl,
      source: input.source,
      content_hash: input.contentHash,
      content_type: input.contentType,
      byte_size: input.byteSize,
      is_primary: input.isPrimary,
    })

    // Unique (item, content_hash) collisions mean the link already
    // exists — that is success for an idempotent mirror.
    if (error && /duplicate key|unique constraint/i.test(error.message)) return false
    assertNoError(error)
    return true
  }

  async itemHasPrimaryImage(itemId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('catalog_item_images')
      .select('id', { count: 'exact', head: true })
      .eq('hercules_catalog_item_id', itemId)
      .eq('is_primary', true)

    assertNoError(error)
    return (count ?? 0) > 0
  }

  // ----------------------------------------------------------------
  // Mirror batch queries
  // ----------------------------------------------------------------

  /** Keyset page of catalog items with their Hercules image URLs. */
  async listCatalogItemsForMirror(afterId: string | null, limit: number): Promise<MirrorCandidateItem[]> {
    let query = this.supabase
      .from('hercules_catalog_items')
      .select('id, image_urls_json')
      .order('id', { ascending: true })
      .limit(limit)
    if (afterId) query = query.gt('id', afterId)

    const { data, error } = await query
    assertNoError(error)
    return ((data ?? []) as DbRow[]).map((row) => ({
      id: String(row.id),
      imageUrls: Array.isArray(row.image_urls_json)
        ? (row.image_urls_json as unknown[]).filter((u): u is string => typeof u === 'string')
        : [],
    }))
  }

  async getItemImageStates(itemIds: string[]): Promise<Map<string, ItemImageState>> {
    const states = new Map<string, ItemImageState>()
    if (itemIds.length === 0) return states

    const { data, error } = await this.supabase
      .from('catalog_item_enrichment_state')
      .select('hercules_catalog_item_id, image_status, image_attempts')
      .in('hercules_catalog_item_id', itemIds)
    assertNoError(error)

    for (const row of (data ?? []) as DbRow[]) {
      states.set(String(row.hercules_catalog_item_id), {
        imageStatus: String(row.image_status),
        imageAttempts: toNumber(row.image_attempts, 0),
      })
    }
    return states
  }

  /** Active competitor-product image URLs for a batch of items. */
  async getCompetitorImagesByItem(
    itemIds: string[]
  ): Promise<Map<string, Array<{ source: Competitor; urls: string[] }>>> {
    const bySource = new Map<string, Array<{ source: Competitor; urls: string[] }>>()
    if (itemIds.length === 0) return bySource

    const { data, error } = await this.supabase
      .from('catalog_item_competitor_links')
      .select('hercules_catalog_item_id, status, competitor_products(competitor, image_urls_json)')
      .in('hercules_catalog_item_id', itemIds)
      .eq('status', 'active')
    assertNoError(error)

    for (const row of (data ?? []) as DbRow[]) {
      const product = row.competitor_products as DbRow | null
      if (!product) continue
      const urls = Array.isArray(product.image_urls_json)
        ? (product.image_urls_json as unknown[]).filter((u): u is string => typeof u === 'string')
        : []
      if (urls.length === 0) continue

      const itemId = String(row.hercules_catalog_item_id)
      const list = bySource.get(itemId) ?? []
      list.push({ source: product.competitor as Competitor, urls })
      bySource.set(itemId, list)
    }
    return bySource
  }

  // ----------------------------------------------------------------
  // Search sweep targets
  // ----------------------------------------------------------------

  /**
   * Items P16 could not mirror (no source, blocked, or failed) that
   * still have search attempts left. Bumping search_attempts on every
   * processed item guarantees forward progress without a cursor.
   */
  async listSearchSweepTargets(limit: number, maxAttempts: number): Promise<SearchSweepTarget[]> {
    const { data, error } = await this.supabase
      .from('catalog_item_enrichment_state')
      .select(
        'hercules_catalog_item_id, search_attempts, image_status, hercules_catalog_items(brand, manufacturer_name, manufacturer_part_number)'
      )
      .in('image_status', ['no_source', 'hotlink_blocked', 'source_failed'])
      .lt('search_attempts', maxAttempts)
      .order('updated_at', { ascending: true })
      .limit(limit)
    assertNoError(error)

    return ((data ?? []) as DbRow[]).map((row) => {
      const item = (row.hercules_catalog_items as DbRow | null) ?? {}
      return {
        itemId: String(row.hercules_catalog_item_id),
        searchAttempts: toNumber(row.search_attempts, 0),
        imageStatus: String(row.image_status),
        brand: (item.brand as string | null) ?? null,
        manufacturerName: (item.manufacturer_name as string | null) ?? null,
        manufacturerPartNumber: (item.manufacturer_part_number as string | null) ?? null,
      }
    })
  }

  // ----------------------------------------------------------------
  // Review gallery
  // ----------------------------------------------------------------

  /** Keyset page of stored images (newest first) with item identity. */
  async listReviewImages(input: {
    source: ImageSource | 'all'
    before: string | null
    limit: number
  }): Promise<ReviewImage[]> {
    let query = this.supabase
      .from('catalog_item_images')
      .select(
        'id, hercules_catalog_item_id, storage_path, source, source_url, is_primary, created_at, hercules_catalog_items(brand, manufacturer_name)'
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.limit)
    if (input.source !== 'all') query = query.eq('source', input.source)
    if (input.before) query = query.lt('created_at', input.before)

    const { data, error } = await query
    assertNoError(error)

    return ((data ?? []) as DbRow[]).map((row) => {
      const item = (row.hercules_catalog_items as DbRow | null) ?? {}
      return {
        id: String(row.id),
        itemId: String(row.hercules_catalog_item_id),
        productName: (item.brand as string | null) ?? null,
        manufacturerName: (item.manufacturer_name as string | null) ?? null,
        storagePath: String(row.storage_path),
        url: this.supabase.storage
          .from(CATALOG_IMAGES_BUCKET)
          .getPublicUrl(String(row.storage_path)).data.publicUrl,
        source: row.source as ImageSource,
        sourceUrl: String(row.source_url),
        isPrimary: Boolean(row.is_primary),
        createdAt: String(row.created_at),
      }
    })
  }

  async countImagesBySource(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}
    for (const source of ['hercules', 'pocketnurse', 'diamedical', 'web_search'] as const) {
      const { count, error } = await this.supabase
        .from('catalog_item_images')
        .select('id', { count: 'exact', head: true })
        .eq('source', source)
      assertNoError(error)
      counts[source] = count ?? 0
    }
    return counts
  }

  /**
   * Reject a mirrored image: delete the link row and mark the item so
   * no automation refills it (search_not_found is terminal for both the
   * mirror and the sweep). The storage object is left in place — it is
   * content-addressed and may be shared by other items. If the rejected
   * image was the item's primary, the oldest remaining image (if any)
   * is promoted.
   */
  async rejectImage(imageId: string): Promise<{ itemId: string } | null> {
    const { data, error } = await this.supabase
      .from('catalog_item_images')
      .select('id, hercules_catalog_item_id, is_primary')
      .eq('id', imageId)
      .maybeSingle()
    assertNoError(error)
    if (!data) return null

    const itemId = String((data as DbRow).hercules_catalog_item_id)
    const wasPrimary = Boolean((data as DbRow).is_primary)

    const { error: deleteError } = await this.supabase
      .from('catalog_item_images')
      .delete()
      .eq('id', imageId)
    assertNoError(deleteError)

    if (wasPrimary) {
      const { data: next, error: nextError } = await this.supabase
        .from('catalog_item_images')
        .select('id')
        .eq('hercules_catalog_item_id', itemId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      assertNoError(nextError)
      if (next) {
        const { error: promoteError } = await this.supabase
          .from('catalog_item_images')
          .update({ is_primary: true })
          .eq('id', String((next as DbRow).id))
        assertNoError(promoteError)
      }
    }

    const { count, error: countError } = await this.supabase
      .from('catalog_item_images')
      .select('id', { count: 'exact', head: true })
      .eq('hercules_catalog_item_id', itemId)
    assertNoError(countError)

    await this.setItemImageState(itemId, (count ?? 0) > 0 ? 'mirrored' : 'search_not_found')
    return { itemId }
  }

  // ----------------------------------------------------------------
  // Storage
  // ----------------------------------------------------------------

  /** Idempotent bucket creation for environments the migration missed. */
  async ensureCatalogImagesBucket(): Promise<void> {
    const { error } = await this.supabase.storage.createBucket(CATALOG_IMAGES_BUCKET, {
      public: true,
      fileSizeLimit: 5_242_880,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    })
    if (error && !/already exists|duplicate/i.test(error.message)) {
      throw new Error(`Could not create ${CATALOG_IMAGES_BUCKET} bucket: ${error.message}`)
    }
  }

  /** Upload image bytes; an existing object at the path counts as success. */
  async uploadCatalogImage(
    storagePath: string,
    bytes: Uint8Array,
    contentType: string
  ): Promise<'uploaded' | 'exists'> {
    const { error } = await this.supabase.storage
      .from(CATALOG_IMAGES_BUCKET)
      .upload(storagePath, bytes, {
        contentType,
        cacheControl: '31536000',
        upsert: false,
      })

    if (error) {
      if (/already exists|duplicate|409/i.test(error.message)) return 'exists'
      throw new Error(`Storage upload failed for ${storagePath}: ${error.message}`)
    }
    return 'uploaded'
  }
}
