# PRD: User Management, Authentication & Role-Based Access

**Product:** MedShip Prometheus / Zeus
**Author:** Drafted by Claude from the July 2026 discovery report and Steven's decisions
**Owner:** Steven (superadmin, product owner)
**Status:** Draft v0.2 — ready for Steven's review
**Last updated:** 2026-07-02

---

## 1. Problem Statement

Prometheus authenticates users with Supabase Auth but treats every authenticated user identically. There is one meaningful role (`admin`, checked on 4 mutation endpoints), no user/profile model, no invite or deactivation lifecycle, no audit trail of user actions, and database RLS policies that grant every authenticated user read access to every table — including external-system credentials, contract pricing, COGS, supplier cost data, and raw pricing ingestion rows.

The business is about to onboard sales reps and administrative staff into the dashboard. Before that can happen safely, the system needs a real role model, database-level enforcement, an invite/2FA login flow, and change auditing.

## 2. Goals

1. Four-tier role model — **superadmin, admin, staff, sales_rep** — enforced consistently at the route, page, and database (RLS) layers, with a reserved fifth role (**sales_manager**) for the compensation feature in progress.
2. Supabase Auth remains the single identity source: email + password login with **email-code 2FA**, invites and auth emails delivered via **Resend**.
3. A user lifecycle superadmin/admins can operate without touching the Supabase dashboard: invite, activate, assign role, deactivate.
4. Sensitive data classes (credentials, COGS, supplier costs, raw ingestion, comp) locked down at the database layer, so API-layer bugs can no longer expose them.
5. "Who changed what" auditing for users, roles, credentials, pricing settings, and roster.

### Non-Goals

- **Compensation model and estimator** — WIP in a parallel worktree (Fable). This PRD only reserves the `sales_manager` role and the comp visibility rules (rep sees own comp; sales_manager sees all).
- Who-*viewed* audit logging (explicitly out of scope per Steven — who-*changed* is sufficient).
- SSO/OAuth, SCIM, or multi-organization tenancy.
- QuickBooks-related auth (Phase 2 of the integration roadmap, unchanged).
- Rewriting the data layer away from the service-role client. RLS becomes defense-in-depth plus direct-PostgREST protection; the app keeps using `requireApiAuth()` as the primary API guard.

## 3. Personas & Roles

| Role | Who | Authority |
|---|---|---|
| `superadmin` | Steven (steven@fullbarsmedia.com) — **sole, cannot be demoted by anyone** | Everything: user management, role assignment/demotion of admins, credentials, destructive ops, all data |
| `admin` | Dan (CEO) and future grants by superadmin | Full business visibility and operational management. **Not** user management, credential management, or destructive system ops unless explicitly granted |
| `staff` | Administrative/operations staff | Daily workflows: quotes, orders, customers, vendors, products, inventory, sync monitoring/retry. No owner controls, no COGS/supplier costs, no comp controls |
| `sales_rep` | Sales team (identity anchored to Fishbowl user ID) | Own dashboard + scorecards; **all reps' performance indicators** (per decision); contract price visible **for now** (temporary grant, revoked when COGS/pricing automation completes); no COGS, supplier/vendor cost, raw ingestion, admin controls, or others' comp |
| `sales_manager` *(reserved)* | TBD with comp feature | Everything `sales_rep` has + all reps' compensation. Defined here so schema/claims don't need rework when comp lands |

**Role storage:** single role per user, stored in the `profiles` table (source of truth) and mirrored into the JWT via a Supabase **Custom Access Token Hook** so RLS policies can read it. `user_metadata` is **removed** as a role source (users can self-edit it — this is the standing privilege-escalation bug in `src/lib/auth.ts:107-108`). `app_metadata` remains acceptable as a mirror but the hook + profiles is authoritative.

**Existing users:** exactly 2 (verified live). Steven → `superadmin`; Dan → `admin`. No migration/transition period needed.

## 4. Decisions & Constraints (locked)

These came from Steven during discovery review and override any defaults:

