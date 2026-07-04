'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { YoYRevenueComparison } from '@/lib/data'

const CURRENT_COLOR = '#1E98D5'
const PRIOR_COLOR = '#B5C8CD'

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatYAxis(value: number): string {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1000)}k`
}

function YoYTooltip({ active, payload, label, currentLabel, priorLabel }: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number | null }>
  label?: string
  currentLabel: string
  priorLabel: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const byKey = new Map(payload.map((entry) => [entry.dataKey, entry.value]))
  const current = byKey.get('currentYear') ?? byKey.get('cumulativeCurrent')
  const prior = byKey.get('priorYear') ?? byKey.get('cumulativePrior')
  const change = typeof current === 'number' && typeof prior === 'number' && prior > 0
    ? ((current - prior) / prior) * 100
    : null

  return (
    <div className="rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-1 text-[0.813rem] font-medium text-[#1C3C6E]">{label}</p>
      <p className="text-[0.813rem] text-[#576671]">
        {currentLabel}:{' '}
        <span className="font-semibold text-[#1E98D5]">
          {typeof current === 'number' ? formatCurrency(current) : '—'}
        </span>
      </p>
      <p className="text-[0.813rem] text-[#576671]">
        {priorLabel}:{' '}
        <span className="font-semibold text-[#576671]">
          {typeof prior === 'number' ? formatCurrency(prior) : '—'}
        </span>
      </p>
      {change !== null && (
        <p className={`text-[0.813rem] font-semibold ${change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {change >= 0 ? '+' : ''}{change.toFixed(1)}% YoY
        </p>
      )}
    </div>
  )
}

export function YoYRevenueCharts({ data }: { data: YoYRevenueComparison }) {
  const axisTick = { fontSize: 12, fill: '#576671', fontFamily: 'Outfit' }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Revenue by Month — {data.currentYearLabel} vs {data.priorYearLabel}
            <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700">
              Fishbowl SO revenue
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.months} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D6DEE3" />
              <XAxis dataKey="month" tick={axisTick} axisLine={{ stroke: '#D6DEE3' }} tickLine={false} />
              <YAxis tickFormatter={formatYAxis} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip
                content={<YoYTooltip currentLabel={data.currentYearLabel} priorLabel={data.priorYearLabel} />}
              />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'Outfit' }} />
              <Bar dataKey="priorYear" name={data.priorYearLabel} fill={PRIOR_COLOR} radius={[3, 3, 0, 0]} />
              <Bar dataKey="currentYear" name={data.currentYearLabel} fill={CURRENT_COLOR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Cumulative Revenue — {data.currentYearLabel} vs {data.priorYearLabel}
            {data.yoyChangePct !== null && (
              <Badge
                variant="outline"
                className={
                  data.yoyChangePct >= 0
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                    : 'border-red-500/30 bg-red-500/10 text-red-700'
                }
              >
                {data.yoyChangePct >= 0 ? '+' : ''}{data.yoyChangePct.toFixed(1)}% YTD YoY
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.months} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="yoyCurrentGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CURRENT_COLOR} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={CURRENT_COLOR} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="yoyPriorGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PRIOR_COLOR} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={PRIOR_COLOR} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#D6DEE3" />
              <XAxis dataKey="month" tick={axisTick} axisLine={{ stroke: '#D6DEE3' }} tickLine={false} />
              <YAxis tickFormatter={formatYAxis} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip
                content={<YoYTooltip currentLabel={data.currentYearLabel} priorLabel={data.priorYearLabel} />}
              />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'Outfit' }} />
              <Area
                type="monotone"
                dataKey="cumulativePrior"
                name={data.priorYearLabel}
                stroke={PRIOR_COLOR}
                strokeWidth={2}
                fill="url(#yoyPriorGradient)"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="cumulativeCurrent"
                name={data.currentYearLabel}
                stroke={CURRENT_COLOR}
                strokeWidth={2.5}
                fill="url(#yoyCurrentGradient)"
                dot={false}
                activeDot={{ r: 5, fill: CURRENT_COLOR, stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
