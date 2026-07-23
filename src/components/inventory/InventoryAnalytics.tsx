'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  Package,
  ClipboardList,
  AlertTriangle,
  Boxes,
  Truck,
  PackageCheck,
} from 'lucide-react'
import { fetchJson } from '@/lib/client-api'
import { cn } from '@/lib/utils'
import type { InventoryAnalytics as Analytics } from '@/lib/inventory/analytics'
import type { OnDrill } from './InventoryAnalyticsCharts'

// The chart band pulls in recharts — load it lazily so the stat tiles paint
// without the charting bundle. The skeleton row matches the chart cards.
const InventoryAnalyticsCharts = dynamic(
  () => import('./InventoryAnalyticsCharts').then((m) => m.InventoryAnalyticsCharts),
  { ssr: false, loading: () => <ChartRowSkeleton /> }
)

export type { ChartDrill } from './InventoryAnalyticsCharts'

const n = (value: number) => value.toLocaleString('en-US')

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
// Main band
// ---------------------------------------------------------------------------

function ChartRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="h-[320px] animate-pulse rounded-[0.625rem] border border-[#D6DEE3] bg-card dark:border-[rgba(255,255,255,0.1)]"
        />
      ))}
    </div>
  )
}

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
      <ChartRowSkeleton />
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

      <InventoryAnalyticsCharts
        shortages={demand.topShortages}
        buckets={inbound.buckets}
        daily={outbound.daily}
        onDrill={onDrill}
      />
    </div>
  )
}