1. Steven is the sole superadmin; can assign/demote admins; **cannot be demoted** (enforced server-side, see §7.4).
2. **Fishbowl user ID is canonical rep identity.** Salesforce user IDs map *to* it, not the reverse.
3. Reps see **all performance indicators for all reps** — no aggregate-only mode.
4. Comp visibility: rep sees own only; sales_manager sees all. (Deferred with the comp feature.)
5. Reps **can** see contract price until COGS/pricing automation is complete. Model this as a revocable permission flag, not a hardcoded rule.
6. Auth = **email + password with email 2FA** (code by email). Not passwordless.
7. Resend account is Steven's; auth/transactional email sends **from his domain** (fullbarsmedia) — no dependency on medicalshipment.com DNS.
8. Live DB has ~10 migrations not in the repo (016→022 gap + newer). **Schema reconciliation is a Phase 0 prerequisite** — see §12.
9. Salesforce webhook fail-open: undecided. Carried as an open item (§14); recommended fix is fail-closed in production.
10. Audit = who-changed only.

## 5. User Data Model

New table `profiles` (public schema), 1:1 with `auth.users`:

| Column | Notes |
|---|---|
| `id UUID PK` | FK → `auth.users.id`, `ON DELETE CASCADE` |
| `email` | mirrored for display/queries |
| `display_name` | |
| `role` | enum: `superadmin \| admin \| staff \| sales_rep \| sales_manager` |
| `is_active` | soft deactivation; inactive users fail auth checks even with a valid session |
| `fishbowl_user_id` | **canonical rep identity**; nullable for non-reps |
| `sf_user_id` | FK-ish → `sf_users.sf_id`; nullable |
| `can_view_contract_price` | temporary per-role-overridable flag (decision 5); default true for reps *for now* |
| `invited_by`, `invited_at`, `onboarded_at` | lifecycle |
| `created_at`, `updated_at`, `created_by`, `updated_by` | audit columns |

Supporting changes:

- `fishbowl_salesperson_aliases` gains `fishbowl_user_id` so alias strings resolve to the canonical identity; `profiles.fishbowl_user_id` joins through it. (Today the table only has alias name strings + `sf_user_id` — the canonical FB ID column does not exist yet.)
- A `handle_new_user` trigger on `auth.users` creates the profile row on signup/invite acceptance.
- Custom Access Token Hook injects `role` (and `can_view_contract_price`) into JWT claims at token issuance; role changes take effect on next token refresh (~1h max; deactivation must also be checked server-side per request, which `requireApiAuth()` already does structurally).

## 6. Authentication

### 6.1 Login flow

1. Email + password (`signInWithPassword`) — unchanged.
2. **Email 2FA step:** after password success, the server issues a 6-digit code via Resend and the user must verify before the session is treated as fully authenticated.

**Implementation caveat (flagged for engineering design):** Supabase native MFA factors are TOTP and phone — email is not a built-in second factor. Two viable approaches, decided at implementation time:
- **(a) Supabase email OTP as the challenge:** after password verification, call `signInWithOtp` / `verifyOtp` (email) as the completing step, with Supabase SMTP pointed at Resend. Least custom code; session semantics need careful handling.
- **(b) App-level second factor:** `auth_challenges` table (user_id, code hash, expiry, attempts), code sent via the email abstraction, verified server-side; `requireApiAuth()` treats a session without a completed challenge as unauthenticated. More code, fully controlled UX.

Requirements either way: 10-minute code expiry, ≤5 attempts, resend throttling, and 2FA enforced for **all** roles (superadmin/admin especially).

### 6.2 Sessions & guards

- Cookie sessions via `@supabase/ssr` — unchanged.
- `requireDashboardAuth()` / `requireApiAuth()` remain the chokepoints, extended to: check `profiles.is_active`, read role from the JWT claim (not metadata), and accept the four-tier role list.
- Add `middleware.ts` for a cheap global session check on `/dashboard/**` and `/api/**` (defense-in-depth; per-route guards remain authoritative).
- Dev bypass (`isLocalAuthBypassEnabled`) is kept but must hard-fail when `NODE_ENV === 'production'` (assert + test).

## 7. Authorization Model

### 7.1 Data classes

