import { describe, it, expect } from 'vitest'
import {
  computeCommission,
  computeCounterfactual,
  computeWindowDaysLeft,
  isPayoutBlocked,
  classReasonLabel,
  monthlyRequirementToWeeklyPace,
  GATE_FEASIBILITY_BAND,
} from '../calculator'
import { DEFAULT_INCENTIVE_SETTINGS } from '../settings'
import type { RepIncentiveMonthlyRow } from '../types'

function row(overrides: Partial<RepIncentiveMonthlyRow> = {}): RepIncentiveMonthlyRow {
  const enrollments = overrides.enrollments ?? 0
  const gate = overrides.enrollment_gate ?? 2
  return {
    rep_key: '005XXX',
    rep_display_name: 'Test Rep',
    month: '2026-07-01',
    in_promo_period: true,
    enrollments,
    enrollment_gate: gate,
    qualifies: enrollments >= gate,
    recurring_rate: enrollments >= gate ? 0.04 : enrollments >= 1 ? 0.03 : 0.02,
    order_count: 10,
    new_order_count: 3,
    winback_order_count: 2,
    recurring_order_count: 5,
    new_revenue: 25_000,
    winback_revenue: 15_000,
    recurring_revenue: 60_000,
    attributed_revenue: 100_000,
    credit_amount: 0,
    credit_count: 0,
    blocking_unmapped_count: 0,
    new_commission: null,
    winback_commission: null,
    recurring_commission: null,
    projected_total: null,
    legacy_flat_commission: null,
    ...overrides,
  }
}

const settings = DEFAULT_INCENTIVE_SETTINGS

describe('computeCommission', () => {
  it('applies the penalty recurring rate at zero enrollments', () => {
    const result = computeCommission(row({ enrollments: 0 }), settings)
    expect(result.qualifies).toBe(false)
    expect(result.recurringRate).toBe(0.02)
    expect(result.newCommission).toBe(1500) // 6% of 25k
    expect(result.winbackCommission).toBe(750) // 5% of 15k
    expect(result.recurringCommission).toBe(1200) // 2% of 60k
    expect(result.projected).toBe(3450)
    expect(result.legacyFlat).toBe(4000) // 4% flat on 100k
    expect(result.deltaVsLegacy).toBe(-550) // the model CAN pay less
  })

  it('applies the partial recurring rate at one enrollment', () => {
    const result = computeCommission(row({ enrollments: 1 }), settings)
    expect(result.recurringRate).toBe(0.03)
    expect(result.recurringCommission).toBe(1800) // 3% of 60k
    expect(result.projected).toBe(4050)
    expect(result.deltaVsLegacy).toBe(50)
  })

  it('pays the full recurring rate exactly at the quota boundary', () => {
    const result = computeCommission(row({ enrollments: 2 }), settings)
    expect(result.qualifies).toBe(true)
    expect(result.recurringRate).toBe(0.04)
    expect(result.recurringCommission).toBe(2400) // 4% of 60k
    expect(result.projected).toBe(4650)
    expect(result.deltaVsLegacy).toBe(650)
  })

  it('respects an admin-raised gate from the row', () => {
    const result = computeCommission(
      row({ enrollments: 2, enrollment_gate: 3, recurring_rate: 0.03 }),
      settings
    )
    expect(result.qualifies).toBe(false)
    expect(result.recurringRate).toBe(0.03)
  })

  it('prefers precomputed rollup figures over derived ones', () => {
    const result = computeCommission(
      row({
        enrollments: 2,
        new_commission: 1501,
        winback_commission: 751,
        recurring_commission: 2401,
        projected_total: 4653,
        legacy_flat_commission: 4001,
      }),
      settings
    )
    expect(result.newCommission).toBe(1501)
    expect(result.winbackCommission).toBe(751)
    expect(result.recurringCommission).toBe(2401)
    expect(result.projected).toBe(4653)
    expect(result.legacyFlat).toBe(4001)
  })

  it('returns null figures when payout is blocked (fail-loudly)', () => {
    const result = computeCommission(row({ enrollments: 5, blocking_unmapped_count: 3 }), settings)
    expect(result.blocked).toBe(true)
    expect(result.newCommission).toBeNull()
    expect(result.recurringCommission).toBeNull()
    expect(result.projected).toBeNull()
    expect(result.deltaVsLegacy).toBeNull()
  })
})

