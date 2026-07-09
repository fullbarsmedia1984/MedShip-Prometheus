# Hercules → Zeus Supplier Catalog Ingestion (P10)

**Status: shipped to production, 2026-07-05 → 2026-07-08.**
Full Medline/supplier part catalog (748,101 parts) ingested from Hercules into
Prometheus/Zeus staging tables, with a rep-facing Supplier Catalog browser,
hybrid lexical/semantic search, and a nightly delta sync.

Hercules data is **supplier/manufacturer catalog data, not canonical Zeus
product data**. It stays in `hercules_*` staging tables until the
mapping/approval workflow (`zeus_product_supplier_mappings`) promotes links —
that matching phase is the next body of work, not part of this delivery.

---

## 1. What was delivered

### Ingestion pipeline (P10 automation)
- **Resumable, checkpointed ingestion engine**
  ([catalog-ingestion.ts](../src/lib/hercules/catalog-ingestion.ts)): reads
  `POST /api/v1/parts/list` page by page (500/page), upserts through the
  shared importer, and checkpoints the offset cursor in
  `hercules_ingestion_runs` after every page. Crashes, deploys, retries, and
  rate-limit pauses resume mid-catalog; upserts are idempotent by source key.
- **Inngest wiring**: `hercules-catalog-ingest` (event
  `hercules/catalog.ingest`) runs 4 steps × 1 page per execution and chains
  continuation events for the long tail; `hercules-catalog-delta-cron`
  (nightly 06:00 UTC) is gated by the `P10_HERCULES_CATALOG_INGEST` row in
  `sync_schedules` (**enabled** 2026-07-08). Delta runs filter
  `updatedAt >= watermark` (`hercules_sync_state`).
- **Self-healing**: in-process retries for network-level fetch failures;
  `onFailure` re-sends the ingest event (capped at 5 failures/hour against
  crash loops). Failed runs stay resumable — a new ingest event continues
  from the checkpoint.
- **Auditability**: every run logs to `sync_events` (automation
  `P10_HERCULES_CATALOG_INGEST`); rejected records keep their **full raw
  payload** in `hercules_ingestion_rejects`.
- **Control**: `GET/POST /api/hercules/ingest` (status staff+, start/cancel
  admin); P10 also lives in `/api/sync/trigger`.

### Supplier Catalog browser (`/dashboard/catalog`)
- Visible to **every signed-in role** (owner decision) — sales reps included.
  Supplier cost is visible to **all roles** (owner decision 2026-07-08); the
  gating plumbing remains (`PRICE_ROLES` in the catalog API routes) for
  one-line tightening. Direct-DB RLS stays admin-only (Class P).
- Rich result rows: thumbnail, product name, description, manufacturer /
  category, MPN copy-chips, vendor chips (Medline/McKesson/NDC), offer
  counts, price ranges, status.
- Item detail: attributes, image, vendor offers with full UOM grid
  (part numbers, pack, catalog + contract price, GTIN, HCPCS, weight,
  dimensions), collapsible raw-payload viewer.
- UX: `/` focuses search, active-filter chips, facet dropdowns
  (manufacturer/category/vendor with counts), skeleton loading, sort
  (best match / newest / price asc/desc), identical variant titles
  disambiguated with their MPN.
- Ops card on `/dashboard/integrations`: live run progress bar,
  insert/update/reject counters, delta watermark.

### Search (`hercules_catalog_search` RPC, migrations 036–038)
- **Tier 0**: manufacturer / vendor part-number prefix matches always rank
  first (reps search by SKU).
- **Tier 1**: reciprocal-rank fusion of weighted full-text rank
  (name > description > manufacturer/category) and semantic ANN rank.
- **Typo tolerance**: trigram word-similarity fallback fires when exact
  branches return < 5 results ("nitryl gloove" → nitrile gloves).
- **Synonyms**: bidirectional query expansion
  ([search-expansion.ts](../src/lib/hercules/search-expansion.ts)) bridges
  full words ↔ supplier abbreviations (nitrile↔NITRL, exam↔EXM, …); applied
  to the full-text branch only, never to part-number matching; operator
  queries (quotes/minus) pass through untouched.
- **No exact counts**: pagination is `hasMore`-based (planner estimate for
  the unfiltered view). Capped exact counts cost 10s+ on a churning 750k-row
  table and were the original page-blanking bug.
