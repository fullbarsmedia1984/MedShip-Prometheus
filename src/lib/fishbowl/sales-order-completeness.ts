import type { SupabaseClient } from '@supabase/supabase-js'
import type { FishbowlClient } from './client'
import {
  getSalesOrderById,
  getSalesOrdersPage,
  type FBRawSalesOrder,
} from './sales-orders'
import { upsertSalesOrdersToCache } from './sales-order-cache'
import { resolveSalesOrderOpportunityLinks } from './sales-order-links'
import { selectIncrementalSalesOrderPages } from './sales-order-page-bands'

type SyncRunMode = 'backfill' | 'pages' | 'details' | 'incremental'
type SyncRunStatus = 'running' | 'success' | 'partial' | 'failed' | 'paused'

type SyncRun = {
  id: string
}

type PageCheckpoint = {
  page_number: number
  page_size: number
  attempts: number | null
}

type DetailQueueRow = {
  fishbowl_id: string | null
  so_number: string
  attempts: number | null
}

type PageBatchOptions = {
  pageNumbers?: number[]
}

export type SalesOrderCoverage = {
  sourceTotalPages: number
  sourcePageSize: number
  sourceTotalHeadersEstimate: number
  cachedHeaders: number
  cachedLineItems: number
  pageCheckpoints: number
  pagesPending: number
  pagesRunning: number
  pagesCompleted: number
  pagesFailed: number
  detailQueued: number
  detailPending: number
  detailRunning: number
  detailHydrated: number
  detailFailed: number
  latestCachedSalesOrderDate: string | null
  latestCachedDateCreated: string | null
  latestSourceLastSeenAt: string | null
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunMode: SyncRunMode | null
  activeRunStartedAt: string | null
  backfillStatus: 'not_started' | 'running' | 'complete' | 'partial'
}

const DEFAULT_PAGE_SIZE = Number(process.env.FISHBOWL_SO_PAGE_SIZE ?? 100)
const DEFAULT_PAGE_BATCH = Number(process.env.FISHBOWL_SO_PAGE_BATCH ?? 10)
const DEFAULT_DETAIL_BATCH = Number(process.env.FISHBOWL_SO_DETAIL_BATCH ?? 250)
const DEFAULT_MAX_ATTEMPTS = Number(process.env.FISHBOWL_SO_MAX_ATTEMPTS ?? 3)
const DEFAULT_INCREMENTAL_PAGES = Number(process.env.FISHBOWL_SO_INCREMENTAL_PAGES ?? 5)

async function insertQueueChunks(
  supabase: SupabaseClient,
  rows: Array<Record<string, unknown>>,
  chunkSize = 500
) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    const { error } = await supabase
      .from('fishbowl_so_detail_queue')
      .upsert(chunk, { onConflict: 'so_number', ignoreDuplicates: true })
    if (error) throw new Error(`fishbowl_so_detail_queue upsert failed: ${error.message}`)
  }
}

async function insertCheckpointChunks(
  supabase: SupabaseClient,
  rows: Array<Record<string, unknown>>,
  chunkSize = 500
) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    const { error } = await supabase
      .from('fishbowl_so_page_checkpoints')
      .upsert(chunk, { onConflict: 'page_number,page_size', ignoreDuplicates: true })
    if (error) throw new Error(`fishbowl_so_page_checkpoints upsert failed: ${error.message}`)
  }
}

