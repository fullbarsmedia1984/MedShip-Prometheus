'use client'

import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { MessageSquare, Timer } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ComingSoonBadge, ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import type { CallActivityPeriodSummary, CallActivitySummary } from '@/lib/data'
import { cn } from '@/lib/utils'

type PeriodMode = 'daily' | 'weekly' | 'monthly'
type MetricMode = 'conversationCalls' | 'totalDurationMin'

interface RepColor {
  name: string
  color: string
}

interface RingDnaRepActivityChartsProps {
  summary: CallActivitySummary | null
  reps: RepColor[]
}

const fallbackPalette = ['#1E98D5', '#0FA62C', '#1C3C6E', '#A0007E', '#E89C0C', '#D93025', '#B5C8CD', '#3AACE3']
const periodLabels: Record<PeriodMode, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

function periodSubtitle(mode: PeriodMode): string {
  if (mode === 'daily') return 'Last 6 days'
  if (mode === 'weekly') return 'Last 6 weeks'
  return 'Last 6 months'
}

function axisLabel(period: CallActivityPeriodSummary): string {
  return period.label.replace(/^Week of\s+/i, '')
}

function formatMinutes(value: number): string {
  return `${Math.round(value * 10) / 10}m`
}

function metricValue(
  period: CallActivityPeriodSummary,
  repName: string,
  metric: MetricMode
): number {
  const rep = period.byRep.find((candidate) => candidate.repName === repName)
  if (!rep) return 0
  return metric === 'conversationCalls' ? rep.conversationCalls : rep.totalDurationMin
}

function buildChartData(periods: CallActivityPeriodSummary[], repNames: string[], metric: MetricMode) {
  return periods.map((period) => {
    const row: Record<string, string | number> = {
      periodStart: period.periodStart,
      label: axisLabel(period),
    }

    for (const repName of repNames) {
      row[repName] = metricValue(period, repName, metric)
    }

    return row
  })
}

function CustomTooltip({
  active,
  payload,
  label,
  metric,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string }>
  label?: string
  metric: MetricMode
}) {
  if (!active || !payload || payload.length === 0) return null

  const visibleRows = payload.filter((entry) => Number(entry.value ?? 0) > 0)
  if (visibleRows.length === 0) return null

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-2 font-semibold text-card-foreground">{label}</p>
      <div className="space-y-1">
        {visibleRows.map((entry) => (
          <p key={entry.name} className="flex items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span>{entry.name}</span>
            <span className="font-semibold text-card-foreground">
              {metric === 'totalDurationMin' ? formatMinutes(Number(entry.value ?? 0)) : Number(entry.value ?? 0)}
            </span>
          </p>
        ))}
      </div>
    </div>
  )
}

function RepPeriodChart({
  title,
  description,
  metric,
  summary,
  reps,
}: {
  title: string
  description: string
  metric: MetricMode
  summary: CallActivitySummary | null
  reps: RepColor[]
}) {
  const [periodMode, setPeriodMode] = useState<PeriodMode>('daily')
  const periods = useMemo(
    () => summary?.[periodMode] ?? [],
    [periodMode, summary]
  )
  const colorByRep = new Map(reps.map((rep) => [rep.name, rep.color]))
  const icon = metric === 'conversationCalls'
    ? <MessageSquare className="h-4 w-4 text-medship-primary" />
    : <Timer className="h-4 w-4 text-medship-info" />

  const repNames = useMemo(() => {
    const totals = new Map<string, number>()

    for (const period of periods) {
      for (const rep of period.byRep) {
        const value = metric === 'conversationCalls' ? rep.conversationCalls : rep.totalDurationMin
        totals.set(rep.repName, (totals.get(rep.repName) ?? 0) + value)
      }
    }

    return Array.from(totals.entries())
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([repName]) => repName)
  }, [metric, periods])

  const chartData = useMemo(
    () => buildChartData(periods, repNames, metric),
    [metric, periods, repNames]
  )
  const hasData = repNames.length > 0

  return (
    <Card className="h-full">
      <CardHeader className="gap-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2.5">
              <span className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-md',
                metric === 'conversationCalls' ? 'bg-medship-primary/10' : 'bg-medship-info/10'
              )}>
                {icon}
              </span>
              {title}
              {!hasData && <ComingSoonBadge />}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {description} - {periodSubtitle(periodMode)}
            </p>
          </div>
          <div className="flex rounded-md border border-border bg-background p-0.5">
            {(['daily', 'weekly', 'monthly'] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                variant={periodMode === mode ? 'default' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPeriodMode(mode)}
              >
                {periodLabels[mode]}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <ComingSoonPanel
            title={title}
            description="Live Salesforce RingDNA call activity has not synced for this period yet."
            className="h-[320px]"
          />
        ) : (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 10, left: -10, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={metric !== 'conversationCalls'}
                  tickFormatter={(value) => metric === 'totalDurationMin' ? `${value}m` : `${value}`}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip metric={metric} />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '0.7rem', paddingTop: '8px' }}
                />
                {repNames.map((repName, index) => (
                  <Bar
                    key={repName}
                    dataKey={repName}
                    stackId={metric}
                    fill={colorByRep.get(repName) ?? fallbackPalette[index % fallbackPalette.length]}
                    radius={index === repNames.length - 1 ? [3, 3, 0, 0] : undefined}
                    maxBarSize={52}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function RingDnaRepActivityCharts({ summary, reps }: RingDnaRepActivityChartsProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <RepPeriodChart
        title="Number of Conversations by Rep"
        description="RingDNA calls with at least 2 minutes of duration"
        metric="conversationCalls"
        summary={summary}
        reps={reps}
      />
      <RepPeriodChart
        title="Total Talk Time by Rep"
        description="Total RingDNA call duration by sales rep"
        metric="totalDurationMin"
        summary={summary}
        reps={reps}
      />
    </div>
  )
}
