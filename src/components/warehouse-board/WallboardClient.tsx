'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import type { WallboardData, WallboardOrder, LaneSeverity } from '@/lib/warehouse-board/data'

const ease = [0.22, 1, 0.36, 1] as const

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
}: {
  order: WallboardOrder
  index: number
  variant: 'ready' | 'picking' | 'shipped' | 'short'
}) {
  const accent =
    variant === 'ready'
      ? '#1E98D5'
      : variant === 'picking'
        ? '#E89C0C'
        : variant === 'shipped'
          ? '#0FA62C'
          : '#D93025'
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.04, duration: 0.35, ease }}
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
            initial={{ width: 0 }}
            animate={{ width: `${order.pct}%` }}
            transition={{ delay: 0.3, duration: 0.6, ease }}
            className="h-full rounded"
            style={{ background: accent }}
          />
        </div>
      )}
    </motion.div>
  )
}

function Lane({
  title,
  count,
  accent,
  orders,
  overflow,
  variant,
  index,
}: {
  title: string
  count: number
  accent: string
  orders: WallboardOrder[]
  overflow: number
  variant: 'ready' | 'picking' | 'shipped' | 'short'
  index: number
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.45, ease }}
      className="flex min-h-0 flex-col"
      data-lane={title}
    >
      <header className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accent }} />
          <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.16em] text-white">
            {title}
          </h2>
        </div>
        <span
          className="rounded px-2 py-0.5 font-mono text-[13px] font-bold"
          style={{ background: `${accent}26`, color: accent }}
        >
          {count}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] p-2">
        {orders.map((o, i) => (
          <OrderCard key={o.soNumber} order={o} index={i} variant={variant} />
        ))}
        {orders.length === 0 && (
          <p className="px-2 py-6 text-center font-mono text-[11px] uppercase tracking-wider text-slate-500">
            — none —
          </p>
        )}
        {overflow > 0 && (
          <p className="px-1 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            +{overflow} more
          </p>
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

export function WallboardClient({ data }: { data: WallboardData }) {
  const router = useRouter()
  const clock = useClock()

  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60000)
    return () => clearInterval(t)
  }, [router])

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
        <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
          {data.alerts.length > 0 ? (
            <div className="inline-block animate-[wallboard-marquee_30s_linear_infinite] whitespace-nowrap font-mono text-[13px] font-semibold text-[#FFB4A8]">
              {[...data.alerts, ...data.alerts].map((a, i) => (
                <span key={i} className="mx-6">
                  ⚠ {a}
                </span>
              ))}
            </div>
          ) : (
            <span className="font-mono text-[13px] text-[#3ECC5F]">
              No critical shipping alerts — keep it moving.
            </span>
          )}
        </div>
        <style>{`@keyframes wallboard-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
      </div>

      {/* lanes + rail */}
      <div className="grid min-h-0 grid-cols-[1fr_1fr_1fr_1fr_300px] gap-3">
        <Lane
          title="Ready to pick"
          count={k.readyCount}
          accent="#1E98D5"
          orders={data.ready}
          overflow={data.readyOverflow}
          variant="ready"
          index={0}
        />
        <Lane
          title="Picking"
          count={k.pickingCount}
          accent="#E89C0C"
          orders={data.picking}
          overflow={data.pickingOverflow}
          variant="picking"
          index={1}
        />
        <Lane
          title="Shipped · 7 days"
          count={k.shippedThisWeek}
          accent="#0FA62C"
          orders={data.shipped}
          overflow={data.shippedOverflow}
          variant="shipped"
          index={2}
        />
        <Lane
          title="Closed short"
          count={data.closedShort.length + data.closedShortOverflow}
          accent="#D93025"
          orders={data.closedShort}
          overflow={data.closedShortOverflow}
          variant="short"
          index={3}
        />

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
