import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { runWithAuthCircuitBreaker } from '@/lib/utils/circuit-breaker'
import { createFishbowlClient, type FishbowlClient } from './client'

type FishbowlAutomation =
  | 'P1_OPP_TO_SO'
  | 'P2_INVENTORY_SYNC'
  | 'P7_FB_SO_SYNC'

type FishbowlSessionOptions = {
  automation: FishbowlAutomation
  sourceSystem: string
  targetSystem: string
  lockTtlMs?: number
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

async function acquireFishbowlLock(
  supabase: SupabaseClient,
  options: FishbowlSessionOptions
) {
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
  const client = createFishbowlClient()

  try {
    await runWithAuthCircuitBreaker(
      {
        system: 'fishbowl',
        automation: options.automation,
        sourceSystem: options.sourceSystem,
        targetSystem: options.targetSystem,
      },
      () => client.authenticate()
    )

    return await operation(client)
  } finally {
    await client.logout()
    await releaseFishbowlLock(supabase, lock.owner)
  }
}
