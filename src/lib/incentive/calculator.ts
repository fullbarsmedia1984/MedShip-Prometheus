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
  recurringRate: number
  newCommission: number | null
  winbackCommission: number | null
  recurringCommission: number | null
  projected: number | null
  legacyFlat: number | null
  deltaVsLegacy: number | null // negative = quota penalty vs the old 4% flat model
}

export interface Counterfactual {
  enrollmentsAway: number
  currentRate: number
  fullRate: number
  recurringAtStake: number // extra $ on this month's recurring book at the full rate
  message: string
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function pct(rate: number): string {
  const value = rate * 100
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`
}

/** The recurring-commission tier a given enrollment count earns. */
export function recurringTierRate(enrollments: number, gate: number, settings: IncentiveSettings): number {
  if (enrollments >= gate) return settings.recurringRateFull
  if (enrollments >= 1) return settings.recurringRatePartial
  return settings.recurringRateZero
}

/**
 * Prefer the rollup's precomputed figures (they carry the fail-loudly NULL
 * contract); re-derive from rates only to fill display gaps. Blocked rows
 * always return null figures.
 */
export function computeCommission(row: RepIncentiveMonthlyRow, settings: IncentiveSettings): CommissionBreakdown {
  const blocked = row.blocking_unmapped_count > 0
  const gate = row.enrollment_gate ?? settings.enrollmentGate
  const qualifies = row.enrollments >= gate
  const recurringRate = row.recurring_rate ?? recurringTierRate(row.enrollments, gate, settings)

  if (blocked) {
    return {
      qualifies, blocked: true, recurringRate,
      newCommission: null, winbackCommission: null, recurringCommission: null,
      projected: null, legacyFlat: null, deltaVsLegacy: null,
    }
  }

  const newCommission = row.new_commission ?? round2(settings.newRate * row.new_revenue)
  const winbackCommission = row.winback_commission ?? round2(settings.winbackRate * row.winback_revenue)
  const recurringCommission = row.recurring_commission ?? round2(recurringRate * row.recurring_revenue)
  const projected = row.projected_total ?? round2(newCommission + winbackCommission + recurringCommission)
  const legacyFlat = row.legacy_flat_commission ?? round2(settings.baseRate * row.attributed_revenue)
  return {
    qualifies, blocked: false, recurringRate,
    newCommission, winbackCommission, recurringCommission,
    projected, legacyFlat,
    deltaVsLegacy: round2(projected - legacyFlat),
  }
}

/**
 * What the enrollment quota is worth: "N more enrollments lift your recurring
 * rate from X% to 4% — +$Y on this month's recurring book." Returns null once
 * the rep is at the full rate (nothing at stake).
 */
export function computeCounterfactual(row: RepIncentiveMonthlyRow, settings: IncentiveSettings): Counterfactual | null {
  const gate = row.enrollment_gate ?? settings.enrollmentGate
  if (row.enrollments >= gate) return null

  const currentRate = row.recurring_rate ?? recurringTierRate(row.enrollments, gate, settings)
  const fullRate = settings.recurringRateFull
  const enrollmentsAway = gate - row.enrollments
  const recurringAtStake = round2((fullRate - currentRate) * Math.max(row.recurring_revenue, 0))
  const noun = enrollmentsAway === 1 ? 'enrollment' : 'enrollments'
  return {
    enrollmentsAway,
    currentRate,
    fullRate,
    recurringAtStake,
    message: `${enrollmentsAway} more ${noun} lifts your recurring rate from ${pct(currentRate)} to ${pct(fullRate)} — worth ${formatUsd(recurringAtStake)} on this month's recurring book`,
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
      return { label: 'Win-back', tone: 'warning' }
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