| Class | Contents | superadmin | admin | staff | sales_rep |
|---|---|---|---|---|---|
| **S — System secrets** | `connection_configs`, user management, data-source toggle, danger zone | ✅ | ❌ (grantable) | ❌ | ❌ |
| **P — Cost & ingestion** | `product_cogs`, `cost_snapshots`, `hercules_*`, `supplier_contracts`, `supplier_contract_cost_lines`, `pricing_ingestion_*`, `pricing_publish_events`, `pricing_rules`, `pricing_guardrail_events` | ✅ | ✅ | ❌ | ❌ |
| **C — Contract pricing** | `customer_contracts`, `contract_price_lines`, calc snapshots (price fields) | ✅ | ✅ | ✅ | ✅ *for now* (flag-gated, revocable — decision 5) |
| **O — Operations** | sync events/schedules/failed, mappings, inventory, connection *status* (redacted), SF cache, quotes/orders, customers | ✅ | ✅ | ✅ | own-scope only (see 7.2) |
| **R — Rep performance** | leaderboard, scorecards, per-rep KPIs, profile-call metrics | ✅ | ✅ | ✅ | ✅ all reps (decision 3) |
| **K — Compensation** *(deferred)* | comp plans/estimates | ✅ | TBD | ❌ | own only; `sales_manager` all |

### 7.2 Sales rep scope within class O

Reps see the **sales experience**, not the ops console: sales dashboard, scorecards for all reps, their **own** quotes/orders/customers in detail (matched via `fishbowl_user_id` → alias → `fb_sales_orders.salesperson`). They do **not** get: full customer/account browser, sync/ops pages, mappings, settings, events, inventory admin.

> **Assumption to confirm in review:** rep can open the *detail* of another rep's order from the leaderboard? Draft says **no** (indicators yes, drill-through no) — consistent with "no unauthorized customer lists."

### 7.3 Route & page gating

- `requireApiAuth({ roles })` applied per the matrix to **every** API route; notable upgrades: `PATCH /api/dashboard/sales/roster` → staff+; `PUT /api/settings/connections` and `POST /api/settings/data-source` → superadmin (class S); their GET counterparts (redacted status) → admin+; `/api/sync/trigger` → admin+; `/api/debug/sf` → superadmin or dev-only.
- Layout-level gating renders role-appropriate navigation (reps never see Settings/Events/Mappings); pages also enforce server-side (nav hiding is UX, not security).
- The settings "Danger Zone" reset is currently a **UI stub (toast only, no API)** — either implement it superadmin-only or remove it. Draft: remove until a real need exists.

### 7.4 Superadmin invariants

Server-side (and DB-trigger, belt-and-suspenders) enforcement:
- The superadmin account's role cannot be changed or deactivated by anyone, including via direct profile updates.
- Only superadmin can assign or demote `admin`.
- Role changes always write an audit row (§9).

## 8. Database / RLS Overhaul

Principles: JWT `role` claim drives policies; service-role server code is unaffected; **direct PostgREST access with the anon key becomes safe by construction**.