async function createRun(
  supabase: SupabaseClient,
  mode: SyncRunMode,
  summary: Record<string, unknown> = {}
): Promise<SyncRun> {
  const { data, error } = await supabase
    .from('fishbowl_so_sync_runs')
    .insert({
      mode,
      status: 'running',
      raw_summary: summary,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Could not create Fishbowl SO sync run: ${error.message}`)
  return data as SyncRun
}

async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  status: SyncRunStatus,
  summary: Record<string, unknown>,
  errorMessage?: string
) {
  const { error } = await supabase
    .from('fishbowl_so_sync_runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
      raw_summary: summary,
      source_total_pages: summary.sourceTotalPages,
      source_page_size: summary.sourcePageSize,
      source_total_headers_estimate: summary.sourceTotalHeadersEstimate,
      pages_completed: summary.pagesCompleted,
      pages_failed: summary.pagesFailed,
      headers_upserted: summary.headersUpserted,
      details_attempted: summary.detailsAttempted,
      details_succeeded: summary.detailsSucceeded,
      details_failed: summary.detailsFailed,
      items_upserted: summary.itemsUpserted,
    })
    .eq('id', runId)

  if (error) throw new Error(`Could not finish Fishbowl SO sync run: ${error.message}`)
}

function orderNumber(order: FBRawSalesOrder): string | null {
  const value = order.number ?? order.soNumber ?? order.salesOrderNumber
  return value === undefined || value === null || value === '' ? null : String(value)
}

function fishbowlId(order: FBRawSalesOrder): string | null {
  return order.id === undefined || order.id === null || order.id === '' ? null : String(order.id)
}

export async function startSalesOrderBackfill(
  supabase: SupabaseClient,
  client: FishbowlClient
) {
  const pageSize = DEFAULT_PAGE_SIZE
  const run = await createRun(supabase, 'backfill', { pageSize })

  try {
    const page = await getSalesOrdersPage(client, 1, pageSize)
    const totalPages = page.totalPages
    const sourceTotalHeadersEstimate = page.totalCount ?? totalPages * page.pageSize
    const checkpoints = Array.from({ length: totalPages }, (_, index) => ({
      page_number: index + 1,
      page_size: page.pageSize,
      status: 'pending',
      updated_at: new Date().toISOString(),
    }))

    await insertCheckpointChunks(supabase, checkpoints)
    await supabase
      .from('fishbowl_so_page_checkpoints')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('status', 'paused')
    await supabase
      .from('fishbowl_so_detail_queue')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('status', 'paused')

    const summary = {
      sourceTotalPages: totalPages,
      sourcePageSize: page.pageSize,
      sourceTotalHeadersEstimate,
      pageCheckpoints: checkpoints.length,
    }
    await finishRun(supabase, run.id, 'success', summary)
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishRun(supabase, run.id, 'failed', {}, message)
    throw error
  }
}

export async function pauseSalesOrderBackfill(supabase: SupabaseClient) {
  const now = new Date().toISOString()
  const [pages, details] = await Promise.all([
    supabase
      .from('fishbowl_so_page_checkpoints')
      .update({ status: 'paused', updated_at: now })
      .in('status', ['pending', 'running', 'failed']),
    supabase
      .from('fishbowl_so_detail_queue')
      .update({ status: 'paused', updated_at: now })
      .in('status', ['pending', 'running', 'failed']),
  ])

  if (pages.error) throw new Error(`Could not pause page checkpoints: ${pages.error.message}`)
  if (details.error) throw new Error(`Could not pause detail queue: ${details.error.message}`)
  return { paused: true }
}

export async function retryFailedSalesOrderBackfill(supabase: SupabaseClient) {
  const now = new Date().toISOString()
  const [pages, details] = await Promise.all([
    supabase
      .from('fishbowl_so_page_checkpoints')
      .update({ status: 'pending', attempts: 0, last_error: null, updated_at: now })
      .eq('status', 'failed'),
    supabase
      .from('fishbowl_so_detail_queue')
      .update({ status: 'pending', attempts: 0, last_error: null, updated_at: now })
      .eq('status', 'failed'),
  ])

  if (pages.error) throw new Error(`Could not reset failed page checkpoints: ${pages.error.message}`)
  if (details.error) throw new Error(`Could not reset failed detail rows: ${details.error.message}`)
  return { resetFailed: true }
}

export async function prepareSalesOrderIncrementalCheckpoints(
  supabase: SupabaseClient,
  client: FishbowlClient
) {
  const pageSize = DEFAULT_PAGE_SIZE
  const incrementalPages = Math.max(1, DEFAULT_INCREMENTAL_PAGES)
  const run = await createRun(supabase, 'incremental', { pageSize, incrementalPages })

  try {
    const page = await getSalesOrdersPage(client, 1, pageSize)
    const totalPages = page.totalPages
    const sourceTotalHeadersEstimate = page.totalCount ?? totalPages * page.pageSize
    const checkpoints = Array.from({ length: totalPages }, (_, index) => ({
      page_number: index + 1,
      page_size: page.pageSize,
      status: 'pending',
      updated_at: new Date().toISOString(),
    }))

    await insertCheckpointChunks(supabase, checkpoints)

    const recentPageNumbers = selectIncrementalSalesOrderPages(totalPages, incrementalPages)

    const { error } = await supabase
      .from('fishbowl_so_page_checkpoints')
      .update({
        status: 'pending',
        attempts: 0,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('page_size', page.pageSize)
      .in('page_number', recentPageNumbers)

    if (error) throw new Error(`Could not requeue recent Fishbowl SO pages: ${error.message}`)

    const summary = {
      sourceTotalPages: totalPages,
      sourcePageSize: page.pageSize,
      sourceTotalHeadersEstimate,
      pagesRequeued: recentPageNumbers.length,
      requeuedPageNumbers: recentPageNumbers,
      pageCheckpoints: checkpoints.length,
    }
    await finishRun(supabase, run.id, 'success', summary)
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishRun(supabase, run.id, 'failed', {}, message)
    throw error
  }
}

export async function processSalesOrderPageBatch(
  supabase: SupabaseClient,
  client: FishbowlClient,
  options: PageBatchOptions = {}
) {
  const pageSize = DEFAULT_PAGE_SIZE
  const pageBatch = DEFAULT_PAGE_BATCH
  const maxAttempts = DEFAULT_MAX_ATTEMPTS
  const run = await createRun(supabase, 'pages', { pageSize, pageBatch })
  let pagesCompleted = 0
  let pagesFailed = 0
  let headersUpserted = 0
  let detailsQueued = 0

  try {
    let checkpointQuery = supabase
      .from('fishbowl_so_page_checkpoints')
      .select('page_number, page_size, attempts')
      .eq('page_size', pageSize)
      .in('status', ['pending', 'failed'])
      .lt('attempts', maxAttempts)
      .order('page_number', { ascending: true })
      .limit(pageBatch)

    if (options.pageNumbers?.length) {
      checkpointQuery = checkpointQuery.in('page_number', options.pageNumbers)
    }

    const { data, error } = await checkpointQuery

    if (error) throw new Error(`Could not read Fishbowl SO checkpoints: ${error.message}`)
    const checkpoints = (data ?? []) as PageCheckpoint[]

    for (const checkpoint of checkpoints) {
      const attempts = (checkpoint.attempts ?? 0) + 1
      await supabase
        .from('fishbowl_so_page_checkpoints')
        .update({
          status: 'running',
          attempts,
          started_at: new Date().toISOString(),
          last_run_id: run.id,
          updated_at: new Date().toISOString(),
        })
        .eq('page_number', checkpoint.page_number)
        .eq('page_size', checkpoint.page_size)

      try {
        const page = await getSalesOrdersPage(client, checkpoint.page_number, checkpoint.page_size)
        const cacheResult = await upsertSalesOrdersToCache(supabase, page.results, {
          sourcePageNumber: checkpoint.page_number,
          // List rows are sparse — they must never overwrite hydrated fields.
          sparse: true,
        })
        const queueRows: Array<Record<string, unknown>> = page.results
          .map((order) => ({
            fishbowl_id: fishbowlId(order),
            so_number: orderNumber(order),
            status: 'pending',
            updated_at: new Date().toISOString(),
          }))
          .filter((row) => Boolean(row.so_number))

        if (queueRows.length > 0) {
          await insertQueueChunks(supabase, queueRows)
        }

        pagesCompleted++
        headersUpserted += cacheResult.orders
        detailsQueued += queueRows.length

        await supabase
          .from('fishbowl_so_page_checkpoints')
          .update({
            status: 'success',
            headers_found: page.results.length,
            headers_upserted: cacheResult.orders,
            details_queued: queueRows.length,
            completed_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('page_number', checkpoint.page_number)
          .eq('page_size', checkpoint.page_size)
      } catch (error) {
        pagesFailed++
        await supabase
          .from('fishbowl_so_page_checkpoints')
          .update({
            status: 'failed',
            last_error: error instanceof Error ? error.message : String(error),
            updated_at: new Date().toISOString(),
          })
          .eq('page_number', checkpoint.page_number)
          .eq('page_size', checkpoint.page_size)
      }
    }

    const summary = {
      pagesCompleted,
      pagesFailed,
      headersUpserted,
      detailsQueued,
    }
    await finishRun(supabase, run.id, pagesFailed > 0 ? 'partial' : 'success', summary)
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishRun(supabase, run.id, 'failed', {}, message)
    throw error
  }
}

export async function hydrateSalesOrderDetailBatch(
  supabase: SupabaseClient,
  client: FishbowlClient
) {
  const detailBatch = DEFAULT_DETAIL_BATCH
  const maxAttempts = DEFAULT_MAX_ATTEMPTS
  const run = await createRun(supabase, 'details', { detailBatch })
  let detailsAttempted = 0
  let detailsSucceeded = 0
  let detailsFailed = 0
  let itemsUpserted = 0

  try {
    const { data, error } = await supabase
      .from('fishbowl_so_detail_queue')
      .select('fishbowl_id, so_number, attempts')
      .in('status', ['pending', 'failed'])
      .lt('attempts', maxAttempts)
      .order('updated_at', { ascending: true })
      .limit(detailBatch)

    if (error) throw new Error(`Could not read Fishbowl SO detail queue: ${error.message}`)
    const rows = (data ?? []) as DetailQueueRow[]

    for (const row of rows) {
      detailsAttempted++
      const attempts = (row.attempts ?? 0) + 1
      await supabase
        .from('fishbowl_so_detail_queue')
        .update({
          status: 'running',
          attempts,
          last_attempted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('so_number', row.so_number)

      try {
        if (!row.fishbowl_id) throw new Error('Missing Fishbowl id for detail hydration')
        const detail = await getSalesOrderById(client, row.fishbowl_id)
        if (!detail) throw new Error(`Fishbowl detail not found for ${row.so_number}`)
        const cacheResult = await upsertSalesOrdersToCache(supabase, [detail], {
          includeDetailStatus: true,
          detailStatus: 'success',
        })

        detailsSucceeded++
        itemsUpserted += cacheResult.items

        await supabase
          .from('fishbowl_so_detail_queue')
          .update({
            status: 'success',
            line_count: cacheResult.items,
            last_error: null,
            hydrated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('so_number', row.so_number)
      } catch (error) {
        detailsFailed++
        const message = error instanceof Error ? error.message : String(error)
        await supabase
          .from('fb_sales_orders')
          .update({
            detail_status: 'failed',
            detail_attempted_at: new Date().toISOString(),
            detail_error: message,
          })
          .eq('so_number', row.so_number)
        await supabase
          .from('fishbowl_so_detail_queue')
          .update({
            status: 'failed',
            last_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq('so_number', row.so_number)
      }
    }

    let linkResult = null
    let linkError = null
    try {
      linkResult = await resolveSalesOrderOpportunityLinks(supabase)
    } catch (error) {
      linkError = error instanceof Error ? error.message : String(error)
    }

    const summary = {
      detailsAttempted,
      detailsSucceeded,
      detailsFailed,
      itemsUpserted,
      linkResult,
      linkError,
    }
    await finishRun(supabase, run.id, detailsFailed > 0 || linkError ? 'partial' : 'success', summary)
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishRun(supabase, run.id, 'failed', {}, message)
    throw error
  }
}

export async function getSalesOrderCoverage(supabase: SupabaseClient): Promise<SalesOrderCoverage> {
  const [
    headersRes,
    linesRes,
    checkpointsRes,
    pendingPagesRes,
    runningPagesRes,
    completedPagesRes,
    failedPagesRes,
    queuedRes,
    pendingDetailsRes,
    runningDetailsRes,
    hydratedRes,
    failedDetailsRes,
    latestRunRes,
    activeRunRes,
    latestBusinessDateRes,
    latestCreatedDateRes,
    latestSourceSeenRes,
  ] = await Promise.all([
    supabase.from('fb_sales_orders').select('*', { count: 'estimated', head: true }),
    supabase.from('fb_sales_order_items').select('*', { count: 'estimated', head: true }),
    supabase.from('fishbowl_so_page_checkpoints').select('*', { count: 'estimated', head: true }),
    supabase.from('fishbowl_so_page_checkpoints').select('*', { count: 'estimated', head: true }).eq('status', 'pending'),
    supabase.from('fishbowl_so_page_checkpoints').select('*', { count: 'estimated', head: true }).eq('status', 'running'),
    supabase.from('fishbowl_so_page_checkpoints').select('*', { count: 'estimated', head: true }).eq('status', 'success'),
    supabase.from('fishbowl_so_page_checkpoints').select('*', { count: 'estimated', head: true }).eq('status', 'failed'),
    supabase.from('fishbowl_so_detail_queue').select('*', { count: 'estimated', head: true }),
    supabase.from('fishbowl_so_detail_queue').select('*', { count: 'estimated', head: true }).eq('status', 'pending'),
    supabase.from('fishbowl_so_detail_queue').select('*', { count: 'estimated', head: true }).eq('status', 'running'),
    supabase.from('fishbowl_so_detail_queue').select('*', { count: 'estimated', head: true }).eq('status', 'success'),
    supabase.from('fishbowl_so_detail_queue').select('*', { count: 'estimated', head: true }).eq('status', 'failed'),
    supabase
      .from('fishbowl_so_sync_runs')
      .select('mode, status, source_total_pages, source_page_size, source_total_headers_estimate, started_at, completed_at')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('fishbowl_so_sync_runs')
      .select('mode, started_at')
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('fb_sales_orders')
      .select('sales_order_metric_at')
      .not('sales_order_metric_at', 'is', null)
      .order('sales_order_metric_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('fb_sales_orders')
      .select('date_created')
      .not('date_created', 'is', null)
      .order('date_created', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('fb_sales_orders')
      .select('source_last_seen_at')
      .not('source_last_seen_at', 'is', null)
      .order('source_last_seen_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ])

  const latestRun = latestRunRes.data as {
    mode?: SyncRunMode | null
    status?: string | null
    source_total_pages?: number | null
    source_page_size?: number | null
    source_total_headers_estimate?: number | null
    started_at?: string | null
    completed_at?: string | null
  } | null
  const activeRun = activeRunRes.data as {
    mode?: SyncRunMode | null
    started_at?: string | null
  } | null
  const latestBusinessDate = latestBusinessDateRes.data as {
    sales_order_metric_at?: string | null
  } | null
  const latestCreatedDate = latestCreatedDateRes.data as {
    date_created?: string | null
  } | null
  const latestSourceSeen = latestSourceSeenRes.data as {
    source_last_seen_at?: string | null
  } | null
  const sourceTotalPages = latestRun?.source_total_pages ?? checkpointsRes.count ?? 0
  const sourcePageSize = latestRun?.source_page_size ?? DEFAULT_PAGE_SIZE
  const sourceTotalHeadersEstimate = latestRun?.source_total_headers_estimate ?? sourceTotalPages * sourcePageSize
  const pagesCompleted = completedPagesRes.count ?? 0
  const pageCheckpoints = checkpointsRes.count ?? 0
  const pagesRunning = runningPagesRes.count ?? 0
  const detailRunning = runningDetailsRes.count ?? 0
  const backfillStatus = pageCheckpoints === 0
    ? 'not_started'
    : pagesCompleted >= pageCheckpoints
      ? 'complete'
      : (failedPagesRes.count ?? 0) > 0
        ? 'partial'
        : 'running'

  return {
    sourceTotalPages,
    sourcePageSize,
    sourceTotalHeadersEstimate,
    cachedHeaders: headersRes.count ?? 0,
    cachedLineItems: linesRes.count ?? 0,
    pageCheckpoints,
    pagesPending: pendingPagesRes.count ?? 0,
    pagesRunning,
    pagesCompleted,
    pagesFailed: failedPagesRes.count ?? 0,
    detailQueued: queuedRes.count ?? 0,
    detailPending: pendingDetailsRes.count ?? 0,
    detailRunning,
    detailHydrated: hydratedRes.count ?? 0,
    detailFailed: failedDetailsRes.count ?? 0,
    latestCachedSalesOrderDate: latestBusinessDate?.sales_order_metric_at ?? null,
    latestCachedDateCreated: latestCreatedDate?.date_created ?? null,
    latestSourceLastSeenAt: latestSourceSeen?.source_last_seen_at ?? null,
    lastRunAt: activeRun?.started_at ?? latestRun?.completed_at ?? latestRun?.started_at ?? null,
    lastRunStatus: activeRun ? 'running' : latestRun?.status ?? null,
    lastRunMode: activeRun?.mode ?? latestRun?.mode ?? null,
    activeRunStartedAt: activeRun?.started_at ?? null,
    backfillStatus,
  }
}
