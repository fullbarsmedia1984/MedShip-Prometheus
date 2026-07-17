import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'
import { createFishbowlClient, type FishbowlClient } from './client'

type FishbowlAutomation =
  | 'P1_OPP_TO_SO'
  | 'P2_INVENTORY_SYNC'
  | 'P7_FB_SO_SYNC'
  | 'P11_PO_SYNC'
  | 'P12_SHIPMENTS_SYNC'
  | 'P14_RECEIPTS_SYNC'
  | 'P15_PRODUCT_PARTS_SYNC'

type FishbowlSessionOptions = {
  automation: FishbowlAutomation
  sourceSystem: string
  targetSystem: string
  lockTtlMs?: number
  priority?: 'normal' | 'p7-critical'
}

type LockValue = {
  owner: string
  automation: FishbowlAutomation
  sourceSystem: string
  targetSystem: string
  acquiredAt: string
  expiresAt: string
}

type LockRow = {
  value: LockValue | null
}

const LOCK_KEY = 'fishbowl_session_lock'
const DEFAULT_LOCK_TTL_MS = 15 * 60_000
const DEFAULT_P7_FRESHNESS_MAX_DAYS = Number(process.env.FISHBOWL_SO_FRESHNESS_MAX_DAYS ?? 30)

export class FishbowlPriorityYieldError extends Error {
  constructor(message = 'Fishbowl session yielded to P7 sales order sync priority') {
    super(message)
    this.name = 'FishbowlPriorityYieldError'
  }
}

export class FishbowlSessionLockError extends Error {
  constructor(
    public readonly expiresAt: string | null,
    message = expiresAt
      ? `Fishbowl session lock is held until ${expiresAt}`
      : 'Fishbowl session lock is held'
  ) {
    super(message)
    this.name = 'FishbowlSessionLockError'
  }
}

function getLockTtlMs(options: FishbowlSessionOptions) {
  return Number(process.env.FISHBOWL_SESSION_LOCK_TTL_MS ?? options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS)
}

function createLockValue(options: FishbowlSessionOptions): LockValue {
  const acquiredAt = new Date()
  return {
    owner: randomUUID(),
    automation: options.automation,
    sourceSystem: options.sourceSystem,
    targetSystem: options.targetSystem,
    acquiredAt: acquiredAt.toISOString(),
    expiresAt: new Date(acquiredAt.getTime() + getLockTtlMs(options)).toISOString(),
  }
}

async function readLock(supabase: SupabaseClient) {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', LOCK_KEY)
    .maybeSingle()

  return (data as LockRow | null)?.value ?? null
}

function parseDate(value: unknown): Date | null {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function isTruthyEnv(value: string | undefined) {
  return value !== '0' && value !== 'false' && value !== 'FALSE'
}

async function isP7SalesOrderCacheStale(supabase: SupabaseClient) {
  const maxAgeDays = Math.max(1, DEFAULT_P7_FRESHNESS_MAX_DAYS)
  const { data, error } = await supabase
    .from('fb_sales_orders')
    .select('sales_order_metric_at')
    .eq('canonical_state', 'order')
    .not('sales_order_metric_at', 'is', null)
    .order('sales_order_metric_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    // Fail open here. A transient Supabase read error should not block all
    // Fishbowl work forever; P7 still has its own freshness guard.
    console.warn('Could not read P7 freshness before Fishbowl session:', error)
    return false
  }

  const latestDate = parseDate((data as { sales_order_metric_at?: string | null } | null)?.sales_order_metric_at)
  if (!latestDate) return true

  return Date.now() - latestDate.getTime() > maxAgeDays * 86_400_000
}

async function hasActiveP7Run(supabase: SupabaseClient) {
  // Only recent runs count as active: crashed runs leave 'running' rows
  // behind forever, and without a cutoff they starve every other Fishbowl
  // automation (P2 yielded on 24 zombie rows dating back to 2026-07-01).
  const activeCutoff = new Date(Date.now() - 60 * 60_000).toISOString()
  const { data, error } = await supabase
    .from('fishbowl_so_sync_runs')
    .select('id')
    .eq('status', 'running')
    .in('mode', ['backfill', 'pages', 'details', 'incremental'])
    .gte('started_at', activeCutoff)
    .limit(1)

  if (error) {
    console.warn('Could not read P7 active run before Fishbowl session:', error)
    return false
  }

  return (data ?? []).length > 0
}

async function shouldYieldToP7(supabase: SupabaseClient, options: FishbowlSessionOptions) {
  if (options.automation === 'P7_FB_SO_SYNC') return false
  if (!isTruthyEnv(process.env.P7_FISHBOWL_PRIORITY_ENABLED)) return false

  const lock = await readLock(supabase)
  if (lock?.automation === 'P7_FB_SO_SYNC') return true

  return (await hasActiveP7Run(supabase)) || (await isP7SalesOrderCacheStale(supabase))
}

async function acquireFishbowlLock(
  supabase: SupabaseClient,
  options: FishbowlSessionOptions
) {
  if (await shouldYieldToP7(supabase, options)) {
    throw new FishbowlPriorityYieldError()
  }

  const lockValue = createLockValue(options)
  const now = new Date().toISOString()

  const inserted = await supabase
    .from('app_settings')
    .insert({
      key: LOCK_KEY,
      value: lockValue,
      updated_at: now,
    })
    .select('key')
    .single()

  if (!inserted.error) return lockValue
  if (inserted.error.code !== '23505') {
    throw new Error(`Could not acquire Fishbowl session lock: ${inserted.error.message}`)
  }

  const updated = await supabase
    .from('app_settings')
    .update({
      value: lockValue,
      updated_at: now,
    })
    .eq('key', LOCK_KEY)
    .lt('value->>expiresAt', now)
    .select('key')
    .maybeSingle()

  if (updated.error) {
    throw new Error(`Could not acquire expired Fishbowl session lock: ${updated.error.message}`)
  }

  if (updated.data) return lockValue

  const current = await readLock(supabase)
  throw new FishbowlSessionLockError(current?.expiresAt ?? null)
}

async function releaseFishbowlLock(supabase: SupabaseClient, owner: string) {
  const current = await readLock(supabase)
  if (current?.owner !== owner) return

  const { error } = await supabase
    .from('app_settings')
    .delete()
    .eq('key', LOCK_KEY)

  if (error) {
    console.error('Could not release Fishbowl session lock:', error)
  }
}

export async function withFishbowlSession<T>(
  options: FishbowlSessionOptions,
  operation: (client: FishbowlClient) => Promise<T>
) {
  const supabase = createAdminClient()
  const lock = await acquireFishbowlLock(supabase, options)
  let client: FishbowlClient | null = null

  try {
    client = createFishbowlClient()
    const activeClient = client
    await runWithAuthCircuitBreaker(
      {
        system: 'fishbowl',
        automation: options.automation,
        sourceSystem: options.sourceSystem,
        targetSystem: options.targetSystem,
      },
      () => activeClient.authenticate()
    )

    return await operation(activeClient)
  } finally {
    await client?.logout()
    await releaseFishbowlLock(supabase, lock.owner)
  }
}