1. **Class S:** `REVOKE` all authenticated access to `connection_configs` (today any logged-in user can read raw credentials — the single worst finding). Service-role only.
2. **Class P:** SELECT restricted to `role IN ('superadmin','admin')`.
3. **Class C:** SELECT for staff+; for reps, gated on the `can_view_contract_price` claim (so decision 5's "for now" is a one-line policy/flag flip later, not a migration).
4. **Class O/R:** staff+ full read; rep policies scoped by ownership where row-scoping applies (`fb_sales_orders` etc. via alias join), full read on the aggregated performance views.
5. **Write policies:** remove `FOR ALL TO authenticated` from `field_mappings`, `reorder_rules`, `app_settings` — writes go through the API (service role) only.
6. **`nursing_tam` schema:** RLS is disabled on all 5 tables; safe only while the schema stays out of PostgREST's exposed schemas. Requirement: verify exposure config, enable RLS anyway (service-role only), since `contacts` is PII.
7. All **future** tables must ship with tiered policies — add a checklist item to migration review; the flat `USING (true)` pattern is retired.

## 9. Audit ("who changed")

- New `audit_log` table: `id, actor_user_id, actor_email, action, entity_type, entity_id, summary, diff JSONB, created_at`. Insert via service role from the API layer (single `logAudit()` helper next to `requireApiAuth`).
- Logged actions: user invited/activated/deactivated, role changed, credential config saved, data-source toggled, sync manually triggered (already partially captured in `sync_events.payload.requestedBy` — migrate to audit_log), roster changed, pricing rules/flags changed, contract-price visibility flag flipped.
- `created_by`/`updated_by` columns added to `field_mappings`, `reorder_rules`, `connection_configs`, `app_settings`, `fishbowl_salesperson_aliases`, `profiles`.
- Retention: indefinite for now (low volume); revisit at 12 months.

## 10. Email Infrastructure (Resend)

- Add the `resend` package; new abstraction at `src/lib/email/` — `sendEmail(template, to, data)` with typed templates. Fold the existing `src/lib/utils/notifications.ts` webhook/Resend fallback logic into it; **remove hardcoded recipient addresses** (move to `app_settings` or env).
- **Auth emails** (2FA codes, invites, password reset): Supabase Auth SMTP configured to Resend, sending from Steven's domain (decision 7). Custom email templates in the Supabase dashboard to match brand.
- **App emails** (admin notifications, future low-stock alerts P6, automation emails): direct Resend API through the abstraction.
- Env vars documented in `.env.example`: `RESEND_API_KEY`, `EMAIL_FROM`, `ALERT_WEBHOOK_URL` (optional).
- Use cases shipped in this PRD: invite, 2FA code, password reset, "your role changed" notice, admin notification on failed-sync threshold (nice-to-have).

## 11. User Lifecycle

1. **Invite:** superadmin (or admin, for staff/rep roles only) enters email + role (+ Fishbowl user ID for reps) in a new `/dashboard/settings/users` page → server creates the auth user via admin API (`inviteUserByEmail`) → Resend delivers → user sets password on acceptance → profile row activates.
2. **Deactivate:** flips `profiles.is_active`; guards reject on next request; Supabase sessions revoked via admin API.
3. **Role change:** superadmin for admin grants/demotions; admin may manage staff/rep. All audited.
4. **Reactivation** re-enables without data loss.
5. No self-service signup — `/login` only; Supabase signups disabled.

## 12. Rollout Plan

**Phase 0 — Prerequisites & hardening (before any feature work)** — *executed 2026-07-02*
- ✅ Reconciled the missing live-DB migrations into the repo, recovered verbatim from `supabase_migrations.schema_migrations`: files `017`, `018`, `019`, `019a`–`019d` (nursing_tam), `020`, `021`. `023_zeus_packaging_estimator` intentionally left to Fable's worktree (it merges from there).
- ✅ Dropped `user_metadata` as a role source (`src/lib/auth.ts`).
- ✅ Revoked all client access to `connection_configs` (migration `024_revoke_connection_configs_client_access`, applied to live and verified: zero policies, zero anon/authenticated grants).
- ✅ Gated `PATCH /api/dashboard/sales/roster` to admin (staff+ once the four-tier model lands in Phase 1).
- ✅ Salesforce webhook secured: `SALESFORCE_WEBHOOK_SECRET` set in Railway (Steven, verified live) and the route fails closed (503) when unconfigured.

**Phase 1 — Identity foundation** — *executed 2026-07-02*
- ✅ Migration `025_user_profiles_and_roles` (applied live): `app_role` enum, `profiles` table (RLS: own-row read + admin read-all, writes service-role only), `handle_new_user` trigger, DB-level superadmin invariants (sole superadmin cannot be demoted/deactivated/deleted, even via service role), backfill (Steven → superadmin, Dan → admin, mirrored to `app_metadata` with a legacy `roles` array kept until this branch deploys — drop in Phase 2).
- ✅ **Implementation note (deviation from §5):** no custom access token hook needed — Supabase already embeds `app_metadata` in the JWT, so RLS policies read `auth.jwt() -> 'app_metadata' ->> 'role'`. `profiles` remains the management source of truth; role changes must write both (enforced by the Phase 3 user-management API).
- ✅ `src/lib/auth.ts` rewritten: five-role `AppRole`, `SUPERADMIN/ADMIN/STAFF_API_AUTH_OPTIONS` tiers, `getAuthContext` reads `profiles` (falls back to `app_metadata`), inactive users rejected, dev bypass → superadmin. Legacy `operator`/`user` roles retired.
- ✅ Route gating per §7 matrix: connections PUT + data-source POST → superadmin; settings GETs → admin+; sync trigger/full-sync → admin+; ops APIs (events, failed, mappings, integrations, sync status, SF sync state) → staff+; roster PATCH → staff+.
- ✅ Page gating via server layouts: `/dashboard/settings` → admin+; `/dashboard/{mappings,events,failed,integrations}` → staff+. Sidebar nav filters by role (Operations staff+, Field Mappings staff+, Settings admin+).

**Phase 2 — RLS overhaul** — *executed 2026-07-02*
- ✅ Migration `026_rls_role_tiers` (applied live): dropped all 50+ flat `USING (true)` policies and the open write policies (`field_mappings`, `reorder_rules`, `app_settings`); created role-tier helpers (`jwt_app_role()`, `is_admin_up()`, `is_staff_up()`, `can_view_contract_pricing()`) and tiered SELECT policies — class P (cost/supplier/ingestion, 18 tables) → admin+; class C (contract sell pricing) → staff+ or flag-gated reps; class O (ops/cache, 29 tables) → staff+. Zero client write policies remain anywhere.
- ✅ Behavioral verification via JWT-claim simulation: staff sees ops but 0 cost rows; sales_rep sees 0 everywhere (Phase 4 adds ownership scoping); admin sees all; anon and `connection_configs` throw permission-denied. Reusable script: `scripts/rls-verify.sql`.
- ✅ Migration-review guardrail added to CLAUDE.md (no flat policies on new tables).
- ⏸ Migration `027_drop_legacy_role_arrays` committed but **not applied** — run it after this branch deploys (the currently-live build still authorizes the superadmin via the legacy `roles` array).

**Phase 3 — Lifecycle & email** — *executed 2026-07-02*
- ✅ Migration `028_audit_log_and_auth_challenges` (applied live): `audit_log` (admin-read RLS, service-role writes) and `auth_challenges` (no client policies).
- ✅ Email abstraction `src/lib/email/` (`resend` pkg): typed `sendEmail` client + brand templates (invite / 2FA code / role-changed) + `sendInviteEmail`/`sendTwoFactorCodeEmail`/`sendRoleChangedEmail`. Sends from `EMAIL_FROM` (Steven's domain). Legacy `src/lib/utils/notifications.ts` refolded onto it and hardcoded recipient addresses removed (now `ALERT_EMAIL_RECIPIENTS`).
- ✅ Audit helper `src/lib/audit.ts` (`logAudit`), wired into every user lifecycle action.
- ✅ User lifecycle `src/lib/users.ts` + APIs: `GET/POST /api/users`, `PATCH /api/users/[id]` (admin+; only superadmin may grant/revoke `admin`; superadmin row immutable). Invite via `inviteUserByEmail`, role change (writes profiles + app_metadata + emails the user), deactivate (flips flag + global session revoke). Admin UI at `/dashboard/settings/users` with invite dialog and inline role/status controls, linked from Settings.
- ✅ Email 2FA (app-level, PRD §6.1 approach b): `src/lib/twofactor.ts` (hashed 6-digit codes, 10-min expiry, ≤5 attempts, HMAC-signed 12h verified cookie), `POST/PUT /api/auth/2fa`, two-step login page, enforced in `getAuthContext`/guards via `pendingTwoFactor`. **Gated behind `TWO_FACTOR_ENABLED` (default off)** so the branch deploys safely before Resend env is live; flip on after configuring `EMAIL_FROM`/`RESEND_API_KEY`.
- ⚠️ Note: 2FA re-uses the existing Supabase session (created at password success) + a verified cookie, rather than withholding the session until the code clears. This is the standard app-level pattern and is enforced server-side on every request; if a stricter "no session until 2FA" model is wanted, that's a Supabase-native MFA (TOTP) follow-up.

**Phase 4 — Rep experience** — *executed 2026-07-02*
- ✅ Migration `029_rep_identity_and_row_scoping` (applied live): `fishbowl_salesperson_aliases.fishbowl_user_id` (canonical identity, decision 2; `sf_user_id` remains the transitional fallback), `current_rep_aliases()` helper, and rep row-scoping RLS on `fb_sales_orders`/`fb_sales_order_items` (inherited by the canonical views). Verified live: unlinked rep sees 0 rows; a linked profile simulated as a rep saw exactly its own 2,638 of 65k orders; `sales_manager` sees all orders but still no class P.
- ✅ API scoping: `/api/dashboard/orders` + `/quotes` (list and detail) force `salespersonIn = getRepAliases(user)` for `sales_rep` — detail routes return 404 (not 403) for other reps' records, per the §7.2 no-drill-through decision. `src/lib/reps.ts` resolves profile → aliases.
- ✅ Staff-gated the ops/CEO surfaces reps shouldn't reach: overview, inventory (page + both APIs), territory, pricing readiness — pages via layouts, APIs via `STAFF_API_AUTH_OPTIONS`. Sales roles landing on `/dashboard` are redirected to `/dashboard/sales` (overview page now a server gate wrapping the client component).
- ✅ Nav: reps see Sales, Quotes, Orders only; scorecards for all reps remain visible on the sales dashboard (decision 3).
- ✅ Contract-price flag: already enforced at RLS (Phase 2); no rep-facing UI surfaces contract pricing yet, so no additional wiring needed.
- Note: Dan's profile now carries his SF user id (`sf_user_id` linkage backfilled during verification). Rep profiles get linked at invite time via the users admin page.

**Post-merge security review (2026-07-03):** the incentive engine + revenue cohort work merged from master was audited against this PRD. It adopted the role model for writes (admin-gated) but shipped read gaps, all fixed same-day: `order_revenue_cohort` flat read policy re-tiered to `is_staff_up()` (migration `030`, applied live — it postdated the Phase 2 sweep, which had already stripped the other flat comp-table policies); incentive read APIs (`/api/dashboard/incentives`, `/scorecard`, and GETs on aliases/merge-map/settings) gated staff+; contract-migration read APIs (batches/rows/exceptions/publish-preview) gated admin+ to match their writes (class P); `/dashboard/incentives` layout staff+, `/admin` admin+. Two more applied-but-uncommitted migrations reconciled (`027a`, `028a`). Outstanding for the team: duplicate migration numbers 023–028 (two files each), comp-data artifacts committed to git (`duplicate-customer-groups.xlsx`, RingDNA discovery outputs, `__pycache__`), and the rep-facing scorecard will need own-comp scoping (decision 4) when it ships to reps.

**Phase 5 — Compensation (deferred):** integrate Fable's comp model; activate `sales_manager`; comp RLS (own-only / manager-all).

## 13. Testing Requirements

- Unit: role extraction (claims only), guard matrix (401/403 per role per route), superadmin invariants, dev-bypass production assertion.
- RLS: SQL-level tests (pgTAP or supabase test helpers) proving e.g. a `sales_rep` JWT cannot select `product_cogs`, `connection_configs`, `pricing_ingestion_rows`; a `staff` JWT cannot select class P; anon can select nothing.
- Integration: invite → accept → 2FA → scoped dashboard happy path (Playwright — already installed, unused).
- Email: template render + send mocked; throttle/expiry on 2FA codes.
- Regression gate: CI check that any new table in a migration includes non-flat policies.

## 14. Open Items

| # | Item | Owner | Blocking? |
|---|---|---|---|
| 1 | Compensation data model & estimator (WIP, Fable's worktree) — only Phase 5 depends on it | Fable/Steven | No |
| 2 | ~~Salesforce webhook fail-open~~ **Resolved 2026-07-02:** `SALESFORCE_WEBHOOK_SECRET` set in Railway (verified 401 on unsigned requests) and the route now fails closed (503) when the secret is unset, matching the EasyPost webhook | — | Done |
| 3 | Rep drill-through into other reps' order/customer detail (draft: no) — §7.2 assumption | Steven | Phase 4 only |
| 4 | Dan is mapped to `admin` (decision 1 makes Steven the sole superadmin). Confirm this matches Dan's expectations before rollout | Steven | No |
| 5 | ~~`nursing_tam` PostgREST exposure check~~ **Resolved 2026-07-02:** anon/authenticated hold zero grants on the schema — unreachable via PostgREST despite RLS being off | — | Done |
| 6 | 2FA approach (a) Supabase OTP vs (b) app-level challenge — engineering design decision | Eng | Phase 3 |

## 15. Success Criteria

- A `sales_rep` user, using their own JWT against PostgREST directly, cannot read any class S/P table (verified by automated test).
- Steven can invite, role-assign, and deactivate a user end-to-end without the Supabase dashboard.
- All logins complete email 2FA; auth emails arrive via Resend from the configured domain.
- Every role/credential/config change appears in `audit_log` with the actor.
- Zero regressions in existing admin workflows (Dan's and Steven's current usage) during rollout.
