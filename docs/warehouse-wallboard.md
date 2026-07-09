# Warehouse shipping wallboard

Read-only TV board at **/warehouse-board** for a 16:9 HD screen on the
warehouse floor. Public route, gated by a shared display password —
**set `WAREHOUSE_BOARD_PASSWORD`** in the environment (Railway + `.env.local`).
Entering it once stores a hashed 90-day cookie on the device; rotating the
password invalidates every screen.

## What it shows (all derived from synced Fishbowl data)

Lanes map to Fishbowl sales-order statuses:

| Lane | Source | Notes |
| --- | --- | --- |
| **Ready to pick** | `Issued` | Committed, picking not started. Oldest first. |
| **Picking** | `In Progress` | Line-level progress bar from `quantity_fulfilled / quantity`; partial-line badge. |
| **Shipped · 7 days** | `Fulfilled`, `date_completed` in last 7d | Today's ships highlighted. |
| **Closed short** | `Closed Short`, last 30d | Shipped incomplete — review. |

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

Open-PO data lives in `fb_open_po_lines` (migration 040), refreshed straight
from Fishbowl's data-query API (`po`/`poitem`, statuses Issued/Partial) by
`src/lib/warehouse-board/po-sync.ts`. The refresh runs *after* each page
render via `next/server`'s `after()` when the cache is >15 min old, so the
board never blocks on Fishbowl and tolerates it being down (stale cache).

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
