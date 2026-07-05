import { describe, it, expect } from 'vitest'
import {
  DEFAULT_INCENTIVE_SETTINGS,
  parseIncentiveSettings,
  validateIncentiveSettings,
} from '../settings'

describe('parseIncentiveSettings', () => {
  it('falls back to defaults for missing/garbage values', () => {
    expect(parseIncentiveSettings(null)).toEqual(DEFAULT_INCENTIVE_SETTINGS)
    expect(parseIncentiveSettings(undefined)).toEqual(DEFAULT_INCENTIVE_SETTINGS)
    expect(parseIncentiveSettings(42)).toEqual(DEFAULT_INCENTIVE_SETTINGS)
    expect(parseIncentiveSettings('not json {')).toEqual(DEFAULT_INCENTIVE_SETTINGS)
  })

  it('parses a stored snake_case object', () => {
    const parsed = parseIncentiveSettings({
      promo_start: '2026-07-01',
      promo_end: '2026-09-30',
      enrollment_gate: 3,
      base_rate: 0.05,
      bonus_rate: 0.03,
      new_rate: 0.07,
      winback_rate: 0.055,
      recurring_rate_full: 0.045,
      recurring_rate_partial: 0.035,
      recurring_rate_zero: 0.025,
      new_window_days: 60,
      win_back_gap_days: 400,
    })
    expect(parsed).toEqual({
      promoStart: '2026-07-01',
      promoEnd: '2026-09-30',
      enrollmentGate: 3,
      baseRate: 0.05,
      bonusRate: 0.03,
      newRate: 0.07,
      winbackRate: 0.055,
      recurringRateFull: 0.045,
      recurringRatePartial: 0.035,
      recurringRateZero: 0.025,
      newWindowDays: 60,
      winBackGapDays: 400,
    })
  })

  it('fills missing tiered rates with defaults (pre-034 stored config)', () => {
    const parsed = parseIncentiveSettings({
      promo_start: '2026-07-01',
      promo_end: '2026-09-30',
      enrollment_gate: 2,
      base_rate: 0.04,
      bonus_rate: 0.02,
      new_window_days: 90,
      win_back_gap_days: 365,
    })
    expect(parsed.newRate).toBe(0.06)
    expect(parsed.winbackRate).toBe(0.05)
    expect(parsed.recurringRateFull).toBe(0.04)
    expect(parsed.recurringRatePartial).toBe(0.03)
    expect(parsed.recurringRateZero).toBe(0.02)
  })

  it('tolerates double-encoded JSONB strings', () => {
    const parsed = parseIncentiveSettings(
      JSON.stringify({
        promo_start: '2026-07-01',
        promo_end: '2026-09-30',
        enrollment_gate: 4,
        base_rate: 0.04,
        bonus_rate: 0.02,
        new_window_days: 90,
        win_back_gap_days: 365,
      })
    )
    expect(parsed.enrollmentGate).toBe(4)
  })

  it('rejects invalid stored values by returning defaults (never partially-bad config)', () => {
    const parsed = parseIncentiveSettings({
      promo_start: '2026-12-01',
      promo_end: '2026-01-01', // start >= end
      enrollment_gate: 2,
      base_rate: 0.04,
      bonus_rate: 0.02,
      new_window_days: 90,
      win_back_gap_days: 365,
    })
    expect(parsed).toEqual(DEFAULT_INCENTIVE_SETTINGS)
  })
})

describe('validateIncentiveSettings', () => {
  it('accepts the defaults', () => {
    expect(validateIncentiveSettings(DEFAULT_INCENTIVE_SETTINGS)).toEqual([])
  })

  it('rejects non-integer or negative gates', () => {
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, enrollmentGate: -1 })).not.toEqual([])
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, enrollmentGate: 1.5 })).not.toEqual([])
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, enrollmentGate: 0 })).toEqual([])
  })

  it('requires rates strictly between 0 and 1', () => {
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, baseRate: 0 })).not.toEqual([])
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, baseRate: 1 })).not.toEqual([])
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, bonusRate: 4 })).not.toEqual([])
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, bonusRate: 0.02 })).toEqual([])
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, newRate: 0 })).not.toEqual([])
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, winbackRate: 1.5 })).not.toEqual([])
  })

  it('requires recurring tiers ordered zero <= partial <= full', () => {
    expect(
      validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, recurringRatePartial: 0.05 })
    ).not.toEqual([]) // partial > full
    expect(
      validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, recurringRateZero: 0.035 })
    ).not.toEqual([]) // zero > partial
    expect(
      validateIncentiveSettings({
        ...DEFAULT_INCENTIVE_SETTINGS,
        recurringRateZero: 0.02,
        recurringRatePartial: 0.03,
        recurringRateFull: 0.04,
      })
    ).toEqual([])
  })

  it('requires ISO dates with start before end', () => {
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, promoStart: '07/01/2026' })).not.toEqual([])
    expect(
      validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, promoStart: '2026-09-30', promoEnd: '2026-07-01' })
    ).not.toEqual([])
  })

  it('requires positive integer day windows', () => {
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, newWindowDays: 0 })).not.toEqual([])
    expect(validateIncentiveSettings({ ...DEFAULT_INCENTIVE_SETTINGS, winBackGapDays: 0.5 })).not.toEqual([])
  })
})
