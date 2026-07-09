// Types for the Q3 incentive layer. Rows mirror the SQL surfaces created in
// migrations 023-027 (v_incentive_rep_month, order_incentive_class,
// customer_first_order, v_incentive_unmapped_salespersons,
// v_customer_merge_candidates, customer_merge_map, incentive_bell_log).

export type IncentiveClass =
  | 'NEW_WINDOW'
  | 'RECURRING'
  | 'WIN_BACK'
  | 'EXCLUDED_HOUSE'
  | 'EXCLUDED_NO_REP'
  | 'EXCLUDED_NEGATIVE'

export interface IncentiveSettings {
  promoStart: string // YYYY-MM-DD (America/Chicago calendar date, inclusive)
  promoEnd: string // YYYY-MM-DD (inclusive)
  enrollmentGate: number
  // Legacy flat model — kept for the honest "vs old 4% flat" comparison only.
  baseRate: number
  bonusRate: number
  // Tiered cohort model (migration 034): NEW pays newRate, WINBACK pays
  // winbackRate, RECURRING pays full/partial/zero by monthly NEW enrollments.
  newRate: number
  winbackRate: number
  recurringRateFull: number
  recurringRatePartial: number
  recurringRateZero: number
  newWindowDays: number
  winBackGapDays: number
}

export interface RepIncentiveMonthlyRow {
  rep_key: string
  rep_display_name: string | null
  month: string // YYYY-MM-DD (first of month, America/Chicago)
  in_promo_period: boolean
  enrollments: number
  enrollment_gate: number
  qualifies: boolean // enrollments >= gate (full recurring rate earned)
  recurring_rate: number // the tier rate actually applied this month
  order_count: number
  new_order_count: number
  winback_order_count: number
  recurring_order_count: number
  new_revenue: number
  winback_revenue: number
  recurring_revenue: number
  attributed_revenue: number
  credit_amount: number // negative; already netted inside the cohort buckets
  credit_count: number
  blocking_unmapped_count: number
  // NULL when payout is blocked by unmapped rep strings (fail-loudly contract)
  new_commission: number | null
  winback_commission: number | null
  recurring_commission: number | null
  projected_total: number | null
  legacy_flat_commission: number | null // what the old 4% flat model would pay
}

export interface OrderIncentiveClassRow {
  so_number: string
  canonical_customer_key: string | null
  order_at: string
  order_month: string
  salesperson_raw: string | null
  rep_key: string | null
  rep_display_name: string | null
  rep_unmapped: boolean
  amount: number | null
  net_amount: number
  class: IncentiveClass
  class_reason: string
  prior_order_so_number: string | null
  prior_order_at: string | null
  prior_gap_days: number | null
  is_first_order: boolean
}

export interface OrderIncentiveDetailRow extends OrderIncentiveClassRow {
  customer_name: string | null
  status: string | null
}

export interface CustomerFirstOrderRow {
  canonical_customer_key: string
  first_order_so_number: string | null
  first_order_at: string | null
  new_window_end: string | null
  first_order_salesperson: string | null
  first_order_month: string | null
  is_quote_only: boolean
  order_count: number
}

export interface UnmappedRepRow {
  fishbowl_salesperson: string
  order_count_all_time: number
  order_count_in_period: number
  amount_in_period: number
  last_order_at: string | null
}

export interface MergeMapRow {
  duplicate_key: string
  canonical_key: string
  reason: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MergeCandidateRow {
  key_a: string
  key_b: string
  name_a: string | null
  name_b: string | null
  orders_a: number
  orders_b: number
  last_order_a: string | null
  last_order_b: string | null
  name_similarity: number | null
  street_similarity: number | null
  exact_normalized_match: boolean
}

export interface BellLogRow {
  canonical_key: string
  so_number: string | null
  rep: string | null
  institution: string | null
  amount: number | null
  rung_at: string
  webhook_sent: boolean
  webhook_error: string | null
}

export interface RepNewAccount {
  canonicalKey: string
  institution: string | null
  firstOrderAt: string
  windowEnd: string
  daysLeft: number
  revenueInWindow: number
}

export interface IncentiveRefreshState {
  dirty_at: string | null
  last_refresh_at: string | null
  last_refresh_result: Record<string, unknown> | null
}

export interface PayoutSnapshotRow {
  month: string // YYYY-MM-DD (first of month)
  rep_key: string
  rep_display_name: string | null
  enrollments: number
  enrollment_gate: number
  qualifies: boolean
  recurring_rate: number
  new_revenue: number
  winback_revenue: number
  recurring_revenue: number
  new_commission: number
  winback_commission: number
  recurring_commission: number
  projected_total: number
  legacy_flat_commission: number
  frozen_at: string
  frozen_by: string | null
}

export interface PayoutVarianceRow {
  month: string
  rep_key: string
  rep_display_name: string | null
  frozen_at: string
  frozen_total: number
  live_total: number
  variance: number
  frozen_enrollments: number
  live_enrollments: number
  frozen_qualifies: boolean
  live_qualifies: boolean
  rep_gone_from_live: boolean
  live_blocked: boolean
}