- **Telemetry**: every real search logs to `hercules_search_log`
  (query, filters, sort, result count, latency, role) with a partial index
  on zero-result rows — that feed grows the synonym dictionary.
- **Semantic layer**: OpenAI `text-embedding-3-small` @ 512 native dims
  stored as pgvector `halfvec(512)` on `hercules_catalog_items`
  (**all 748,106 items embedded**, ~$0.40 total). Query-time embedding is
  gated by app_settings key `hercules_semantic_search` = `'on'` (60s cache,
  no redeploy) and degrades to lexical-only on any OpenAI failure.
  **LIVE 2026-07-09**: IVFFlat ANN index built (lists=1000, probes=10,
  839 MB), flag on — hybrid lexical + semantic search is in production
  (see §5.1 for the build saga).

### Performance work (measured against production, cold, under churn)
- Part-number search ~100–500 ms; phrase/full-text 0.2–2 s; fuzzy ~1–3 s.
- ORed predicates across indexes → sequential scan (~80 s); the RPC uses a
  UNION-per-index plan instead.
- Offset pagination on Mongo-backed sorts is **unstable within timestamp
  ties** (caused ~33% duplicates + silent skips); all paging sorts by `_id`.
- Batched item writes with bounded concurrency (default 8) after vendor
  offers made pages ~10× write-heavier.

---

## 2. Hercules API facts (hard-won)

| Fact | Detail |
|---|---|
| **Real API base URL** | `https://hercules-sv-dev.medicalshipment.com` — the PDF and Salman's email cite `hercules-dev.medicalshipment.com`, which serves only the frontend UI and 404s `/api/v1/*`. Docs live at `docs.hercules.medicalshipment.com` (HTTP Basic auth). |
| Auth | `Authorization: Bearer <token>` + `X-App-Id`. |
| **Token lifetime ~24 h** | Not the documented month. Expired twice mid-import. **Rotation can mint a NEW App ID** — update both `HERCULES_API_APP_ID` and `HERCULES_API_ACCESS_TOKEN`, in both `.env.local` and Railway. Ask Salman to extend the lifetime or the nightly delta breaks daily. |
| Egress payload shape | Differs from the ingress spec: manufacturer/vendor are **populated `{_id, name}` references** (`manufacturerId`, `vendorId`), NOT flat names; images = `imageURLs`; `status` is a string; units carry **`cost`** (stored as `list_price_amount`) with `contractPrice` usually null and no `price` key. `description` = long marketing copy; the short product name is in `brand`/`title`. |
| Cost semantics | Open question for Salman: is egress `cost` list or contract? We store it as catalog/list price; `contractPrice` stays authoritative for cost eligibility. Validate against his sample responses (FHEI18770 etc.) when sent. |
| Rate limits | Currently 50,000/hr (headers tracked; engine pauses at low remaining). |
| Run duration ceiling | Something in the Inngest/Railway chain kills function runs at **~22.5 minutes** — keep per-run budgets under ~15 min and chain continuation events. |
| Envelope quirk | List endpoints return `statusCode: 201` on success. |

---

## 3. Data model (migrations 024, 035–038 — all applied to live)

- `hercules_catalog_items` — one row per part; raw payload preserved; plus
  `embedding halfvec(512)` + `embedded_at` (037).
- `hercules_suppliers`, `hercules_vendor_offers`, `hercules_offer_uoms` —
  vendor offers and UOM-level detail (prices, GTIN, HCPCS, dims).
  Supplier-identity collisions across payload variants (same
  `supplier_code`, different ids) resolve by **reusing the row that owns the
  colliding identity**; real unification belongs to the mapping phase.
- `hercules_ingestion_runs` / `hercules_ingestion_rejects` /
  `hercules_sync_state` (024) — checkpoint, preserved-payload rejects, delta
  watermark. Class P RLS (admin-only direct read; the app reads via
  service-role behind role-checked routes).
- `hercules_search_log` (038) — search telemetry.
- RPCs (service-role only): `hercules_catalog_search`,
  `hercules_catalog_row`, `hercules_catalog_facets`.
- Indexes: weighted-FTS GIN, trigram GIN (description/brand/MPN/mfr/VPN),
  facet btrees, `(vendor_name, item)` on offers, partial index on
  un-embedded rows.
