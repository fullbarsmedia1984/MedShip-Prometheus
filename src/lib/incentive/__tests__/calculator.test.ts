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
  return {
    rep_key: '005XXX',
    rep_display_name: 'Test Rep',
    month: '2026-07-01',
    in_promo_period: true,
    enrollments: 0,
    enrollment_gate: 2,
    qualifies: false,
    order_count: 10,
    new_window_order_count: 3,
    attributed_revenue: 100_000,
    new_customer_revenue_gross: 25_000,
    net_new_customer_revenue: 25_000,
    win_back_revenue: 0,
    blocking_unmapped_count: 0,
    base_commission: null,
    bonus_commission: null,
    projected_total: null,
    ...overrides,
  }
}

const settings = DEFAULT_INCENTIVE_SETTINGS

describe('computeCommission', () => {
  it('pays base only below the gate', () => {
    const result = computeCommission(row({ enrollments: 1 }), settings)
    expect(result.qualifies).toBe(false)
    expect(result.base).toBe(4000) // 4% of 100k
    expect(result.bonus).toBe(0)
    expect(result.projected).toBe(4000)
  })

  it('pays base + bonus exactly at the gate boundary', () => {
    const result = computeCommission(row({ enrollments: 2 }), settings)
    expect(result.qualifies).toBe(true)
    expect(result.base).toBe(4000)
    expect(result.bonus).toBe(500) // 2% of 25k
    expect(result.projected).toBe(4500)
  })

  it('respects an admin-raised gate from the row', () => {
    const result = computeCommission(row({ enrollments: 2, enrollment_gate: 3 }), settings)
    expect(result.qualifies).toBe(false)
    expect(result.bonus).toBe(0)
  })

  it('qualifies everyone at gate 0', () => {
    const result = computeCommission(row({ enrollments: 0, enrollment_gate: 0 }), settings)
    expect(result.qualifies).toBe(true)
    expect(result.bonus).toBe(500)
  })

  it('prefers precomputed rollup figures over derived ones', () => {
    const result = computeCommission(
      row({ enrollments: 2, base_commission: 4001, bonus_commission: 501, projected_total: 4502 }),
      settings
    )
    expect(result.base).toBe(4001)
    expect(result.bonus).toBe(501)
    expect(result.projected).toBe(4502)
  })

  it('returns null figures when payout is blocked (fail-loudly)', () => {
    const result = computeCommission(row({ enrollments: 5, blocking_unmapped_count: 3 }), settings)
    expect(result.blocked).toBe(true)
    expect(result.base).toBeNull()
    expect(result.bonus).toBeNull()
    expect(result.projected).toBeNull()
  })
})

describe('computeCounterfactual', () => {
  it('is null once qualifying', () => {
    expect(computeCounterfactual(row({ enrollments: 2 }), settings)).toBeNull()
    expect(computeCounterfactual(row({ enrollments: 5 }), settings)).toBeNull()
  })

  it('formats the exactly-one-away message', () => {
    const cf = computeCounterfactual(row({ enrollments: 1 }), settings)
    expect(cf).not.toBeNull()
    expect(cf!.enrollmentsAway).toBe(1)
    expect(cf!.bonusAtStake).toBe(500)
    expect(cf!.message).toBe('1 enrollment away from unlocking +2% on $25,000')
  })

  it('pluralizes when more than one away', () => {
    const cf = computeCounterfactual(row({ enrollments: 0 }), settings)
    expect(cf!.enrollmentsAway).toBe(2)
    expect(cf!.message).toContain('2 enrollments away')
  })

  it('scales bonus at stake with the bonus rate', () => {
    const cf = computeCounterfactual(row({ enrollments: 0 }), { ...settings, bonusRate: 0.05 })
    expect(cf!.bonusAtStake).toBe(1250)
    expect(cf!.message).toContain('+5%')
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
    expect(classReasonLabel('WIN_BACK').label).toContain('no bonus')
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
