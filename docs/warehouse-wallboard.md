# Warehouse shipping wallboard

Read-only TV board at **/warehouse-board** for a 16:9 HD screen on the
warehouse floor. Public route, gated by a shared display password —
**set `WAREHOUSE_BOARD_PASSWORD`** in the environment (Railway + `.env.local`).
Entering it once stores a hashed 90-day cookie on the device; rotating the
password invalidates every screen.

## What it shows (all derived from synced Fishbowl data)

**Kit Galaxy** (header toggle): a three.js orbital graph of `-KIT` orders —
suns are schools (customers), planets are kit orders, moons are component
lines (Sale/Kit types, capped at 20 rendered moons per kit). Moons render as
solid shaded spheres and receive distance-aware scale compensation so they
remain legible when zoomed out. A small starship orbits any kit whose Fishbowl
sales order has a customer PO on file; only the presence of the PO is sent to
the client, not its number. Colors: blue
waiting, amber assembling, green shipped (30-day window, shipment records
included), red pulsing overdue; moons green/amber/slate by pick progress.
Drag orbits, wheel zooms, right-drag pans (pan only — screen-space), click
a school/kit for a translucent detail panel (Esc or empty-space click
closes), hover shows quick tooltips; hovering or an open panel suspends
orbital motion until released. Moon→planet link lines carry flowing soft
particles (components streaming into the kit). Bloom is subtle at rest and
intensifies on the hovered/selected body (color over-drive past the bloom
threshold); labels are dimmed below the threshold so text never glows and
auto-shrink to fit long school names. Kit orders issued within the last
24 hours blaze with a boosted glow and a vertical light beam until someone
clicks the planet (acknowledgement persists per display via localStorage).
The SO search box focuses + highlights matching planets. Data:
`getKitGalaxyData()` in `src/lib/warehouse-board/galaxy-data.ts`,
refreshed with the same 60s cycle.

**Drop-ship exclusion**: SOs whose only product lines are `Drop Ship` never
enter the warehouse and are excluded from every lane, KPI, alert, and the
rails. Mixed orders stay, and their line/unit counts and pick-progress bars
count only warehouse-fulfillable lines (Sale/Kit).

Lanes map to Fishbowl sales-order statuses:

| Lane | Source | Notes |
| --- | --- | --- |
| **Ready to pick** | `Issued` | Committed, picking not started. Oldest first. |
| **Picking** | `In Progress` | Line-level progress bar from `quantity_fulfilled / quantity`; partial-line badge. |
| **Shipped · 7 days** | Shipment records (`ship`, statusId 30) in last 7d ∪ `Fulfilled` in window | Shipments are ground truth for "out the door" — an SO with a shipment counts even while still In Progress (shows a `PART` badge and stays in Picking too). Cache: `fb_recent_shipments` (migration 042), P12 Inngest cron every 15 min + `POST /api/sync/shipments`. |

**Closed short** (last 30d, slower-moving review data) lives in the right
rail under "Longest waiting", off the main board. The header shows per-source
sync ages — **SO / PO / INV** pills (green pulse = fresh; amber when SO >2h
or PO/INV >26h) — plus an **SO search** box: typing dims non-matches,
outlines hits in white, auto-expands the lane holding the first hit and
scrolls to it. One-page, no popups; clearing restores the ambient board.

Alerting (age is measured from `date_issued`; `date_scheduled` is ~100%
past-due in the data so it can't discriminate):

- Age chips: **amber ≥3d / red >7d** for Ready; **amber ≥7d / red >14d** for
  Picking (red chips pulse).
- **Alert ticker**: stalled picks (>14d In Progress, partial lines called
  out), oldest unpicked orders, recent closed-shorts. Green "all clear"
  otherwise.
- **Longest waiting** rail: the 6 oldest open SOs with big day counters —
  catches inventory sitting in the warehouse tied to SOs (incl. the >90d
  backlog, which is kept out of the lanes and counted in the KPI strip).
- KPI strip: Ready / Picking / Late >7d / Stuck picks / Backlog >90d /
  Shipped 7d.
- Header shows a **LIVE** dot with Fishbowl sync age (turns amber when the
  sync is >2h stale) and a clock.

## Stock posture (Ready-to-pick lane)

Each Issued order's unfulfilled **Sale** lines (drop-ship/shipping/kit lines
excluded) are checked against cached Fishbowl inventory
(`inventory_snapshot.qty_on_hand`, summed across locations) and open
purchase orders:

| Badge | Meaning |
| --- | --- |
| `STOCK ✓` (green) | Every line is on hand — pick it now |
| `ON ORDER · <date>` (amber) | Short lines are all covered by open POs; date = earliest expected receipt |
| `PARTIAL · ON ORDER` (amber) | Some lines on hand, the rest on order |
| `N SHORT · NO PO` (red, pulsing) | Short lines with **no open PO** — purchasing needs to act. Also feeds the ticker and the "No PO short" KPI. |

PO data is owned by the **P11 purchase-orders sync** (Inngest cron,
`TZ=America/Chicago 0 8,10,12,14,16 * * 1-5`), which maintains:

- `fb_purchase_orders` / `fb_purchase_order_items` (migration 041) — durable
  full PO cache (headers + lines + raw JSON), incremental by
  `po.dateLastModified` with a 1-hour overlap; foundation for future Zeus
  purchasing features. Class P (supplier costs) — admin-read RLS.
- `fb_open_po_lines` (migration 040) — the wallboard's fast open-lines cache.

Manual trigger: `POST /api/sync/purchase-orders` (admin) fires the Inngest
event; `{"inline": true}` runs it in-request (initial backfill). `GET` on the
same route reports counts + last sync. Inventory (P2) runs
`TZ=America/Chicago 0 8,12,16 * * 1-5`. The board renders purely from the
caches and never blocks on Fishbowl.

## Behavior

- Auto-refreshes every 60 seconds (server re-render; no interaction needed).
- Lanes cap at 7 cards (oldest/most critical first). Clicking a lane title or
  "+N more — view all" expands the lane **in place**: every order in that
  status becomes mouse-wheel scrollable, sortable by **age** or **progress**
  (click again to flip direction), "show less" collapses.
- **Change glow**: when a refresh shows an order changed since the previous
  sync (lane move, pick progress, stock posture, newly appeared), its card
  pulses a colored glow outline until someone clicks it or the next sync
  recomputes the set.
- **Ticker**: hover pauses it; click-drag scrubs backward/forward; releases
  resume the auto-scroll.
- Data access is server-side via the service-role client; the only public
  API is the gate `POST`. No order data is reachable without the cookie.
- Line-item, inventory, and PO reads paginate past PostgREST's 1,000-row cap
  (`pageAll` in `data.ts`) — the open book is ~3.8k line rows.

Code: `src/lib/warehouse-board/`, `src/app/warehouse-board/`,
`src/components/warehouse-board/`.
