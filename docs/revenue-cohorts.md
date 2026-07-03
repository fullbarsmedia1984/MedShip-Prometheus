# Revenue Cohorts — NEW / WINBACK / RECURRING

> Context doc for anyone (human or agent) building on the cohort layer — e.g. the
> sales compensation model. Everything here is live in production Supabase
> (project `qknotdnyewlvtucuzklk`) as of 2026-07-03. Validation report:
> https://claude.ai/code/artifact/6a718a85-9fb9-4459-8590-920aa18b303f

## Business rules (confirmed by Steven, 2026-07-03)

- **NEW** — customer has *never* bought before, ever. Their first-ever issued SO
  opens a **365-day NEW period**; every order inside it is New-business revenue.
  After that the customer is Recurring (or Winback if they lapse).
- **WINBACK** — customer bought before but has a **≥365-day gap** since their
  previous order. The returning SO opens a **365-day WINBACK period**; orders
  inside it are Winback revenue. **Re-entrant**: every fresh 365-day lapse starts
  a new Winback period (823 customers hold 1,281 winback periods historically).
- **RECURRING** — every other issued order (outside any active NEW/WINBACK period).
- **LAPSED** — customer *state* only (not an order cohort): no purchase in 365+
  days; their next order will enter as WINBACK.

Purpose: future comp model pays reps differently on New vs Winback vs Recurring sales.

## Where the data lives

| Object | What it is |
| --- | --- |
| `order_revenue_cohort` | One row per issued SO: `cohort`, `is_cohort_entry` (opened the period), `cohort_entered_at`, `cohort_entry_so`, `cohort_expires_at`, `prior_gap_days`, `cohort_reason` (human-readable audit), `amount`, `order_month` (America/Chicago), `canonical_customer_key` |
| `v_revenue_cohort_monthly` | Month × cohort rollup: orders, customers, cohort_entries, revenue |
| `v_customer_cohort_current` | Per customer TODAY: `current_cohort` ∈ NEW / WINBACK / RECURRING / LAPSED, last SO, period expiry |
| `refresh_revenue_cohorts(new_days, gap_days, winback_days)` | Full deterministic rebuild (defaults 365/365/365). SECURITY DEFINER, service-role only. Runs automatically via the P8 Inngest cron whenever orders / customer merges / rep aliases change; callable directly for ad-hoc what-ifs (e.g. 180-day windows) |
| Migration | `supabase/migrations/028_revenue_cohort_engine.sql` |
| App layer | `src/lib/cohorts.ts` (typed queries), `/dashboard/sales` → "Revenue Cohorts" section |

## Semantics the comp model must respect

1. **Customer identity is the canonical merge key** —
   `resolve_canonical_customer_key(business_customer_key)` (migration 023).
   Duplicate customer records share one history, so "first-ever" can't be gamed
   by a duplicate account. ~293 merge candidates still await human review at
   `/dashboard/incentives/admin#merge-map`; merging re-classifies history
   automatically.
2. **Order date = `sales_order_metric_at`** = COALESCE(issue date, completion,
   creation) — Dan's rule: an SO issued May 25 is May revenue. Months bucket in
   **America/Chicago**.
3. **Lapse boundary is ≥ 365 days** (a gap of exactly 365 days IS a winback),
   matching the Q3 incentive engine. Cross-validated: the two engines agree on
   every win-back order.
4. **Scope: all issued SOs are cohorted** — house-account, unmapped-rep, credit
   (negative) orders included. This layer answers "what kind of revenue was it?".
   *Commission eligibility* is the separate incentive layer
   (`order_incentive_class`, `v_incentive_rep_month` — migrations 026/027): rep
   attribution, house/no-rep/negative exclusions, negative netting,
   enrollment gates. If comp pays per-cohort, compose the two: cohort picks the
   rate; incentive rules pick eligibility and the rep.
5. **Derived tables are TRUNCATE+rebuilt** — never treat `order_revenue_cohort`
   rows as stable ids; recompute can relabel history when late issue dates or
   merges arrive. Read at query time; don't snapshot without a freeze step.
6. **Windows are per-customer, not calendar** — a NEW period can straddle months
   and years. Attribute revenue to months via `order_month`, membership via the
   period columns.

## Current numbers (2026-07-03, post-repair, all invariants green)

- 17,373 issued SOs classified, 2,791 customers (Feb 2013 – Jul 2026)
- NEW: 6,872 SOs / $16.45M / 2,791 first-ever entries
- WINBACK: 3,335 SOs / $14.24M / 1,281 entries by 823 customers
- RECURRING: 7,166 SOs / $25.14M / 572 customers
- Customer states today: 153 NEW · 173 WINBACK · 258 RECURRING · 2,207 LAPSED

## Gotchas

- The Fishbowl **detail** endpoint never returns `dateIssued` (only the list
  endpoint does). Any sync writing `fb_sales_orders` must never null-fill
  `date_issued` — see `upsertSalesOrdersToCache` (sparse/compact handling) and
  the 2026-07-01/03 sparse-overwrite incident before copying its pattern.
- The Q3 incentive program's "new customer window" is **90 days** (promo bonus
  window) and is a *different* concept from the 365-day NEW cohort. Don't mix
  them: `order_incentive_class.class = 'NEW_WINDOW'` ≠ `order_revenue_cohort.cohort = 'NEW'`.
- Rep attribution for comp: `order_incentive_class` carries `rep_key` /
  `rep_unmapped` per SO (order-level rep earns the revenue; first-order rep
  earns enrollment credit under the Q3 program — PRD §5).
