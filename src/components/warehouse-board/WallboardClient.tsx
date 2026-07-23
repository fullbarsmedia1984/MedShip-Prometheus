'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import type {
  WallboardData,
  WallboardOrder,
  LaneSeverity,
  SyncAges,
} from '@/lib/warehouse-board/data'
import type { KitGalaxyData } from '@/lib/warehouse-board/galaxy-data'
import type { ReceivingData } from '@/lib/warehouse-board/receiving-data'
import type { ReceivingOrder } from '@/lib/warehouse-board/receiving-rules'
import { KitGalaxy } from './KitGalaxy'

const ease = [0.22, 1, 0.36, 1] as const

type LaneVariant =
  | 'ready'
  | 'pickingSales'
  | 'pickingKits'
  | 'shipped'
  | 'short'
type BoardLane = Exclude<LaneVariant, 'short'>

const LANE_ACCENTS: Record<LaneVariant, string> = {
  ready: '#1E98D5',
  pickingSales: '#E89C0C',
  pickingKits: '#B779FF',
  shipped: '#0FA62C',
  short: '#D93025',
}

// Ambient (collapsed) card caps per lane — sized to fit 1080p with no scroll.
const LANE_CAPS: Record<BoardLane, number> = {
  ready: 7,
  pickingSales: 7,
  pickingKits: 7,
  shipped: 7,
}

function isPickingLane(variant: LaneVariant): boolean {
  return variant === 'pickingSales' || variant === 'pickingKits'
}

const SEVERITY_STYLES: Record<LaneSeverity, string> = {
  ok: 'bg-white/10 text-slate-300',
  warn: 'bg-[#E89C0C]/20 text-[#F5B94E]',
  critical: 'bg-[#D93025]/25 text-[#FF7B6E] animate-pulse',
}

