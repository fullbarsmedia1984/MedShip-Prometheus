'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
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

function OrderCard({
  order,
  index,
  variant,
  animate = true,
}: {
  order: WallboardOrder
  index: number
  variant: LaneVariant
  animate?: boolean
}) {
  const accent = LANE_ACCENTS[variant]
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: animate ? 0.1 + index * 0.04 : 0, duration: 0.35, ease }}
      className="rounded-lg border border-white/10 bg-[#162035] px-3 py-2"
      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
      data-so={order.soNumber}
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
        {order.partialLines > 0 && variant === 'picking' && (
          <span className="shrink-0 rounded bg-[#E89C0C]/20 px-1 py-0.5 font-mono text-[9px] font-bold uppercase text-[#F5B94E]">
            {order.partialLines} partial
          </span>
        )}
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
/* Expanded lane overlay: every order in a status, sortable            */
/* ------------------------------------------------------------------ */

type SortKey = 'age' | 'progress'
type SortDir = 'desc' | 'asc'

function ExpandedLane({
  title,
  variant,
  orders,
  onClose,
}: {
  title: string
  variant: LaneVariant
  orders: WallboardOrder[]
  onClose: () => void
}) {
  const accent = LANE_ACCENTS[variant]
  const [sortKey, setSortKey] = useState<SortKey>('age')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sorted = [...orders].sort((a, b) => {
    const v =
      sortKey === 'age' ? a.ageDays - b.ageDays : a.pct - b.pct
    return sortDir === 'desc' ? -v : v
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortButton = (key: SortKey, label: string) => (
    <button
      onClick={() => toggleSort(key)}
      className={`rounded-md border px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors ${
        sortKey === key
          ? 'border-current bg-white/10'
          : 'border-white/15 text-slate-400 hover:border-white/40 hover:text-white'
      }`}
      style={sortKey === key ? { color: accent } : undefined}
      data-testid={`sort-${key}`}
    >
      {label} {sortKey === key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </button>
  )

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px]"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 14 }}
        transition={{ duration: 0.28, ease }}
        className="fixed inset-x-[4vw] inset-y-[6vh] z-50 flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0F1A2E] shadow-2xl"
        data-testid="expanded-lane"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-sm" style={{ background: accent }} />
            <h2 className="font-mono text-[15px] font-bold uppercase tracking-[0.16em] text-white">
              {title}
            </h2>
            <span
              className="rounded px-2 py-0.5 font-mono text-[13px] font-bold"
              style={{ background: `${accent}26`, color: accent }}
            >
              {orders.length} orders
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              sort
            </span>
            {sortButton('age', 'Age')}
            {sortButton('progress', 'Progress')}
            <button
              onClick={onClose}
              className="ml-2 rounded-md border border-white/15 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:border-[#D93025] hover:text-[#FF7B6E]"
              data-testid="close-expanded"
            >
              esc ✕
            </button>
          </div>
        </header>
        <div className="grid flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto p-4 xl:grid-cols-4">
          {sorted.map((o, i) => (
            <OrderCard
              key={o.soNumber}
              order={o}
              index={i}
              variant={variant}
              animate={false}
            />
          ))}
          {sorted.length === 0 && (
            <p className="col-span-full py-10 text-center font-mono text-[12px] uppercase tracking-wider text-slate-500">
              — no orders in this status —
            </p>
          )}
        </div>
      </motion.div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Ambient lane                                                        */
/* ------------------------------------------------------------------ */

function Lane({
  title,
  variant,
  orders,
  previewOrders,
  index,
  onExpand,
}: {
  title: string
  variant: LaneVariant
  orders: WallboardOrder[]
  previewOrders: WallboardOrder[]
  index: number
  onExpand: () => void
}) {
  const accent = LANE_ACCENTS[variant]
  const shown = previewOrders.slice(0, LANE_CAPS[variant])
  const hidden = orders.length - shown.length
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.45, ease }}
      className="flex min-h-0 flex-col"
      data-lane={title}
    >
      <header className="mb-2 flex items-center justify-between px-1">
        <button
          onClick={onExpand}
          title="Show all orders"
          className="group flex items-center gap-2"
          data-testid={`expand-${variant}`}
        >
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accent }} />
          <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.16em] text-white transition-colors group-hover:text-[#3AACE3]">
            {title}
          </h2>
          <span className="font-mono text-[11px] text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
            ⤢
          </span>
        </button>
        <span
          className="rounded px-2 py-0.5 font-mono text-[13px] font-bold"
          style={{ background: `${accent}26`, color: accent }}
        >
          {orders.length}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] p-2">
        {shown.map((o, i) => (
          <OrderCard key={o.soNumber} order={o} index={i} variant={variant} />
        ))}
        {shown.length === 0 && (
          <p className="px-2 py-6 text-center font-mono text-[11px] uppercase tracking-wider text-slate-500">
            — none —
          </p>
        )}
        {hidden > 0 && (
          <button
            onClick={onExpand}
            className="rounded px-1 py-0.5 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:text-white"
          >
            +{hidden} more — view all
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

export function WallboardClient({ data }: { data: WallboardData }) {
  const router = useRouter()
  const clock = useClock()
  const [expanded, setExpanded] = useState<LaneVariant | null>(null)

  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60000)
    return () => clearInterval(t)
  }, [router])

  const syncStale = data.syncAgeMinutes !== null && data.syncAgeMinutes > 120
  const k = data.kpis

  // Ambient lanes show the actionable horizon (≤90d); the expanded view and
  // the "longest waiting" rail carry the long tail.
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
      label: 'Backlog >90d',
      value: k.staleBacklogCount,
      tone: k.staleBacklogCount > 0 ? 'warn' : undefined,
    },
    { label: 'Shipped 7d', value: k.shippedThisWeek, tone: 'good' },
  ]

  return (
    <div className="grid h-screen grid-rows-[auto_auto_1fr] gap-3 overflow-hidden bg-[#0F1A2E] p-4 text-white">
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
              className={`min-w-[110px] rounded-lg border px-3 py-1.5 text-center ${
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
            onExpand={() => setExpanded(v)}
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

      <AnimatePresence>
        {expanded && (
          <ExpandedLane
            title={lanes[expanded].title}
            variant={expanded}
            orders={lanes[expanded].orders}
            onClose={() => setExpanded(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
