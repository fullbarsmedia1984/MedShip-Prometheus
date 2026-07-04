// Pure commission/qualification math for the Q3 incentive. No I/O — the
// authoritative figures come from v_incentive_rep_month (migration 027);
// these helpers re-derive them for display, counterfactuals, and unit tests.

import type { IncentiveClass, IncentiveSettings, RepIncentiveMonthlyRow } from './types'

// Historical context for the manager gate-feasibility chart: company-wide
// first-ever-order customers ran 5-26/month (discovery, Jul 2026); a
// 4-rep roster at gate=2 needs 8/month.
export const GATE_FEASIBILITY_BAND = {
  historicalLow: 5,
  historicalHigh: 26,
  rosterRequirementPerMonth: 8,
} as const

export interface CommissionBreakdown {
  qualifies: boolean
  blocked: boolean
  base: number | null
  bonus: number | null
  projected: number | null
}

export interface Counterfactual {
  enrollmentsAway: number
  bonusAtStake: number
  message: string
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/**
 * Prefer the rollup's precomputed figures (they carry the fail-loudly NULL
 * contract); re-derive from rates only to fill display gaps. Blocked rows
 * always return null figures.
 */
export function computeCommission(row: RepIncentiveMonthlyRow, settings: IncentiveSettings): CommissionBreakdown {
  const blocked = row.blocking_unmapped_count > 0
  const qualifies = row.enrollments >= (row.enrollment_gate ?? settings.enrollmentGate)

  if (blocked) {
    return { qualifies, blocked: true, base: null, bonus: null, projected: null }
  }

  const base = row.base_commission ?? round2(settings.baseRate * row.attributed_revenue)
  const bonus = row.bonus_commission ?? (qualifies ? round2(settings.bonusRate * row.net_new_customer_revenue) : 0)
  const projected = row.projected_total ?? round2(base + bonus)
  return { qualifies, blocked: false, base, bonus, projected }
}

/**
 * "1 enrollment away from unlocking +2% on $X." Returns null once the rep
 * qualifies (nothing to unlock).
 */
export function computeCounterfactual(row: RepIncentiveMonthlyRow, settings: IncentiveSettings): Counterfactual | null {
  const gate = row.enrollment_gate ?? settings.enrollmentGate
  if (row.enrollments >= gate) return null

  const enrollmentsAway = gate - row.enrollments
  const bonusAtStake = round2(settings.bonusRate * row.net_new_customer_revenue)
  const pct = `${(settings.bonusRate * 100).toFixed(0)}%`
  const noun = enrollmentsAway === 1 ? 'enrollment' : 'enrollments'
  return {
    enrollmentsAway,
    bonusAtStake,
    message: `${enrollmentsAway} ${noun} away from unlocking +${pct} on ${formatUsd(row.net_new_customer_revenue)}`,
  }
}

/** Whole days remaining in a 90-day window, clamped at 0 once expired. */
export function computeWindowDaysLeft(windowEnd: string, now: Date = new Date()): number {
  const end = new Date(windowEnd).getTime()
  if (!Number.isFinite(end)) return 0
  const msLeft = end - now.getTime()
  return Math.max(0, Math.ceil(msLeft / 86_400_000))
}

/**
 * Fail-loudly gate: payout figures must not render anywhere while any
 * salesperson string with in-period orders is unmapped. The count is a
 * global (same on every rollup row), so take the max, not a sum.
 */
export function isPayoutBlocked(
  rows: Array<Pick<RepIncentiveMonthlyRow, 'blocking_unmapped_count'>>
): { blocked: boolean; count: number } {
  const count = rows.reduce((max, row) => Math.max(max, row.blocking_unmapped_count ?? 0), 0)
  return { blocked: count > 0, count }
}

export type BadgeTone = 'success' | 'info' | 'warning' | 'danger' | 'muted'

/** Display label + tone for a classification. Never throws on unknown input. */
export function classReasonLabel(cls: IncentiveClass | string): { label: string; tone: BadgeTone } {
  switch (cls) {
    case 'NEW_WINDOW':
      return { label: 'New customer', tone: 'success' }
    case 'RECURRING':
      return { label: 'Recurring', tone: 'info' }
    case 'WIN_BACK':
      return { label: 'Win-back (no bonus)', tone: 'warning' }
    case 'EXCLUDED_HOUSE':
      return { label: 'House account', tone: 'muted' }
    case 'EXCLUDED_NO_REP':
      return { label: 'No rep', tone: 'danger' }
    case 'EXCLUDED_NEGATIVE':
      return { label: 'Credit / return', tone: 'danger' }
    default:
      return { label: String(cls || 'Unknown'), tone: 'muted' }
  }
}

/** Convert a per-month requirement to a weekly pace for the trend chart. */
export function monthlyRequirementToWeeklyPace(perMonth: number): number {
  return (perMonth * 12) / 52
}
