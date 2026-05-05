import { createAdminClient } from '@/lib/supabase/admin'
import { sendAlertEmail } from '@/lib/utils/notifications'

export type ExternalSystem = 'salesforce' | 'fishbowl'

type CircuitBreakerState = {
  system: ExternalSystem
  isOpen: boolean
  openedAt: string
  expiresAt: string
  reason: string
  failureCount: number
  lastAutomation: string
  lastNotifiedAt?: string
}

type CircuitBreakerOptions = {
  system: ExternalSystem
  automation: string
  sourceSystem?: string
  targetSystem?: string
}

export class CircuitBreakerOpenError extends Error {
  constructor(
    public readonly system: ExternalSystem,
    public readonly expiresAt: string,
    message = `${system} auth circuit breaker is open until ${expiresAt}`
  ) {
    super(message)
    this.name = 'CircuitBreakerOpenError'
  }
}

const DEFAULT_LOCKOUT_MINUTES = 240
const DEFAULT_NOTIFY_COOLDOWN_MINUTES = 60

function getStateKey(system: ExternalSystem) {
  return `circuit_breaker:${system}`
}

function getLockoutMinutes() {
  return Number(process.env.AUTH_CIRCUIT_BREAKER_LOCKOUT_MINUTES ?? DEFAULT_LOCKOUT_MINUTES)
}

function getNotifyCooldownMinutes() {
  return Number(process.env.AUTH_CIRCUIT_BREAKER_NOTIFY_COOLDOWN_MINUTES ?? DEFAULT_NOTIFY_COOLDOWN_MINUTES)
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function isExternalAuthError(system: ExternalSystem, error: unknown) {
  const message = toErrorMessage(error).toLowerCase()
  const name = error instanceof Error ? error.name.toLowerCase() : ''

  if (system === 'salesforce') {
    return [
      'invalid_login',
      'invalid_grant',
      'login_must_use_security_token',
      'authentication',
      'password',
      'security token',
      'locked',
      'expired',
      'oauth',
    ].some((token) => message.includes(token) || name.includes(token))
  }

  return [
    'fishbowl login failed',
    'fishbowlautherror',
    'invalid credentials',
    'unauthorized',
    '401',
    'password',
    'approval',
  ].some((token) => message.includes(token) || name.includes(token))
}

async function getBreakerState(system: ExternalSystem): Promise<CircuitBreakerState | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', getStateKey(system))
    .maybeSingle()

  if (error) {
    console.error(`Failed to read ${system} circuit breaker state:`, error)
    return null
  }

  return (data?.value as CircuitBreakerState | undefined) ?? null
}

async function saveBreakerState(state: CircuitBreakerState) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('app_settings')
    .upsert({
      key: getStateKey(state.system),
      value: state,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    console.error(`Failed to persist ${state.system} circuit breaker state:`, error)
  }
}

async function updateConnectionError(system: ExternalSystem, reason: string) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('connection_configs')
    .update({
      last_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('system_name', system)

  if (error) {
    console.error(`Failed to update ${system} connection error:`, error)
  }
}

async function logCircuitBreakerEvent({
  system,
  automation,
  sourceSystem = system,
  targetSystem = 'prometheus',
  reason,
  status,
}: CircuitBreakerOptions & {
  reason: string
  status: 'failed' | 'dismissed'
}) {
  const now = new Date()
  const idempotencyWindow = now.toISOString().slice(0, 13)
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('sync_events')
    .upsert(
      {
        automation,
        source_system: sourceSystem,
        target_system: targetSystem,
        status,
        error_message: reason,
        payload: {
          circuitBreaker: true,
          system,
        },
        completed_at: now.toISOString(),
        idempotency_key: `circuit-breaker:${system}:${automation}:${idempotencyWindow}`,
      },
      { onConflict: 'idempotency_key' }
    )

  if (error) {
    console.error(`Failed to write ${system} circuit breaker sync event:`, error)
  }
}

async function notifyBreakerOpened(state: CircuitBreakerState) {
  const text = [
    `${state.system.toUpperCase()} authentication circuit breaker opened.`,
    '',
    `Automation: ${state.lastAutomation}`,
    `Opened at: ${state.openedAt}`,
    `Blocked until: ${state.expiresAt}`,
    `Failure count: ${state.failureCount}`,
    `Reason: ${state.reason}`,
    '',
    'Prometheus will skip matching sync attempts while this breaker is open to avoid repeated failed credential attempts.',
  ].join('\n')

  const result = await sendAlertEmail({
    subject: `[Prometheus] ${state.system.toUpperCase()} auth circuit breaker opened`,
    text,
  })

  if (!result.sent) {
    console.error('Circuit breaker alert email was not sent:', result)
  }

  return result
}

export async function assertCircuitClosed(options: CircuitBreakerOptions) {
  const state = await getBreakerState(options.system)
  const now = new Date()

  if (!state?.isOpen) return

  if (new Date(state.expiresAt).getTime() <= now.getTime()) {
    await saveBreakerState({ ...state, isOpen: false })
    return
  }

  const reason = `${options.system} auth circuit breaker is open. Last error: ${state.reason}`
  await logCircuitBreakerEvent({
    ...options,
    reason,
    status: 'dismissed',
  })

  throw new CircuitBreakerOpenError(options.system, state.expiresAt, reason)
}

export async function recordExternalAuthFailure(
  options: CircuitBreakerOptions,
  error: unknown
) {
  if (!isExternalAuthError(options.system, error)) return false

  const now = new Date()
  const existing = await getBreakerState(options.system)
  const state: CircuitBreakerState = {
    system: options.system,
    isOpen: true,
    openedAt: existing?.isOpen ? existing.openedAt : now.toISOString(),
    expiresAt: addMinutes(now, getLockoutMinutes()).toISOString(),
    reason: toErrorMessage(error),
    failureCount: (existing?.failureCount ?? 0) + 1,
    lastAutomation: options.automation,
    lastNotifiedAt: existing?.lastNotifiedAt,
  }

  const shouldNotify =
    !state.lastNotifiedAt ||
    now.getTime() - new Date(state.lastNotifiedAt).getTime() >
      getNotifyCooldownMinutes() * 60_000

  if (shouldNotify) {
    const result = await notifyBreakerOpened(state)
    state.lastNotifiedAt = now.toISOString()

    await logCircuitBreakerEvent({
      ...options,
      reason: `${state.reason}${result.sent ? '' : ` Alert email not sent: ${result.error}`}`,
      status: 'failed',
    })
  } else {
    await logCircuitBreakerEvent({
      ...options,
      reason: state.reason,
      status: 'failed',
    })
  }

  await updateConnectionError(options.system, state.reason)
  await saveBreakerState(state)
  return true
}

export async function runWithAuthCircuitBreaker<T>(
  options: CircuitBreakerOptions,
  operation: () => Promise<T>
) {
  await assertCircuitClosed(options)

  try {
    return await operation()
  } catch (error) {
    await recordExternalAuthFailure(options, error)
    throw error
  }
}