describe('computeCounterfactual', () => {
  it('is null once the quota is met', () => {
    expect(computeCounterfactual(row({ enrollments: 2 }), settings)).toBeNull()
    expect(computeCounterfactual(row({ enrollments: 5 }), settings)).toBeNull()
  })

  it('quantifies the recurring rate at stake one enrollment away', () => {
    const cf = computeCounterfactual(row({ enrollments: 1 }), settings)
    expect(cf).not.toBeNull()
    expect(cf!.enrollmentsAway).toBe(1)
    expect(cf!.currentRate).toBe(0.03)
    expect(cf!.fullRate).toBe(0.04)
    expect(cf!.recurringAtStake).toBe(600) // (4% - 3%) of 60k
    expect(cf!.message).toBe(
      '1 more enrollment lifts your recurring rate from 3% to 4% — worth $600 on this month\'s recurring book'
    )
  })

  it('uses the floor rate at zero enrollments', () => {
    const cf = computeCounterfactual(row({ enrollments: 0 }), settings)
    expect(cf!.enrollmentsAway).toBe(2)
    expect(cf!.currentRate).toBe(0.02)
    expect(cf!.recurringAtStake).toBe(1200) // (4% - 2%) of 60k
    expect(cf!.message).toContain('2 more enrollments')
  })

  it('never reports negative stakes on a negative recurring book', () => {
    const cf = computeCounterfactual(row({ enrollments: 0, recurring_revenue: -5000, recurring_rate: 0.02 }), settings)
    expect(cf!.recurringAtStake).toBe(0)
  })
})

describe('computeWindowDaysLeft', () => {
  const now = new Date('2026-07-15T12:00:00Z')

  it('counts whole days remaining mid-window', () => {
    expect(computeWindowDaysLeft('2026-07-25T12:00:00Z', now)).toBe(10)
  })

  it('rounds partial days up (last day shows 1)', () => {
    expect(computeWindowDaysLeft('2026-07-16T06:00:00Z', now)).toBe(1)
  })

  it('clamps expired windows at 0', () => {
    expect(computeWindowDaysLeft('2026-07-01T00:00:00Z', now)).toBe(0)
  })

  it('returns 0 for garbage input', () => {
    expect(computeWindowDaysLeft('not-a-date', now)).toBe(0)
  })
})

describe('isPayoutBlocked', () => {
  it('is unblocked when all rows report zero', () => {
    const result = isPayoutBlocked([
      { blocking_unmapped_count: 0 },
      { blocking_unmapped_count: 0 },
    ])
    expect(result).toEqual({ blocked: false, count: 0 })
  })

  it('takes the max (global count repeats on every row), not a sum', () => {
    const result = isPayoutBlocked([
      { blocking_unmapped_count: 45 },
      { blocking_unmapped_count: 45 },
    ])
    expect(result).toEqual({ blocked: true, count: 45 })
  })

  it('handles an empty row set as unblocked', () => {
    expect(isPayoutBlocked([])).toEqual({ blocked: false, count: 0 })
  })
})

describe('classReasonLabel', () => {
  it('labels every known class', () => {
    expect(classReasonLabel('NEW_WINDOW')).toEqual({ label: 'New customer', tone: 'success' })
    expect(classReasonLabel('WIN_BACK').label).toBe('Win-back')
    expect(classReasonLabel('RECURRING').tone).toBe('info')
    expect(classReasonLabel('EXCLUDED_HOUSE').tone).toBe('muted')
    expect(classReasonLabel('EXCLUDED_NO_REP').tone).toBe('danger')
    expect(classReasonLabel('EXCLUDED_NEGATIVE').tone).toBe('danger')
  })

  it('never throws on unknown classes', () => {
    expect(classReasonLabel('EXCLUDED_SOMETHING_NEW')).toEqual({
      label: 'EXCLUDED_SOMETHING_NEW',
      tone: 'muted',
    })
    expect(classReasonLabel('')).toEqual({ label: 'Unknown', tone: 'muted' })
  })
})

describe('gate feasibility helpers', () => {
  it('converts monthly requirement to weekly pace', () => {
    expect(monthlyRequirementToWeeklyPace(GATE_FEASIBILITY_BAND.rosterRequirementPerMonth)).toBeCloseTo(1.846, 3)
  })
})
