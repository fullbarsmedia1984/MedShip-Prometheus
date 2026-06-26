'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { TamByStateDollarsRow, TamByTierRow } from '@/lib/tam/supabase'

type TierChartRow = {
  tier: string
  programs: number
  totalTam: number
}

type StateChartRow = {
  state: string
  programs: number
  totalTam: number
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === 'number') return value
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function tooltipFormatter(value: unknown, name: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (name === 'totalTam') return [formatCompactCurrency(numeric), 'Allocated TAM']
  if (name === 'programs') return [formatNumber(numeric), 'Programs']
  return [String(value), String(name)]
}

export function TamOverviewCharts({
  byTier,
  byStateDollars,
}: {
  byTier: TamByTierRow[]
  byStateDollars: TamByStateDollarsRow[]
}) {
  const tierData: TierChartRow[] = byTier.map((row) => ({
    tier: row.tier.toUpperCase(),
    programs: toNumber(row.n_programs),
    totalTam: toNumber(row.total_tam),
  }))

  const stateData: StateChartRow[] = [...byStateDollars]
    .map((row) => ({
      state: row.state,
      programs: toNumber(row.n_programs),
      totalTam: toNumber(row.total_tam),
    }))
    .sort((a, b) => b.totalTam - a.totalTam)
    .slice(0, 12)

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>TAM by Program Tier</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={tierData} margin={{ top: 8, right: 18, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D6DEE3" />
              <XAxis dataKey="tier" tick={{ fontSize: 12, fill: '#576671' }} tickLine={false} />
              <YAxis
                tickFormatter={formatCompactCurrency}
                tick={{ fontSize: 12, fill: '#576671' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip formatter={tooltipFormatter} />
              <Bar dataKey="totalTam" fill="#1E98D5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top States by Allocated TAM</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={stateData}
              layout="vertical"
              margin={{ top: 8, right: 22, left: 12, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#D6DEE3" />
              <XAxis
                type="number"
                tickFormatter={formatCompactCurrency}
                tick={{ fontSize: 12, fill: '#576671' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                dataKey="state"
                type="category"
                width={36}
                tick={{ fontSize: 12, fill: '#576671' }}
                tickLine={false}
              />
              <Tooltip formatter={tooltipFormatter} />
              <Bar dataKey="totalTam" fill="#0FA62C" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
