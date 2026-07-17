'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'
import {
  Package,
  ClipboardList,
  AlertTriangle,
  Boxes,
  Truck,
  PackageCheck,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { fetchJson } from '@/lib/client-api'
import { cn } from '@/lib/utils'
import type {
  InventoryAnalytics as Analytics,
  ShortagePart,
  InboundBucket,
  InboundBucketKey,
  OutboundDay,
} from '@/lib/inventory/analytics'

const n = (value: number) => value.toLocaleString('en-US')

/** A chart bar the user clicked — the page turns it into filters/detail. */
export type ChartDrill =
  | { type: 'part'; part: ShortagePart }
  | { type: 'bucket'; key: InboundBucketKey; label: string }
  | { type: 'day'; day: OutboundDay }

type OnDrill = (drill: ChartDrill) => void

// ---------------------------------------------------------------------------
// Stat tiles
// ---------------------------------------------------------------------------

interface StatTileProps {
  title: string
  value: string
  sub: string
  icon: React.ElementType
  tone: 'primary' | 'navy' | 'success' | 'warning' | 'danger' | 'slate' | 'accent'
  alert?: string | null
}

const TONE: Record<StatTileProps['tone'], { icon: string; bg: string }> = {
  primary: { icon: 'text-medship-primary', bg: 'bg-medship-primary/10' },
  navy: { icon: 'text-medship-primary-dark dark:text-medship-primary-light', bg: 'bg-medship-primary-dark/10 dark:bg-medship-primary/10' },
  success: { icon: 'text-medship-success', bg: 'bg-medship-success/10' },
  warning: { icon: 'text-medship-warning', bg: 'bg-medship-warning/10' },
  danger: { icon: 'text-medship-danger', bg: 'bg-medship-danger/10' },
  slate: { icon: 'text-medship-slate dark:text-medship-muted', bg: 'bg-medship-slate/10' },
  accent: { icon: 'text-medship-accent', bg: 'bg-medship-accent/10' },
}

function StatTile({ title, value, sub, icon: Icon, tone, alert }: StatTileProps) {
  const t = TONE[tone]
  return (
    <div className="overflow-hidden rounded-[0.625rem] border border-[#D6DEE3] bg-card shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)] dark:border-[rgba(255,255,255,0.1)] dark:shadow-none">
      <div className="flex items-start gap-3 px-4 py-4">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', t.bg, t.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold leading-tight text-card-foreground tabular-nums">
              {value}
            </span>
            {alert ? (
              <span className="rounded-full bg-medship-danger/10 px-2 py-0.5 text-[0.65rem] font-semibold text-medship-danger whitespace-nowrap">
                {alert}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={sub}>
            {sub}
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chart tooltips (match the sales-dashboard tooltip chrome)
// ---------------------------------------------------------------------------

function TooltipShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      {children}
    </div>
  )
}

function ShortageTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload?: ShortagePart }>
}) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null
  return (
    <TooltipShell>
      <p className="mb-1 text-[0.813rem] font-medium text-[#1C3C6E]">{row.part}</p>
      {row.description ? (
        <p className="mb-1 max-w-56 text-[0.7rem] text-[#8A9BA5]">{row.description}</p>
      ) : null}
      <p className="text-[0.75rem] text-[#576671]">
        Short: <span className="font-semibold text-[#D93025]">{n(row.short)}</span>
        {' '}(demand {n(row.demand)} · on hand {n(row.onHand)})
      </p>
      <p className="text-[0.75rem] text-[#576671]">
        On order:{' '}
        <span className={row.onOrder > 0 ? 'font-semibold text-[#1E98D5]' : 'font-semibold text-[#D93025]'}>
          {row.onOrder > 0 ? n(row.onOrder) : 'NO PO'}
        </span>
        {row.eta ? <span> · ETA {row.eta}</span> : null}
      </p>
      <p className="text-[0.75rem] text-[#576671]">
        Open SOs affected: <span className="font-semibold text-[#1C3C6E]">{row.sos}</span>
      </p>
    </TooltipShell>
  )
}

function InboundTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload?: InboundBucket }>
}) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null
  return (
    <TooltipShell>
      <p className="mb-1 text-[0.813rem] font-medium text-[#1C3C6E]">{row.label}</p>
      <p className="text-[0.75rem] text-[#576671]">
        Units: <span className="font-semibold text-[#1E98D5]">{n(row.units)}</span>
      </p>
      <p className="text-[0.75rem] text-[#576671]">
        PO lines: <span className="font-semibold text-[#1C3C6E]">{n(row.lines)}</span>
      </p>
    </TooltipShell>
  )
}

function OutboundTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload?: OutboundDay }>
}) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null
  return (
    <TooltipShell>
      <p className="mb-1 text-[0.813rem] font-medium text-[#1C3C6E]">{row.label}</p>
      <p className="text-[0.75rem] text-[#576671]">
        Shipments: <span className="font-semibold text-[#0FA62C]">{n(row.shipments)}</span>
      </p>
      <p className="text-[0.75rem] text-[#576671]">
        Cartons: <span className="font-semibold text-[#1C3C6E]">{n(row.cartons)}</span>
      </p>
      {row.ma20 !== null ? (
        <p className="text-[0.75rem] text-[#576671]">
          20-day avg: <span className="font-semibold text-[#1C3C6E]">{row.ma20}</span>
        </p>
      ) : null}
    </TooltipShell>
  )
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const AXIS_TICK = { fontSize: 11, fill: '#576671', fontFamily: 'Outfit' }
const GRID_STROKE = '#D6DEE3'

const COVERAGE_COLOR: Record<ShortagePart['coverage'], string> = {
  none: '#D93025',
  partial: '#E89C0C',
  full: '#1E98D5',
}

const BUCKET_COLOR: Record<InboundBucket['key'], string> = {
  overdue: '#D93025',
  this_week: '#1E98D5',
  next_week: '#3AACE3',
  two_to_four: '#1C3C6E',
  later: '#B5C8CD',
  no_date: '#8A9BA5',
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function ShortageChart({ data, onDrill }: { data: ShortagePart[]; onDrill?: OnDrill }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Shortage Hot List</CardTitle>
          <div className="flex gap-3">
            <LegendChip color={COVERAGE_COLOR.none} label="No PO" />
            <LegendChip color={COVERAGE_COLOR.partial} label="Partly on order" />
            <LegendChip color={COVERAGE_COLOR.full} label="On order" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Open SO demand exceeding on-hand stock (kit assemblies excluded) —
          click a bar to inspect the part
        </p>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <ChartEmpty message="Every open order line is covered by on-hand stock 🎉" />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
              <XAxis
                type="number"
                tick={AXIS_TICK}
                axisLine={{ stroke: GRID_STROKE }}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="part"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={104}
              />
              <Tooltip content={<ShortageTooltip />} cursor={{ fill: 'rgba(30,152,213,0.04)' }} />
              <Bar
                dataKey="short"
                radius={[0, 4, 4, 0]}
                barSize={16}
                cursor="pointer"
                onClick={(entry: unknown) => {
                  const p = (entry as { payload?: ShortagePart })?.payload
                  if (p) onDrill?.({ type: 'part', part: p })
                }}
              >
                {data.map((entry) => (
                  <Cell key={entry.part} fill={COVERAGE_COLOR[entry.coverage]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

function InboundChart({ buckets, onDrill }: { buckets: InboundBucket[]; onDrill?: OnDrill }) {
  const hasInbound = buckets.some((b) => b.units > 0)
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Inbound Pipeline</CardTitle>
        <p className="text-xs text-muted-foreground">
          Units on open purchase orders by expected arrival — click a bar to
          filter the table to those parts
        </p>
      </CardHeader>
      <CardContent>
        {!hasInbound ? (
          <ChartEmpty message="No open purchase-order lines" />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={{ stroke: GRID_STROKE }}
                tickLine={false}
                interval={0}
              />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={44} />
              <Tooltip content={<InboundTooltip />} cursor={{ fill: 'rgba(30,152,213,0.04)' }} />
              <Bar
                dataKey="units"
                radius={[4, 4, 0, 0]}
                barSize={32}
                cursor="pointer"
                onClick={(entry: unknown) => {
                  const b = (entry as { payload?: InboundBucket })?.payload
                  if (b && b.units > 0) {
                    onDrill?.({ type: 'bucket', key: b.key, label: b.label })
                  }
                }}
              >
                {buckets.map((entry) => (
                  <Cell key={entry.key} fill={BUCKET_COLOR[entry.key]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

// Ranges slice the server's 180-day business-day series: ~22 business days
// per month. The 20-period MA is precomputed over the full series, so even
// the 30-day view shows a fully-formed average.
const OUTBOUND_RANGES = [
  { days: 30, points: 22, tickEvery: 5, barSize: 10 },
  { days: 90, points: 64, tickEvery: 13, barSize: 4 },
  { days: 180, points: 128, tickEvery: 26, barSize: 2 },
] as const

function OutboundChart({ daily, onDrill }: { daily: OutboundDay[]; onDrill?: OnDrill }) {
  const [rangeDays, setRangeDays] = useState<30 | 90 | 180>(30)
  const range = OUTBOUND_RANGES.find((r) => r.days === rangeDays)!
  const visible = daily.slice(-range.points)
  const hasShipments = visible.some((d) => d.shipments > 0)
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Outbound Velocity</CardTitle>
          <div className="flex items-center gap-2">
            <LegendChip color="#1C3C6E" label="20-day avg" />
            <div className="flex overflow-hidden rounded-md border border-[#D6DEE3] dark:border-[rgba(255,255,255,0.1)]">
              {OUTBOUND_RANGES.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  onClick={() => setRangeDays(r.days)}
                  className={cn(
                    'px-2 py-0.5 text-[0.7rem] font-medium transition-colors',
                    r.days === rangeDays
                      ? 'bg-medship-primary text-white'
                      : 'bg-transparent text-muted-foreground hover:bg-medship-primary/10'
                  )}
                >
                  {r.days}d
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Shipments out the door per business day — click a bar for that
          day&apos;s SOs
        </p>
      </CardHeader>
      <CardContent>
        {!hasShipments ? (
          <ChartEmpty message={`No shipments recorded in the last ${rangeDays} days`} />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={visible} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ ...AXIS_TICK, fontSize: 10 }}
                axisLine={{ stroke: GRID_STROKE }}
                tickLine={false}
                interval={range.tickEvery - 1}
              />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
              <Tooltip content={<OutboundTooltip />} cursor={{ fill: 'rgba(15,166,44,0.06)' }} />
              <Bar
                dataKey="shipments"
                radius={[2, 2, 0, 0]}
                barSize={range.barSize}
                cursor="pointer"
                onClick={(entry: unknown) => {
                  const d = (entry as { payload?: OutboundDay })?.payload
                  if (d) onDrill?.({ type: 'day', day: d })
                }}
              >
                {visible.map((entry) => (
                  <Cell
                    key={entry.date}
                    fill={entry.isToday ? '#0FA62C' : 'rgba(15,166,44,0.45)'}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="ma20"
                stroke="#1C3C6E"
                strokeWidth={2}
                dot={false}
                activeDot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main band
// ---------------------------------------------------------------------------

function SkeletonBand() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="h-[104px] animate-pulse rounded-[0.625rem] border border-[#D6DEE3] bg-card dark:border-[rgba(255,255,255,0.1)]"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="h-[320px] animate-pulse rounded-[0.625rem] border border-[#D6DEE3] bg-card dark:border-[rgba(255,255,255,0.1)]"
          />
        ))}
      </div>
    </div>
  )
}

export function InventoryAnalytics({ onDrill }: { onDrill?: OnDrill }) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchJson<{ analytics: Analytics }>('/api/dashboard/inventory/analytics')
      .then((data) => {
        if (!cancelled) setAnalytics(data.analytics)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) return null
  if (!analytics) return <SkeletonBand />

  const { stock, demand, inbound, outbound } = analytics

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          title="SKUs on hand"
          value={n(stock.skusOnHand)}
          sub={`${n(stock.unitsOnHand)} units on the floor`}
          icon={Package}
          tone="primary"
        />
        <StatTile
          title="Committed to orders"
          value={n(demand.committedUnits)}
          sub={`${n(demand.committedParts)} parts · ${n(demand.openSos)} open SOs`}
          icon={ClipboardList}
          tone="navy"
        />
        <StatTile
          title="Parts short"
          value={n(demand.shortParts)}
          sub={
            demand.shortParts > 0
              ? `${n(demand.shortUnits)} units · ${n(demand.affectedSos)} SOs affected`
              : 'All open demand covered by stock'
          }
          icon={AlertTriangle}
          tone={demand.shortParts > 0 ? 'danger' : 'success'}
          alert={demand.noPoParts > 0 ? `${demand.noPoParts} NO PO` : null}
        />
        <StatTile
          title="Kits to assemble"
          value={n(demand.kitUnits)}
          sub={`${n(demand.kitParts)} kit SKUs · ${n(demand.kitSos)} open SOs`}
          icon={Boxes}
          tone="accent"
        />
        <StatTile
          title="Inbound units"
          value={n(inbound.units)}
          sub={`${n(inbound.lineCount)} lines · ${n(inbound.poCount)} POs`}
          icon={Truck}
          tone="primary"
          alert={inbound.overdueLines > 0 ? `${inbound.overdueLines} overdue` : null}
        />
        <StatTile
          title="Shipped last 7 days"
          value={n(outbound.shipped7d)}
          sub={`${n(outbound.shippedToday)} today · ${n(outbound.cartons7d)} cartons`}
          icon={PackageCheck}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ShortageChart data={demand.topShortages} onDrill={onDrill} />
        <InboundChart buckets={inbound.buckets} onDrill={onDrill} />
        <OutboundChart daily={outbound.daily} onDrill={onDrill} />
      </div>
    </div>
  )
}