/** Quantities come from numeric sums — clamp float noise (33.333333333). */
function fmtQty(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

function AgeChip({ order }: { order: WallboardOrder }) {
  // Kit orders with entered need-by dates show the real deadline instead
  // of age (severity already reflects it).
  let text = `${order.ageDays}d`
  if (order.kitShipBy) {
    const today = new Date().toISOString().slice(0, 10)
    text =
      order.kitShipBy < today
        ? 'LATE'
        : 'SHIP ' +
          new Date(order.kitShipBy + 'T12:00:00').toLocaleDateString('en-US', {
            month: 'numeric',
            day: 'numeric',
          })
  }
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${SEVERITY_STYLES[order.severity]}`}
      title={order.kitShipBy ? `kit ship-by ${order.kitShipBy} · age ${order.ageDays}d` : undefined}
    >
      {text}
    </span>
  )
}

function StockBadge({ order }: { order: WallboardOrder }) {
  const s = order.stock
  if (!s || s.state === 'na') return null
  if (s.state === 'ready') {
    return (
      <span className="rounded-sm bg-[#0FA62C]/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#3ECC5F]">
        stock ✓
      </span>
    )
  }
  if (s.state === 'not_ordered') {
    return (
      <span className="animate-pulse rounded-sm bg-[#D93025]/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#FF7B6E]">
        {s.shortLines - s.onOrderLines} short · no po
      </span>
    )
  }
  const eta = s.eta
    ? new Date(s.eta + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null
  return (
    <span className="rounded-sm bg-[#E89C0C]/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#F5B94E]">
      {s.state === 'partial' ? 'partial · ' : ''}on order{eta ? ` · ${eta}` : ''}
    </span>
  )
}

function OrderCard({
  order,
  index,
  variant,
  animate = true,
  glowing = false,
  searchState = 'none',
  onAcknowledge,
}: {
  order: WallboardOrder
  index: number
  variant: LaneVariant
  animate?: boolean
  glowing?: boolean
  /** none = no active search; hit = matches; miss = dimmed */
  searchState?: 'none' | 'hit' | 'miss'
  onAcknowledge?: (soNumber: string) => void
}) {
  const accent = LANE_ACCENTS[variant]
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: searchState === 'miss' ? 0.25 : 1, y: 0 }}
      transition={{ delay: animate ? 0.1 + index * 0.04 : 0, duration: 0.35, ease }}
      onClick={() => onAcknowledge?.(order.soNumber)}
      className={`shrink-0 rounded-lg border bg-[#162035] px-3 py-2 ${
        glowing ? 'wb-glow cursor-pointer' : ''
      } ${
        searchState === 'hit'
          ? 'border-white ring-2 ring-white/80 shadow-[0_0_18px_2px_rgba(255,255,255,0.35)]'
          : 'border-white/10'
      }`}
      style={
        {
          borderLeftColor: searchState === 'hit' ? '#FFFFFF' : accent,
          borderLeftWidth: 3,
          '--wb-glow-color': accent,
        } as React.CSSProperties
      }
      data-so={order.soNumber}
      data-glowing={glowing || undefined}
      data-search-hit={searchState === 'hit' || undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[15px] font-bold tracking-tight text-white">
          {order.soNumber}
        </span>
        {variant === 'shipped' ? (
          <span className="flex items-center gap-1.5">
            {order.partialShipment && (
              <span className="rounded bg-[#E89C0C]/20 px-1 py-0.5 font-mono text-[9px] font-bold uppercase text-[#F5B94E]">
                part
              </span>
            )}
            <span className="font-mono text-[11px] font-bold text-[#3ECC5F]">
              {order.completedToday ? '✓ TODAY' : '✓ SHIPPED'}
            </span>
          </span>
        ) : variant === 'short' ? (
          <span className="font-mono text-[11px] font-bold text-[#FF7B6E]">
            SHORT
          </span>
        ) : (
          <AgeChip order={order} />
        )}
      </div>
      <p className="truncate text-[13px] font-medium text-slate-200">
        {order.customer}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px] uppercase tracking-wider text-slate-400">
          {order.lines} lines · {fmtQty(order.qtyFulfilled)}/{fmtQty(order.qty)} units
          {order.kitTable ? ` · tbl ${order.kitTable}` : ''}
          {order.shipTo ? ` · ${order.shipTo}` : ''}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {variant === 'ready' && <StockBadge order={order} />}
          {order.partialLines > 0 && isPickingLane(variant) && (
            <span className="rounded bg-[#E89C0C]/20 px-1 py-0.5 font-mono text-[9px] font-bold uppercase text-[#F5B94E]">
              {order.partialLines} partial
            </span>
          )}
        </span>
      </div>
      {isPickingLane(variant) && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-white/10">
          <motion.div
            initial={animate ? { width: 0 } : false}
            animate={{ width: `${order.pct}%` }}
            transition={{ delay: animate ? 0.3 : 0, duration: 0.6, ease }}
            className="h-full rounded"
            style={{ background: accent }}
          />
        </div>
      )}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Interactive alert ticker: pauses on hover, drag to scrub            */
/* ------------------------------------------------------------------ */

function AlertTicker({ alerts }: { alerts: string[] }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)
  const pausedRef = useRef(false)
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (alerts.length === 0) return
    let raf: number
    let last = performance.now()
    const tick = (t: number) => {
      const dt = t - last
      last = t
      if (!pausedRef.current && !dragRef.current) {
        offsetRef.current += dt * 0.055 // ~55px/s
      }
      const el = trackRef.current
      if (el) {
        const half = el.scrollWidth / 2 || 1
        let o = offsetRef.current % half
        if (o < 0) o += half
        el.style.transform = `translateX(${-o}px)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [alerts.length])

  if (alerts.length === 0) {
    return (
      <span className="font-mono text-[13px] text-[#3ECC5F]">
        No critical shipping alerts — keep it moving.
      </span>
    )
  }

  return (
    <div
      className={`min-w-0 flex-1 touch-none select-none overflow-hidden ${
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      title="Hover to pause · drag to scrub"
      onMouseEnter={() => {
        pausedRef.current = true
      }}
      onMouseLeave={() => {
        pausedRef.current = false
      }}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // pointer capture is best-effort (synthetic/pen edge cases)
        }
        dragRef.current = { startX: e.clientX, startOffset: offsetRef.current }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return
        offsetRef.current =
          dragRef.current.startOffset - (e.clientX - dragRef.current.startX)
      }}
      onPointerUp={() => {
        dragRef.current = null
        setDragging(false)
      }}
      onPointerCancel={() => {
        dragRef.current = null
        setDragging(false)
      }}
      data-testid="alert-ticker"
    >
      <div
        ref={trackRef}
        className="inline-block whitespace-nowrap font-mono text-[13px] font-semibold text-[#FFB4A8] will-change-transform"
      >
        {[...alerts, ...alerts].map((a, i) => (
          <span key={i} className="mx-6">
            ⚠ {a}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Lane                                                                */
/* ------------------------------------------------------------------ */

type SortKey = 'age' | 'progress'
type SortDir = 'desc' | 'asc'

function searchStateFor(
  order: WallboardOrder,
  query: string
): 'none' | 'hit' | 'miss' {
  if (!query) return 'none'
  return order.soNumber.toLowerCase().includes(query) ? 'hit' : 'miss'
}

function Lane({
  title,
  variant,
  orders,
  previewOrders,
  index,
  expanded,
  onToggle,
  glowSet,
  onAcknowledge,
  query,
}: {
  title: string
  variant: BoardLane
  orders: WallboardOrder[]
  previewOrders: WallboardOrder[]
  index: number
  expanded: boolean
  onToggle: () => void
  glowSet: Set<string>
  onAcknowledge: (soNumber: string) => void
  query: string
}) {
  const accent = LANE_ACCENTS[variant]
  const [sortKey, setSortKey] = useState<SortKey>('age')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const shown = expanded
    ? [...orders].sort((a, b) => {
        const v = sortKey === 'age' ? a.ageDays - b.ageDays : a.pct - b.pct
        return sortDir === 'desc' ? -v : v
      })
    : previewOrders.slice(0, LANE_CAPS[variant])
  const hidden = orders.length - shown.length

  const sortButton = (key: SortKey, label: string) => (
    <button
      onClick={() => toggleSort(key)}
      className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider transition-colors ${
        sortKey === key ? 'bg-white/10' : 'text-slate-500 hover:text-white'
      }`}
      style={sortKey === key ? { color: accent } : undefined}
      data-testid={`sort-${variant}-${key}`}
    >
      {label}
      {sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </button>
  )

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.45, ease }}
      className="flex min-h-0 min-w-0 flex-col"
      data-lane={title}
      data-expanded={expanded || undefined}
    >
      <header className="mb-2 flex items-center justify-between px-1">
        <button
          onClick={onToggle}
          title={expanded ? 'Show less' : 'Show all orders'}
          className="group flex items-center gap-2"
          data-testid={`expand-${variant}`}
        >
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accent }} />
          <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.16em] text-white transition-colors group-hover:text-[#3AACE3]">
            {title}
          </h2>
          <span
            className={`font-mono text-[11px] text-slate-500 transition-opacity ${
              expanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {expanded ? '⤡' : '⤢'}
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          {expanded && (
            <>
              {sortButton('age', 'Age')}
              {sortButton('progress', 'Prog')}
            </>
          )}
          <span
            className="rounded px-2 py-0.5 font-mono text-[13px] font-bold"
            style={{ background: `${accent}26`, color: accent }}
          >
            {orders.length}
          </span>
        </div>
      </header>
      <div
        className={`flex min-h-0 flex-1 flex-col gap-2 rounded-xl border p-2 transition-colors ${
          expanded
            ? 'overflow-y-auto border-white/15 bg-white/[0.04] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            : 'overflow-hidden border-white/5 bg-white/[0.02]'
        }`}
        data-testid={`lane-body-${variant}`}
      >
        {shown.map((o, i) => (
          <OrderCard
            key={o.soNumber}
            order={o}
            index={i}
            variant={variant}
            animate={!expanded}
            glowing={glowSet.has(o.soNumber)}
            searchState={searchStateFor(o, query)}
            onAcknowledge={onAcknowledge}
          />
        ))}
        {shown.length === 0 && (
          <p className="px-2 py-6 text-center font-mono text-[11px] uppercase tracking-wider text-slate-500">
            — none —
          </p>
        )}
        {!expanded && hidden > 0 && (
          <button
            onClick={onToggle}
            className="rounded px-1 py-0.5 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:text-white"
            data-testid={`view-all-${variant}`}
          >
            +{hidden} more — view all
          </button>
        )}
        {expanded && (
          <button
            onClick={onToggle}
            className="sticky bottom-0 rounded bg-[#0F1A2E]/90 px-1 py-1 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400 backdrop-blur transition-colors hover:text-white"
            data-testid={`show-less-${variant}`}
          >
            ⤡ show less
          </button>
        )}
      </div>
    </motion.section>
  )
}

/* ------------------------------------------------------------------ */

function receivingSearchState(
  order: ReceivingOrder,
  query: string
): 'none' | 'hit' | 'miss' {
  if (!query) return 'none'
  const hit = `${order.poNumber} ${order.vendorName}`
    .toLowerCase()
    .includes(query)
  return hit ? 'hit' : 'miss'
}

function ReceivingCard({
  order,
  index,
  query,
  isBeta,
}: {
  order: ReceivingOrder
  index: number
  query: string
  isBeta: boolean
}) {
  const searchState = receivingSearchState(order, query)
  const lastReceived = new Date(order.lastReceivedAt).toLocaleTimeString(
    'en-US',
    {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: '2-digit',
    }
  )
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: searchState === 'miss' ? 0.25 : 1, y: 0 }}
      transition={{ delay: 0.06 + index * 0.04, duration: 0.35, ease }}
      className={`rounded-xl border border-l-4 bg-[#162035] p-4 ${
        searchState === 'hit'
          ? 'border-white border-l-white ring-2 ring-white/80'
          : 'border-white/10 border-l-[#31C6B0]'
      }`}
      data-po={order.poNumber}
      data-search-hit={searchState === 'hit' || undefined}
      data-testid="receiving-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-lg font-bold text-white">
            PO {order.poNumber}
          </p>
          <p className="truncate text-sm font-medium text-slate-300">
            {order.vendorName}
          </p>
        </div>
        <span className="shrink-0 rounded bg-[#31C6B0]/15 px-2 py-1 font-mono text-[10px] font-bold uppercase text-[#57E2CE]">
          {lastReceived}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white/[0.04] p-3">
          <p className="font-mono text-2xl font-bold text-[#57E2CE]">
            {order.linesReceivedToday}
          </p>
          <p className="font-mono text-[9px] uppercase tracking-wider text-slate-400">
            lines received today
          </p>
        </div>
        <div className="rounded-lg bg-white/[0.04] p-3">
          <p className="font-mono text-2xl font-bold text-white">
            {order.totalPoLines}
          </p>
          <p className="font-mono text-[9px] uppercase tracking-wider text-slate-400">
            total PO lines
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-slate-400">
        <span>
          {order.deliveriesToday} deliver{order.deliveriesToday === 1 ? 'y' : 'ies'}
        </span>
        {!isBeta && <span>{fmtQty(order.quantityReceivedToday)} units today</span>}
      </div>

      {!isBeta && order.crossDockCandidates.length > 0 && (
        <div className="mt-3 rounded-lg border border-[#E89C0C]/40 bg-[#E89C0C]/10 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#F5B94E]">
              Cross-dock candidates
            </span>
            <span className="rounded bg-[#E89C0C]/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#F5B94E]">
              {order.crossDockCandidates.length} parts · {order.crossDockOrderCount} orders
            </span>
          </div>
          <div className="mt-2 space-y-1.5">
            {order.crossDockCandidates.slice(0, 3).map((candidate) => (
              <div
                key={candidate.partNumber}
                className="flex items-center justify-between gap-2 font-mono text-[10px]"
              >
                <span className="truncate font-bold text-white">
                  {candidate.partNumber}
                </span>
                <span className="truncate text-right text-slate-300">
                  {candidate.demand
                    .slice(0, 2)
                    .map((demand) =>
                      `${demand.soNumber}${demand.kind === 'kit' ? ' KIT' : ''}`
                    )
                    .join(' · ')}
                  {candidate.demand.length > 2
                    ? ` +${candidate.demand.length - 2}`
                    : ''}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 font-mono text-[8px] uppercase tracking-wider text-[#F5B94E]/80">
            informational match · not allocated
          </p>
        </div>
      )}
    </motion.article>
  )
}

function ReceivingView({
  data,
  query,
}: {
  data: ReceivingData
  query: string
}) {
  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-3">
      <section className="flex min-h-0 flex-col rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div>
            <h2 className="font-sans text-[13px] font-bold uppercase tracking-[0.16em] text-white">
              Received today · {data.chicagoDate}
            </h2>
            <p className="mt-1 font-sans text-[9px] uppercase tracking-wider text-slate-500">
              {data.sourceLabel} · America/Chicago
            </p>
          </div>
          {data.isBeta && (
            <span className="rounded border border-[#E89C0C]/40 bg-[#E89C0C]/10 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-[#F5B94E]">
              validation mode
            </span>
          )}
        </div>

        {data.error ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-[#D93025]/40 bg-[#D93025]/10 p-8 text-center font-mono text-sm text-[#FFB4A8]">
            {data.error}
          </div>
        ) : data.orders.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 p-8 text-center">
            <div>
              <p className="text-lg font-semibold text-slate-300">No receipts yet today</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                This view resets at midnight Chicago time
              </p>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 grid-cols-3 gap-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {data.orders.map((order, index) => (
              <ReceivingCard
                key={order.poNumber}
                order={order}
                index={index}
                query={query}
                isBeta={data.isBeta}
              />
            ))}
          </div>
        )}
      </section>

      <aside className="flex min-h-0 flex-col gap-3">
        <div className="rounded-xl border border-[#31C6B0]/30 bg-[#31C6B0]/5 p-4">
          <h2 className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-[#57E2CE]">
            Receiving definitions
          </h2>
          <dl className="mt-3 space-y-3 text-xs text-slate-300">
            <div>
              <dt className="font-semibold text-white">Lines received</dt>
              <dd>Distinct PO lines physically received today.</dd>
            </div>
            <div>
              <dt className="font-semibold text-white">Deliveries</dt>
              <dd>Distinct Fishbowl receipts. One PO line can arrive more than once.</dd>
            </div>
            <div>
              <dt className="font-semibold text-white">Total PO lines</dt>
              <dd>Cached physical part lines with an ordered quantity.</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-[#E89C0C]/30 bg-[#E89C0C]/5 p-4">
          <h2 className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-[#F5B94E]">
            Cross-dock guardrail
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            Candidates match today&apos;s received part to open Sales and Kit demand.
            They do not reserve stock or promise coverage. Confirm the physical
            quantity before moving it directly to picking.
          </p>
        </div>

        <div className="mt-auto rounded-xl border border-white/10 bg-white/[0.03] p-4 font-mono text-[9px] uppercase tracking-wider text-slate-500">
          <p>Auto-refresh 60s · read only</p>
          <p className="mt-1">Corrections and voids are retained but excluded from counts</p>
        </div>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function useClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(new Date()), 0)
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => {
      clearTimeout(initial)
      clearInterval(t)
    }
  }, [])
  return now
}

function SyncPill({
  label,
  ageMinutes,
  staleAfterMinutes,
  healthy = true,
}: {
  label: string
  ageMinutes: number | null
  staleAfterMinutes: number
  healthy?: boolean
}) {
  const stale = !healthy || ageMinutes === null || ageMinutes > staleAfterMinutes
  const ageText =
    ageMinutes === null
      ? '—'
      : ageMinutes >= 90
        ? `${Math.round(ageMinutes / 60)}h`
        : `${ageMinutes}m`
  return (
    <span
      className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
      data-testid={`sync-${label.toLowerCase()}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          stale ? 'bg-[#E89C0C]' : 'animate-pulse bg-[#3ECC5F]'
        }`}
      />
      <span className={stale ? 'text-[#F5B94E]' : 'text-slate-400'}>
        {label} {ageText}
      </span>
    </span>
  )
}

function orderSig(o: WallboardOrder, variant: LaneVariant): string {
  return `${variant}|${o.qtyFulfilled}|${o.pct}|${o.stock?.state ?? ''}|${o.completedToday}`
}

export function WallboardClient({
  data,
  galaxy,
  receiving,
}: {
  data: WallboardData
  galaxy: KitGalaxyData
  receiving: ReceivingData
}) {
  const router = useRouter()
  const clock = useClock()
  const [view, setView] = useState<'shipping' | 'receiving' | 'galaxy'>('shipping')
  const [expanded, setExpanded] = useState<BoardLane | null>(null)
  const [glowSet, setGlowSet] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const prevSigs = useRef<Map<string, string> | null>(null)
  const q = query.trim().toLowerCase()

  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60000)
    return () => clearInterval(t)
  }, [router])

  const lanes: Record<
    BoardLane,
    { title: string; orders: WallboardOrder[]; preview: WallboardOrder[] }
  > = useMemo(
    () => ({
      ready: {
        title: 'Ready to pick',
        orders: data.ready,
        preview: data.ready.filter((o) => o.ageDays <= 90),
      },
      pickingSales: {
        title: 'Picking · Sales',
        orders: data.pickingSales,
        preview: data.pickingSales.filter((o) => o.ageDays <= 90),
      },
      pickingKits: {
        title: 'Picking · Kits',
        orders: data.pickingKits,
        preview: data.pickingKits.filter((o) => o.ageDays <= 90),
      },
      shipped: {
        title: 'Shipped · 7 days',
        orders: data.shipped,
        preview: data.shipped,
      },
    }),
    [data]
  )

  // --- change glow across syncs ---
  useEffect(() => {
    const next = new Map<string, string>()
    for (const v of Object.keys(lanes) as BoardLane[]) {
      for (const o of lanes[v].orders) next.set(o.soNumber, orderSig(o, v))
    }
    for (const o of data.closedShort) next.set(o.soNumber, orderSig(o, 'short'))
    if (prevSigs.current === null) {
      prevSigs.current = next
      return
    }
    const changed = new Set<string>()
    for (const [so, sig] of next) {
      const prev = prevSigs.current.get(so)
      if (prev === undefined || prev !== sig) changed.add(so)
    }
    prevSigs.current = next
    setGlowSet(changed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.generatedAt])

  function acknowledge(soNumber: string) {
    setGlowSet((prev) => {
      if (!prev.has(soNumber)) return prev
      const next = new Set(prev)
      next.delete(soNumber)
      return next
    })
  }

  // --- SO search: auto-expand the lane holding the first hit, scroll to it ---
  const firstHitLane = useMemo<BoardLane | null>(() => {
    if (!q) return null
    for (const v of Object.keys(lanes) as BoardLane[]) {
      if (lanes[v].orders.some((o) => o.soNumber.toLowerCase().includes(q))) {
        return v
      }
    }
    return null
  }, [q, lanes])

  useEffect(() => {
    if (!q || view !== 'shipping') return
    if (firstHitLane) {
      const lane = lanes[firstHitLane]
      const visible = lane.preview.slice(0, LANE_CAPS[firstHitLane])
      const hitVisible = visible.some((o) => o.soNumber.toLowerCase().includes(q))
      if (!hitVisible) setExpanded(firstHitLane)
    }
    const t = setTimeout(() => {
      document
        .querySelector('[data-search-hit]')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, firstHitLane, data.generatedAt, view])

  const totalHits = useMemo(() => {
    if (!q) return 0
    if (view === 'receiving') {
      return receiving.orders.filter(
        (order) => receivingSearchState(order, q) === 'hit'
      ).length
    }
    const all = [
      ...data.ready,
      ...data.pickingSales,
      ...data.pickingKits,
      ...data.shipped,
      ...data.closedShort,
    ]
    return all.filter((o) => o.soNumber.toLowerCase().includes(q)).length
  }, [q, data, receiving.orders, view])

  const k = data.kpis
  const ages: SyncAges = data.syncAges

  const shippingKpis: {
    label: string
    value: number
    displayValue?: string
    note?: string
    tone?: 'warn' | 'critical' | 'good'
  }[] = [
    { label: 'Ready to pick', value: k.readyCount },
    {
      label: 'Picking',
      value: k.pickingCount,
      note: `${k.pickingSalesCount} sales · ${k.pickingKitsCount} kits`,
    },
    { label: 'Late >7d', value: k.lateCount, tone: k.lateCount > 0 ? 'warn' : undefined },
    {
      label: 'Stuck picks',
      value: k.stuckPickCount,
      tone: k.stuckPickCount > 0 ? 'critical' : undefined,
    },
    {
      label: 'No PO short',
      value: k.noPoCount,
      tone: k.noPoCount > 0 ? 'critical' : undefined,
    },
    {
      label: 'Backlog >90d',
      value: k.staleBacklogCount,
      tone: k.staleBacklogCount > 0 ? 'warn' : undefined,
    },
    { label: 'Shipped 7d', value: k.shippedThisWeek, tone: 'good' },
  ]
  const receivingKpis: typeof shippingKpis = [
    { label: 'POs today', value: receiving.totals.purchaseOrders },
    { label: 'Lines today', value: receiving.totals.linesReceived },
    {
      label: receiving.isBeta ? 'Units unavailable' : 'Units today',
      value: receiving.totals.quantityReceived,
      displayValue: receiving.isBeta ? '—' : undefined,
      note: receiving.isBeta ? 'receipt sync pending' : undefined,
      tone: receiving.isBeta ? 'warn' : 'good',
    },
    {
      label: 'Cross-dock parts',
      value: receiving.totals.crossDockParts,
      note: `${receiving.totals.crossDockOrders} open orders`,
      tone: receiving.totals.crossDockParts > 0 ? 'warn' : undefined,
    },
  ]
  const kpis = view === 'receiving' ? receivingKpis : shippingKpis

  return (
    <div
      className={`grid h-screen gap-3 overflow-hidden bg-[#0F1A2E] p-4 text-white ${
        view === 'shipping' ? 'grid-rows-[auto_auto_1fr]' : 'grid-rows-[auto_1fr]'
      }`}
    >
      <style>{`
        @keyframes wb-glow {
          0%, 100% {
            box-shadow: 0 0 0 1px var(--wb-glow-color),
              0 0 10px 0 color-mix(in srgb, var(--wb-glow-color) 40%, transparent);
          }
          50% {
            box-shadow: 0 0 0 2px var(--wb-glow-color),
              0 0 22px 3px color-mix(in srgb, var(--wb-glow-color) 75%, transparent);
          }
        }
        .wb-glow { animation: wb-glow 1.6s ease-in-out infinite; }
      `}</style>

      {/* header */}
      <header className="flex items-center justify-between gap-4">
        <div className="flex shrink-0 items-center gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1E98D5]">
              Medical Shipment
            </p>
            <h1 className="text-xl font-bold tracking-tight">
              {view === 'receiving' ? 'RECEIVING OPS' : 'SHIPPING OPS'}
            </h1>
          </div>
          <div className="flex rounded-lg border border-white/15 p-0.5 font-mono text-[10px] font-bold uppercase tracking-wider">
            <button
              onClick={() => setView('shipping')}
              className={`rounded-md px-2.5 py-1.5 transition-colors ${
                view === 'shipping'
                  ? 'bg-[#1E98D5] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
              data-testid="view-shipping"
            >
              Shipping
            </button>
            <button
              onClick={() => setView('receiving')}
              className={`rounded-md px-2.5 py-1.5 transition-colors ${
                view === 'receiving'
                  ? 'bg-[#31C6B0] text-[#0F1A2E]'
                  : 'text-slate-400 hover:text-white'
              }`}
              data-testid="view-receiving"
            >
              Receiving
            </button>
            <button
              onClick={() => setView('galaxy')}
              className={`rounded-md px-2.5 py-1.5 transition-colors ${
                view === 'galaxy'
                  ? 'bg-[#1E98D5] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
              data-testid="view-galaxy"
            >
              ✦ Kit Galaxy
            </button>
          </div>
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={view === 'receiving' ? 'Find PO / vendor…' : 'Find SO #…'}
              className="w-40 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 font-mono text-[13px] text-white outline-none transition-colors placeholder:text-slate-500 focus:border-[#1E98D5]"
              data-testid="so-search"
            />
            {q && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-slate-400 hover:text-white"
                data-testid="so-search-clear"
              >
                ✕
              </button>
            )}
            {q && (
              <p
                className={`absolute -bottom-4 left-1 font-mono text-[9px] uppercase tracking-wider ${
                  totalHits > 0 ? 'text-slate-400' : 'text-[#FF7B6E]'
                }`}
                data-testid="so-search-hits"
              >
                {totalHits > 0 ? `${totalHits} match${totalHits > 1 ? 'es' : ''}` : 'no match'}
              </p>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-stretch justify-center gap-2">
          {view !== 'galaxy' && kpis.map((kpi) => (
            <div
              key={kpi.label}
              className={`min-w-[96px] rounded-lg border px-2.5 py-1.5 text-center ${
                kpi.tone === 'critical'
                  ? 'border-[#D93025]/60 bg-[#D93025]/15'
                  : kpi.tone === 'warn'
                    ? 'border-[#E89C0C]/50 bg-[#E89C0C]/10'
                    : kpi.tone === 'good'
                      ? 'border-[#0FA62C]/50 bg-[#0FA62C]/10'
                      : 'border-white/10 bg-white/[0.04]'
              }`}
            >
              <p
                className={`text-2xl font-bold leading-none ${
                  kpi.tone === 'critical'
                    ? 'text-[#FF7B6E]'
                    : kpi.tone === 'warn'
                      ? 'text-[#F5B94E]'
                      : kpi.tone === 'good'
                        ? 'text-[#3ECC5F]'
                        : 'text-white'
                }`}
              >
                {kpi.displayValue ?? fmtQty(kpi.value)}
              </p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-400">
                {kpi.label}
              </p>
              {kpi.note && (
                <p className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-slate-500">
                  {kpi.note}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-3xl font-bold tabular-nums leading-none">
            {clock
              ? clock.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })
              : '--:--'}
          </p>
          <div className="mt-1.5 flex items-center justify-end gap-2.5">
            <SyncPill label="SO" ageMinutes={ages.so} staleAfterMinutes={120} />
            <SyncPill
              label="SHIP"
              ageMinutes={ages.shipments}
              staleAfterMinutes={120}
            />
            <SyncPill label="PO" ageMinutes={ages.po} staleAfterMinutes={26 * 60} />
            <SyncPill
              label="INV"
              ageMinutes={ages.inventory}
              staleAfterMinutes={26 * 60}
            />
            <SyncPill
              label="RCV"
              ageMinutes={receiving.syncAgeMinutes}
              staleAfterMinutes={35}
              healthy={
                receiving.source === 'receipt_events' &&
                receiving.syncStatus === 'success'
              }
            />
          </div>
        </div>
      </header>

      {/* alert ticker */}
      {view === 'shipping' && (
      <div
        className={`flex items-center gap-3 overflow-hidden rounded-lg border px-3 py-1.5 ${
          data.alerts.length > 0
            ? 'border-[#D93025]/50 bg-[#D93025]/10'
            : 'border-[#0FA62C]/30 bg-[#0FA62C]/5'
        }`}
      >
        <span
          className={`shrink-0 rounded px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider ${
            data.alerts.length > 0
              ? 'animate-pulse bg-[#D93025] text-white'
              : 'bg-[#0FA62C]/80 text-white'
          }`}
        >
          {data.alerts.length > 0 ? `${data.alerts.length} alerts` : 'All clear'}
        </span>
        <AlertTicker alerts={data.alerts} />
      </div>
      )}

      {/* Kit Galaxy view */}
      {view === 'galaxy' && (
        <div className="flex min-h-0 flex-col">
          <KitGalaxy data={galaxy} query={q} />
        </div>
      )}

      {/* Receiving view */}
      {view === 'receiving' && <ReceivingView data={receiving} query={q} />}

      {/* lanes + rail */}
      {view === 'shipping' && (
      <div className="grid min-h-0 grid-cols-[repeat(4,minmax(0,1fr))_280px] gap-3">
        {(Object.keys(lanes) as BoardLane[]).map((v, i) => (
          <Lane
            key={v}
            title={lanes[v].title}
            variant={v}
            orders={lanes[v].orders}
            previewOrders={lanes[v].preview}
            index={i}
            expanded={expanded === v}
            onToggle={() => setExpanded(expanded === v ? null : v)}
            glowSet={glowSet}
            onAcknowledge={acknowledge}
            query={q}
          />
        ))}

        <motion.aside
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.45, ease }}
          className="flex min-h-0 min-w-0 flex-col gap-3"
        >
          {/* longest waiting */}
          <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-[#E89C0C]/30 bg-[#E89C0C]/5 p-3">
            <h2 className="mb-2 font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-[#F5B94E]">
              ⏳ Longest waiting
            </h2>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
              {data.longestWaiting.map((o, i) => {
                const ss = searchStateFor(o, q)
                return (
                  <motion.div
                    key={o.soNumber}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: ss === 'miss' ? 0.25 : 1, x: 0 }}
                    transition={{ delay: 0.35 + i * 0.05, duration: 0.3, ease }}
                    className={`flex items-center justify-between gap-2 rounded-lg border bg-[#162035] px-3 py-2 ${
                      ss === 'hit'
                        ? 'border-white ring-2 ring-white/80'
                        : 'border-white/10'
                    }`}
                    data-so={o.soNumber}
                    data-search-hit={ss === 'hit' || undefined}
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-[13px] font-bold text-white">
                        {o.soNumber}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {o.customer}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-xl font-bold leading-none text-[#F5B94E]">
                        {o.ageDays}
                      </p>
                      <p className="font-mono text-[8px] uppercase tracking-wider text-slate-500">
                        days
                      </p>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>

          {/* closed short review — off the main board, it's slower-moving */}
          <div className="flex flex-col rounded-xl border border-[#D93025]/30 bg-[#D93025]/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-[#FF7B6E]">
                Closed short · 30d
              </h2>
              <span className="rounded bg-[#D93025]/20 px-2 py-0.5 font-mono text-[12px] font-bold text-[#FF7B6E]">
                {data.closedShort.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5" data-testid="closed-short-rail">
              {data.closedShort.slice(0, 3).map((o) => {
                const ss = searchStateFor(o, q)
                return (
                  <div
                    key={o.soNumber}
                    className={`flex items-center justify-between gap-2 rounded-lg border bg-[#162035] px-3 py-1.5 ${
                      ss === 'hit'
                        ? 'border-white ring-2 ring-white/80'
                        : 'border-white/10'
                    } ${ss === 'miss' ? 'opacity-25' : ''}`}
                    data-so={o.soNumber}
                    data-search-hit={ss === 'hit' || undefined}
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-[12px] font-bold text-white">
                        {o.soNumber}
                      </p>
                      <p className="truncate text-[10px] text-slate-400">
                        {o.customer}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[9px] uppercase text-slate-500">
                      {o.completedAt
                        ? new Date(o.completedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : ''}
                    </span>
                  </div>
                )
              })}
              {data.closedShort.length === 0 && (
                <p className="py-1 text-center font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  — none in 30 days —
                </p>
              )}
            </div>
            <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-wider text-slate-500">
              auto-refresh 60s · read only
            </p>
          </div>
        </motion.aside>
      </div>
      )}
    </div>
  )
}
