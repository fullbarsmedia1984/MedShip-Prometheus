import { createAdminClient } from '@/lib/supabase/admin'
import type { IncentiveSettings } from './types'

// Single source of truth for the admin-adjustable incentive parameters.
// Stored in app_settings under one key as snake_case JSONB (the SQL side
// reads the same key via get_incentive_settings(), migration 024).
export const INCENTIVE_SETTINGS_KEY = 'incentive_program'

export const DEFAULT_INCENTIVE_SETTINGS: IncentiveSettings = {
  promoStart: '2026-07-01',
  promoEnd: '2026-09-30',
  enrollmentGate: 2,
  baseRate: 0.04,
  bonusRate: 0.02,
  newWindowDays: 90,
  winBackGapDays: 365,
}

// Cache in memory for 30 seconds to avoid hammering the DB (same pattern
// as src/lib/utils/app-settings.ts)
let cached: { value: IncentiveSettings; expires: number } | null = null

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function toFiniteNumber(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : raw
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function parseIncentiveSettings(raw: unknown): IncentiveSettings {
  let value = raw
  // Tolerate double-encoded JSONB (same quirk parseMode() handles)
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { ...DEFAULT_INCENTIVE_SETTINGS }
    }
  }
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_INCENTIVE_SETTINGS }
  }
  const obj = value as Record<string, unknown>
  const candidate: IncentiveSettings = {
    promoStart: typeof obj.promo_start === 'string' ? obj.promo_start : DEFAULT_INCENTIVE_SETTINGS.promoStart,
    promoEnd: typeof obj.promo_end === 'string' ? obj.promo_end : DEFAULT_INCENTIVE_SETTINGS.promoEnd,
    enrollmentGate: toFiniteNumber(obj.enrollment_gate) ?? DEFAULT_INCENTIVE_SETTINGS.enrollmentGate,
    baseRate: toFiniteNumber(obj.base_rate) ?? DEFAULT_INCENTIVE_SETTINGS.baseRate,
    bonusRate: toFiniteNumber(obj.bonus_rate) ?? DEFAULT_INCENTIVE_SETTINGS.bonusRate,
    newWindowDays: toFiniteNumber(obj.new_window_days) ?? DEFAULT_INCENTIVE_SETTINGS.newWindowDays,
    winBackGapDays: toFiniteNumber(obj.win_back_gap_days) ?? DEFAULT_INCENTIVE_SETTINGS.winBackGapDays,
  }
  return validateIncentiveSettings(candidate).length === 0
    ? candidate
    : { ...DEFAULT_INCENTIVE_SETTINGS }
}

/**
 * Returns a list of human-readable validation errors (empty = valid).
 * Shared by the settings PATCH route so route validation and storage
 * validation cannot drift.
 */
export function validateIncentiveSettings(settings: IncentiveSettings): string[] {
  const errors: string[] = []
  if (!ISO_DATE.test(settings.promoStart)) errors.push('promoStart must be YYYY-MM-DD')
  if (!ISO_DATE.test(settings.promoEnd)) errors.push('promoEnd must be YYYY-MM-DD')
  if (ISO_DATE.test(settings.promoStart) && ISO_DATE.test(settings.promoEnd) && settings.promoStart >= settings.promoEnd) {
    errors.push('promoStart must be before promoEnd')
  }
  if (!Number.isInteger(settings.enrollmentGate) || settings.enrollmentGate < 0) {
    errors.push('enrollmentGate must be an integer >= 0')
  }
  if (!(settings.baseRate > 0 && settings.baseRate < 1)) errors.push('baseRate must be between 0 and 1 (exclusive)')
  if (!(settings.bonusRate > 0 && settings.bonusRate < 1)) errors.push('bonusRate must be between 0 and 1 (exclusive)')
  if (!Number.isInteger(settings.newWindowDays) || settings.newWindowDays < 1) {
    errors.push('newWindowDays must be an integer >= 1')
  }
  if (!Number.isInteger(settings.winBackGapDays) || settings.winBackGapDays < 1) {
    errors.push('winBackGapDays must be an integer >= 1')
  }
  return errors
}

function toStorageShape(settings: IncentiveSettings): Record<string, unknown> {
  return {
    promo_start: settings.promoStart,
    promo_end: settings.promoEnd,
    enrollment_gate: settings.enrollmentGate,
    base_rate: settings.baseRate,
    bonus_rate: settings.bonusRate,
    new_window_days: settings.newWindowDays,
    win_back_gap_days: settings.winBackGapDays,
  }
}

export async function getIncentiveSettings(): Promise<IncentiveSettings> {
  if (cached && cached.expires > Date.now()) {
    return cached.value
  }
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', INCENTIVE_SETTINGS_KEY)
      .single()

    const settings = parseIncentiveSettings(data?.value)
    cached = { value: settings, expires: Date.now() + 30_000 }
    return settings
  } catch {
    return { ...DEFAULT_INCENTIVE_SETTINGS }
  }
}

export async function updateIncentiveSettings(patch: Partial<IncentiveSettings>): Promise<IncentiveSettings> {
  const current = await getIncentiveSettings()
  const next: IncentiveSettings = { ...current, ...patch }
  const errors = validateIncentiveSettings(next)
  if (errors.length > 0) {
    throw new Error(`Invalid incentive settings: ${errors.join('; ')}`)
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('app_settings')
    .upsert({
      key: INCENTIVE_SETTINGS_KEY,
      value: toStorageShape(next),
      updated_at: new Date().toISOString(),
    })
  if (error) throw error

  cached = null
  return next
}

export function clearIncentiveSettingsCache() {
  cached = null
}
