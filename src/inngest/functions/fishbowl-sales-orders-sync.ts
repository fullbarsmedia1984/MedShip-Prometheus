import { inngest } from '../client'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFishbowlConnectionProfile, type FishbowlClient } from '@/lib/fishbowl/client'
import { FishbowlSessionLockError, withFishbowlSession } from '@/lib/fishbowl/session'
import { createSalesforceClient } from '@/lib/salesforce/client'
import {
  mirrorCanonicalSalesOrdersToSalesforce,
  type MirrorResult,
} from '@/lib/salesforce/quote-order-mirror'
import {
  hydrateSalesOrderDetailBatch,
  pauseSalesOrderBackfill,
  prepareSalesOrderIncrementalCheckpoints,
  processSalesOrderPageBatch,
  refreshIssuedDatesFromSource,
  retryFailedSalesOrderBackfill,
  discoverSalesOrdersByIdWindow,
  startSalesOrderBackfill,
} from '@/lib/fishbowl/sales-order-completeness'
import { logSyncEvent, updateSyncSchedule } from '@/lib/utils/logger'
import { runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'
import { sendAlertEmail } from '@/lib/utils/notifications'

type P7Action =
  | 'backfill.start'
  | 'backfill.pages'
  | 'detail.hydrate'
  | 'incremental'
  | 'pause'
  | 'retry.failed'
  | 'salesforce.mirror'

function numericResultValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function countProcessedRows(result: Record<string, unknown>) {
  const pages = result.pages && typeof result.pages === 'object'
    ? result.pages as Record<string, unknown>
    : null
  const details = result.details && typeof result.details === 'object'
    ? result.details as Record<string, unknown>
    : null
  const idDiscovery = result.idDiscovery && typeof result.idDiscovery === 'object'
    ? result.idDiscovery as Record<string, unknown>
    : null

  return numericResultValue(result.headersUpserted)
    + numericResultValue(result.detailsSucceeded)
    + numericResultValue(pages?.headersUpserted)
    + numericResultValue(idDiscovery?.headersUpserted)
    + numericResultValue(idDiscovery?.discoveredOrders)
    + numericResultValue(details?.detailsSucceeded)
}

const DEFAULT_SO_FRESHNESS_MAX_DAYS = Number(process.env.FISHBOWL_SO_FRESHNESS_MAX_DAYS ?? 30)
const DEFAULT_SO_STALE_ALERT_COOLDOWN_MINUTES = Number(
  process.env.FISHBOWL_SO_STALE_ALERT_COOLDOWN_MINUTES ?? 360
)

class SalesOrderFreshnessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SalesOrderFreshnessError'
  }
}

