'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import type {
  WallboardData,
  WallboardOrder,
  LaneSeverity,
} from '@/lib/warehouse-board/data'

const ease = [0.22, 1, 0.36, 1] as const

type LaneVariant = 'ready' | 'picking' | 'shipped' | 'short'

const LANE_ACCENTS: Record<LaneVariant, string> = {
  ready: '#1E98D5',
  picking: '#E89C0C',
  shipped: '#0FA62C',
  short: '#D93025',
}

// Ambient (collapsed) card caps per lane — sized to fit 1080p with no scroll.
const LANE_CAPS: Record<LaneVariant, number> = {
  ready: 7,
  picking: 7,
  shipped: 6,
  short: 4,
}

const SEVERITY_STYLES: Record<LaneSeverity, string> = {
  ok: 'bg-white/10 text-slate-300',
  warn: 'bg-[#E89C0C]/20 text-[#F5B94E]',
  critical: 'bg-[#D93025]/25 text-[#FF7B6E] animate-pulse',
}

function AgeChip({ order }: { order: WallboardOrder }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${SEVERITY_STYLES[order.severity]}`}
    >
      {order.ageDays}d
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
  onAcknowledge,
}: {
  order: WallboardOrder
  index: number
  variant: LaneVariant
  animate?: boolean
  glowing?: boolean
  onAcknowledge?: (soNumber: string) => void
}) {
  const accent = LANE_ACCENTS[variant]
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: animate ? 0.1 + index * 0.04 : 0, duration: 0.35, ease }}
      onClick={() => onAcknowledge?.(order.soNumber)}
      className={`shrink-0 rounded-lg border border-white/10 bg-[#162035] px-3 py-2 ${
        glowing ? 'wb-glow cursor-pointer' : ''
      }`}
      style={
        {
          borderLeftColor: accent,
          borderLeftWidth: 3,
          '--wb-glow-color': accent,
        } as React.CSSProperties
      }
      data-so={order.soNumber}
      data-glowing={glowing || undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[15px] font-bold tracking-tight text-white">
          {order.soNumber}
        </span>
        {variant === 'shipped' ? (
          <span className="font-mono text-[11px] font-bold text-[#3ECC5F]">
            {order.completedToday ? '✓ TODAY' : '✓ SHIPPED'}
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
          {order.lines} lines · {order.qtyFulfilled}/{order.qty} units
          {order.shipTo ? ` · ${order.shipTo}` : ''}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {variant === 'ready' && <StockBadge order={order} />}
          {order.partialLines > 0 && variant === 'picking' && (
            <span className="rounded bg-[#E89C0C]/20 px-1 py-0.5 font-mono text-[9px] font-bold uppercase text-[#F5B94E]">
              {order.partialLines} partial
            </span>
          )}
        </span>
      </div>
      {variant === 'picking' && (
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
        // content follows the cursor: drag right rewinds, drag left advances
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
/* Lane: collapsed shows the top of the queue; expanded shows all      */
/* orders in-place with wheel scrolling and age/progress sorting.      */
/* ------------------------------------------------------------------ */

type SortKey = 'age' | 'progress'
type SortDir = 'desc' | 'asc'

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
}: {
  title: string
  variant: LaneVariant
  orders: WallboardOrder[]
  previewOrders: WallboardOrder[]
  index: number
  expanded: boolean
  onToggle: () => void
  glowSet: Set<string>
  onAcknowledge: (soNumber: string) => void
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
        sortKey === key
          ? 'bg-white/10'
          : 'text-slate-500 hover:text-white'
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
      className="flex min-h-0 flex-col"
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

function useClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/* ------------------------------------------------------------------ */

function orderSig(o: WallboardOrder, variant: LaneVariant): string {
  return `${variant}|${o.qtyFulfilled}|${o.pct}|${o.stock?.state ?? ''}|${o.completedToday}`
}

export function WallboardClient({ data }: { data: WallboardData }) {
  const router = useRouter()
  const clock = useClock()
  const [expanded, setExpanded] = useState<LaneVariant | null>(null)
  const [glowSet, setGlowSet] = useState<Set<string>>(new Set())
  const prevSigs = useRef<Map<string, string> | null>(null)

  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60000)
    return () => clearInterval(t)
  }, [router])

  // Ambient lanes show the actionable horizon (≤90d); expanded lanes and the
  // "longest waiting" rail carry the long tail.
  const lanes: Record<
    LaneVariant,
    { title: string; orders: WallboardOrder[]; preview: WallboardOrder[] }
  > = {
    ready: {
      title: 'Ready to pick',
      orders: data.ready,
      preview: data.ready.filter((o) => o.ageDays <= 90),
    },
    picking: {
      title: 'Picking',
      orders: data.picking,
      preview: data.picking.filter((o) => o.ageDays <= 90),
    },
    shipped: {
      title: 'Shipped · 7 days',
      orders: data.shipped,
      preview: data.shipped,
    },
    short: {
      title: 'Closed short',
      orders: data.closedShort,
      preview: data.closedShort,
    },
  }

  // Change detection across syncs: a card glows when its lane or progress
  // changed since the previous refresh, until clicked or the next sync.
  useEffect(() => {
    const next = new Map<string, string>()
    for (const v of Object.keys(lanes) as LaneVariant[]) {
      for (const o of lanes[v].orders) next.set(o.soNumber, orderSig(o, v))
    }
    if (prevSigs.current === null) {
      prevSigs.current = next // first paint: nothing glows
      return
    }
    const changed = new Set<string>()
    for (const [so, sig] of next) {
      const prev = prevSigs.current.get(so)
      if (prev !== undefined && prev !== sig) changed.add(so)
      if (prev === undefined) changed.add(so) // newly appeared order
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

  const syncStale = data.syncAgeMinutes !== null && data.syncAgeMinutes > 120
  const k = data.kpis

  const kpis: { label: string; value: number; tone?: 'warn' | 'critical' | 'good' }[] = [
    { label: 'Ready to pick', value: k.readyCount },
    { label: 'Picking', value: k.pickingCount },
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

  return (
    <div className="grid h-screen grid-rows-[auto_auto_1fr] gap-3 overflow-hidden bg-[#0F1A2E] p-4 text-white">
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
      <header className="flex items-center justify-between gap-6">
        <div className="shrink-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1E98D5]">
            Medical Shipment
          </p>
          <h1 className="text-xl font-bold tracking-tight">SHIPPING OPS</h1>
        </div>

        <div className="flex flex-1 items-stretch justify-center gap-2">
          {kpis.map((kpi) => (
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
                {kpi.value}
              </p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-400">
                {kpi.label}
              </p>
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
          <p className="mt-1 flex items-center justify-end gap-1.5 font-mono text-[10px] uppercase tracking-wider">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                syncStale ? 'bg-[#E89C0C]' : 'animate-pulse bg-[#3ECC5F]'
              }`}
            />
            <span className={syncStale ? 'text-[#F5B94E]' : 'text-slate-400'}>
              {syncStale
                ? `SYNC ${Math.round((data.syncAgeMinutes ?? 0) / 60)}h OLD`
                : `LIVE · FISHBOWL ${data.syncAgeMinutes ?? '—'}m`}
            </span>
          </p>
        </div>
      </header>

      {/* alert ticker */}
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

      {/* lanes + rail */}
      <div className="grid min-h-0 grid-cols-[1fr_1fr_1fr_1fr_300px] gap-3">
        {(Object.keys(lanes) as LaneVariant[]).map((v, i) => (
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
          />
        ))}

        <motion.aside
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.45, ease }}
          className="flex min-h-0 flex-col rounded-xl border border-[#E89C0C]/30 bg-[#E89C0C]/5 p-3"
        >
          <h2 className="mb-2 font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-[#F5B94E]">
            ⏳ Longest waiting
          </h2>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            {data.longestWaiting.map((o, i) => (
              <motion.div
                key={o.soNumber}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 + i * 0.05, duration: 0.3, ease }}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#162035] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-mono text-[13px] font-bold text-white">
                    {o.soNumber}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">{o.customer}</p>
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
            ))}
          </div>
          <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-wider text-slate-500">
            auto-refresh 60s · read only
          </p>
        </motion.aside>
      </div>
    </div>
  )
}