- Migrations were applied to live via direct Postgres (`DG_URL` in
  `.env.local`; the Supabase MCP is unauthorized) and recorded in
  `supabase_migrations.schema_migrations` with timestamp versions.
  **Repo/live drift is real — check live before schema work.**

## 4. Operational runbook

- **Resume a paused/failed import**: verify the token
  (`POST …/api/v1/parts/list` with headers), then send
  `{"name":"hercules/catalog.ingest","data":{"runType":"full"}}` to
  `https://inn.gs/e/$INNGEST_EVENT_KEY` (key in `.env.local`). The active
  run resumes from its checkpoint. Never run the local driver
  (`scripts/hercules-catalog-ingest-local.mjs`) and the cloud pipeline
  simultaneously.
- **Token rotation**: rotate in Hercules → copy token AND App ID → update
  both env vars in `.env.local` + Railway.
- **Re-derive after a normalizer fix**:
  `scripts/hercules-reprocess-raw.mjs [--start-cursor <uuid>]` rebuilds
  normalized rows from stored raw payloads, no API calls (~7 h full sweep,
  idempotent, safe alongside the API import).
- **Embedding top-up** (after deltas): `scripts/hercules-embed-catalog.mjs`
  (sweeps `embedding IS NULL`; needs `OPENAI_API_KEY` + `DG_URL`).
- **Monitoring**: `GET /api/hercules/ingest`, the Integrations ops card,
  `sync_events`, Inngest dashboard (P10 functions), and
  `hercules_search_log` for search health / zero-result queries.
- **Postgres traps**: the pooler ignores client-config `statement_timeout`
  (always `SET statement_timeout = 0` explicitly for long DDL); a failed
  `CREATE INDEX CONCURRENTLY` leaves an INVALID index that
  `IF NOT EXISTS` silently skips (check `pg_index.indisvalid`, drop, retry);
  `app_settings.value` is JSONB (`to_jsonb('on'::text)` in raw SQL).

## 5. Outstanding items

1. ~~**ANN index for semantic search**~~ — **DONE 2026-07-09.** HNSW hit the
   `maintenance_work_mem` cliff at 82%; two orphaned HNSW build backends
   (18 h of IO thrash) were blocking the IVFFlat retry via lock contention.
   Recovery executed: terminated both backends, dropped the invalid 757 MB
   remnant, rebuilt as **IVFFlat `lists = 1000`** (30 min, 839 MB,
   `indisvalid = true`), `ivfflat.probes = 10` at database level, `ANALYZE`
   to fix stale planner stats (a 61 s query dropped to 250 ms), flag
   `hercules_semantic_search = 'on'`. Verified: natural-language queries
   ("protective covering for mattress leaks" → waterproof mattress
   protectors) return relevant results in 80–350 ms. Upgrade to HNSW later
   only on a bigger compute tier.
2. **Scoped facet counts** — shelved (8–17 s cold under churn; `p_facets`
   reserved in the RPC). `ANALYZE` has run post-settle; re-benchmark, plus
   `VACUUM` for bloat.
3. **Salman follow-ups**: extend token lifetime; confirm egress `cost`
   semantics; his docs/email cite the wrong base URL; sample responses
   (FHEI18770, numeric-contract-price, list-only) still pending — validate
   staged rows against them.
4. **Post-settle housekeeping**: `VACUUM ANALYZE` the hercules tables
   (heavy churn bloat); re-benchmark scoped facets and exact counts.
5. **Next phase — Zeus product matching**: proposal job matching staged
   items to Zeus products by `msId` / MPN+manufacturer / GTIN / VPN with an
   approval-queue UI over `zeus_product_supplier_mappings`; then supplier
   identity unification.
6. Grow the synonym dictionary from `hercules_search_log` zero-result rows.

## 6. Final numbers

| Metric | Value |
|---|---|
| Parts ingested | **748,101 / 748,101** |
| Items with manufacturer names / vendor offers | ~99.8% each |
| Vendor offers / UOM rows | ~374k / ~624k |
| Rejects | 18 raw payloads — **all healed**, zero remaining |
| Embeddings | 748,106 / 748,106 (100%) |
| Suppliers | Medline (dominant), McKesson, NDC (+2 fixture rows) |
| Delta watermark | `2026-05-19T12:11:22Z`; nightly delta **enabled** |