function parseIsoDate(value: unknown): Date | null {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function ageInDays(date: Date, now = new Date()) {
  return (now.getTime() - date.getTime()) / 86_400_000
}

async function maybeNotifyStaleSalesOrderCache(
  supabase: ReturnType<typeof createAdminClient>,
  details: {
    latestSalesOrderDate: string | null
    latestDateCreated: string | null
    latestSourceLastSeenAt: string | null
    ageDays: number | null
    maxAgeDays: number
    message: string
  }
) {
  const settingKey = 'p7_sales_order_stale_cache_alert'
  const now = new Date()
  const cooldownMinutes = Math.max(15, DEFAULT_SO_STALE_ALERT_COOLDOWN_MINUTES)
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', settingKey)
    .maybeSingle()

  const value = data?.value as { lastNotifiedAt?: string } | string | null | undefined
  const lastNotifiedAt = typeof value === 'string' ? value : value?.lastNotifiedAt
  const lastNotifiedDate = parseIsoDate(lastNotifiedAt)
  if (lastNotifiedDate && now.getTime() - lastNotifiedDate.getTime() < cooldownMinutes * 60_000) {
    return { sent: false, skipped: true, reason: 'cooldown' }
  }

  const text = [
    'P7 Fishbowl Sales Order cache freshness check failed.',
    '',
    details.message,
    '',
    `Latest issued SO business date: ${details.latestSalesOrderDate ?? 'none'}`,
    `Latest Fishbowl date_created: ${details.latestDateCreated ?? 'none'}`,
    `Latest source_last_seen_at: ${details.latestSourceLastSeenAt ?? 'none'}`,
    `Age in days: ${details.ageDays === null ? 'unknown' : details.ageDays.toFixed(1)}`,
    `Allowed age in days: ${details.maxAgeDays}`,
    '',
    'Prometheus marked the P7 run failed because a green sync status with stale business data is unsafe.',
  ].join('\n')

  const result = await sendAlertEmail({
    subject: '[Prometheus] P7 Fishbowl Sales Order cache is stale',
    text,
  })

  await supabase
    .from('app_settings')
    .upsert({
      key: settingKey,
      value: {
        lastNotifiedAt: now.toISOString(),
        latestSalesOrderDate: details.latestSalesOrderDate,
        latestDateCreated: details.latestDateCreated,
        latestSourceLastSeenAt: details.latestSourceLastSeenAt,
        ageDays: details.ageDays,
        maxAgeDays: details.maxAgeDays,
        sent: result.sent,
        provider: result.provider,
        error: result.error,
      },
      updated_at: now.toISOString(),
    })

  return result
}

async function assertSalesOrderCacheFreshness(supabase: ReturnType<typeof createAdminClient>) {
  const maxAgeDays = Math.max(1, DEFAULT_SO_FRESHNESS_MAX_DAYS)
  const [latestBusinessDateRes, latestCreatedDateRes, latestSourceSeenRes] = await Promise.all([
    supabase
      .from('fb_sales_orders')
      .select('sales_order_metric_at')
      .eq('canonical_state', 'order')
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

  if (latestBusinessDateRes.error) {
    throw new Error(`Could not read latest Fishbowl SO business date: ${latestBusinessDateRes.error.message}`)
  }

  const latestSalesOrderDate = latestBusinessDateRes.data?.sales_order_metric_at ?? null
  const latestDate = parseIsoDate(latestSalesOrderDate)
  const currentAgeDays = latestDate ? ageInDays(latestDate) : null

  if (latestDate && currentAgeDays !== null && currentAgeDays <= maxAgeDays) {
    return {
      fresh: true,
      latestSalesOrderDate,
      ageDays: currentAgeDays,
      maxAgeDays,
    }
  }

  const message = latestDate
    ? `Latest issued Fishbowl Sales Order business date is ${currentAgeDays?.toFixed(1)} days old, above the ${maxAgeDays}-day freshness threshold.`
    : 'No issued Fishbowl Sales Order business date is cached.'

  await maybeNotifyStaleSalesOrderCache(supabase, {
    latestSalesOrderDate,
    latestDateCreated: latestCreatedDateRes.data?.date_created ?? null,
    latestSourceLastSeenAt: latestSourceSeenRes.data?.source_last_seen_at ?? null,
    ageDays: currentAgeDays,
    maxAgeDays,
    message,
  })

  throw new SalesOrderFreshnessError(message)
}

async function withP7FishbowlSession<T>(operation: (client: FishbowlClient) => Promise<T>) {
  return withFishbowlSession(
    {
      automation: 'P7_FB_SO_SYNC',
      sourceSystem: 'fishbowl',
      targetSystem: 'prometheus',
    },
    operation
  )
}

async function mirrorHydratedRowsToSalesforce(supabase: ReturnType<typeof createAdminClient>) {
  const sfClient = createSalesforceClient()
  try {
    await runWithAuthCircuitBreaker(
      {
        system: 'salesforce',
        automation: 'P7_FB_SO_SYNC',
        sourceSystem: 'prometheus',
        targetSystem: 'salesforce',
      },
      () => sfClient.connect()
    )

    try {
      return await mirrorCanonicalSalesOrdersToSalesforce(sfClient, supabase)
    } finally {
      await sfClient.disconnect()
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown Salesforce mirror error',
    }
  }
}

async function runFishbowlSalesOrderSync(triggeredBy: string, action: P7Action = 'incremental') {
  const startTime = Date.now()
  const connection = getFishbowlConnectionProfile()
  const supabase = createAdminClient()

  try {
    if (triggeredBy === 'schedule' && !(await isP7ScheduleActive(supabase))) {
      return {
        action,
        skipped: true,
        reason: 'P7_FB_SO_SYNC is disabled in sync_schedules',
      }
    }

    let result: Record<string, unknown>
    let salesforceMirror: MirrorResult | null = null

    if (action === 'pause') {
      result = await pauseSalesOrderBackfill(supabase)
    } else if (action === 'retry.failed') {
      result = await retryFailedSalesOrderBackfill(supabase)
    } else if (action === 'backfill.start') {
      result = await startOrResumeBackfillChunk(supabase)
    } else if (action === 'backfill.pages') {
      result = await withP7FishbowlSession((client) => processSalesOrderPageBatch(supabase, client))
    } else if (action === 'detail.hydrate') {
      result = await withP7FishbowlSession((client) => hydrateSalesOrderDetailBatch(supabase, client))
    } else if (action === 'salesforce.mirror') {
      const mirrorResult = await mirrorHydratedRowsToSalesforce(supabase)
      salesforceMirror = 'error' in mirrorResult ? null : mirrorResult
      result = { salesforceMirror }
      if ('error' in mirrorResult) {
        result = { ...result, salesforceMirrorError: mirrorResult.error }
      }
    } else {
      result = await processIncrementalChunk(supabase)
    }

    await logSyncEvent({
      automation: 'P7_FB_SO_SYNC',
      sourceSystem: action === 'salesforce.mirror' ? 'prometheus' : 'fishbowl',
      targetSystem: action === 'salesforce.mirror' ? 'salesforce' : 'prometheus',
      status: 'success',
      payload: { triggeredBy, action, connection },
      response: { result, salesforceMirror },
    })

    await updateSyncSchedule('P7_FB_SO_SYNC', {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'success',
      lastRunDurationMs: Date.now() - startTime,
      recordsProcessed: countProcessedRows(result),
    })

    return {
      action,
      result,
      salesforceMirror,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const isLocked = error instanceof FishbowlSessionLockError

    await logSyncEvent({
      automation: 'P7_FB_SO_SYNC',
      sourceSystem: action === 'salesforce.mirror' ? 'prometheus' : 'fishbowl',
      targetSystem: action === 'salesforce.mirror' ? 'salesforce' : 'prometheus',
      status: isLocked ? 'dismissed' : 'failed',
      payload: { triggeredBy, action, connection },
      errorMessage,
    })

    await updateSyncSchedule('P7_FB_SO_SYNC', {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: isLocked ? 'skipped' : 'failed',
      lastRunDurationMs: Date.now() - startTime,
      recordsProcessed: 0,
    })

    if (isLocked) {
      return {
        action,
        skipped: true,
        reason: errorMessage,
      }
    }

    throw error
  }
}

async function isP7ScheduleActive(supabase: ReturnType<typeof createAdminClient>) {
  const { data, error } = await supabase
    .from('sync_schedules')
    .select('is_active')
    .eq('automation', 'P7_FB_SO_SYNC')
    .maybeSingle()

  if (error) {
    console.warn('Could not read P7 sync schedule; allowing scheduled run', {
      error: error.message,
    })
    return true
  }

  return data?.is_active !== false
}

async function startIfNeeded(supabase: ReturnType<typeof createAdminClient>) {
  const { data, error } = await supabase
    .from('fishbowl_so_page_checkpoints')
    .select('id')
    .limit(1)

  if (error) throw new Error(`Could not check Fishbowl SO checkpoints: ${error.message}`)
  if ((data ?? []).length > 0) return { skipped: true, reason: 'checkpoints_exist' }

  return withP7FishbowlSession((client) => startSalesOrderBackfill(supabase, client))
}

async function processIncrementalChunk(supabase: ReturnType<typeof createAdminClient>) {
  const started = await startIfNeeded(supabase)

  return withP7FishbowlSession(async (client) => {
    const prepared = await prepareSalesOrderIncrementalCheckpoints(supabase, client)
    const pages = await processSalesOrderPageBatch(supabase, client, {
      pageNumbers: Array.isArray(prepared.requeuedPageNumbers)
        ? prepared.requeuedPageNumbers.filter((page): page is number => typeof page === 'number')
        : undefined,
    })
    const idDiscovery = await discoverSalesOrdersByIdWindow(supabase, client)
    const details = await hydrateSalesOrderDetailBatch(supabase, client)
    let issuedDates: Record<string, unknown>
    try {
      issuedDates = await refreshIssuedDatesFromSource(supabase, client)
    } catch (error) {
      // Enrichment is best-effort; the data-query endpoint may be unavailable.
      issuedDates = { error: error instanceof Error ? error.message : String(error) }
    }
    const freshness = await assertSalesOrderCacheFreshness(supabase)

    return { started, prepared, pages, idDiscovery, details, issuedDates, freshness }
  })
}

async function startOrResumeBackfillChunk(supabase: ReturnType<typeof createAdminClient>) {
  return withP7FishbowlSession(async (client) => {
    const started = await startSalesOrderBackfill(supabase, client)
    const pages = await processSalesOrderPageBatch(supabase, client)
    const details = await hydrateSalesOrderDetailBatch(supabase, client)

    return { started, pages, details }
  })
}

export const fishbowlSalesOrdersSync = inngest.createFunction(
  {
    id: 'fishbowl-sales-orders-sync',
    name: 'P7: Fishbowl Sales Orders Sync',
    retries: 2,
    triggers: [{ cron: '5,20,35,50 * * * *' }],
  },
  async ({ step }) => {
    return step.run('sync-fishbowl-sales-orders', () =>
      runFishbowlSalesOrderSync('schedule', 'incremental')
    )
  }
)

export const fishbowlSalesOrdersSyncManual = inngest.createFunction(
  {
    id: 'fishbowl-sales-orders-sync-manual',
    name: 'P7: Fishbowl Sales Orders Sync (Manual)',
    retries: 2,
    triggers: [{ event: 'fishbowl/sales-orders.sync' }],
  },
  async ({ event, step }) => {
    return step.run('sync-fishbowl-sales-orders-manual', () =>
      runFishbowlSalesOrderSync(
        event.data.triggeredBy ?? 'manual',
        event.data.action ?? (event.data.fullSync ? 'backfill.start' : 'incremental')
      )
    )
  }
)

export const fishbowlSalesOrdersBackfillPages = inngest.createFunction(
  {
    id: 'fishbowl-sales-orders-backfill-pages',
    name: 'P7: Fishbowl Sales Orders Backfill Pages',
    retries: 2,
    triggers: [{ event: 'fishbowl/sales-orders.backfill.pages' }],
  },
  async ({ event, step }) => {
    return step.run('fishbowl-sales-orders-backfill-pages', () =>
      runFishbowlSalesOrderSync(event.data.triggeredBy ?? 'manual', 'backfill.pages')
    )
  }
)

export const fishbowlSalesOrdersDetailHydrate = inngest.createFunction(
  {
    id: 'fishbowl-sales-orders-detail-hydrate',
    name: 'P7: Fishbowl Sales Orders Detail Hydrate',
    retries: 2,
    triggers: [{ event: 'fishbowl/sales-orders.detail.hydrate' }],
  },
  async ({ event, step }) => {
    return step.run('fishbowl-sales-orders-detail-hydrate', () =>
      runFishbowlSalesOrderSync(event.data.triggeredBy ?? 'manual', 'detail.hydrate')
    )
  }
)
