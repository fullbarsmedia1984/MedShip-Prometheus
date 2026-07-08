'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { TerritoryQoQPayload } from '@/lib/data'

const CURRENT_COLOR = '#1E98D5'
const PRIOR_COLOR = '#B5C8CD'

const TERRITORY_COLORS: Record<string, string> = {
  northeast: '#1E98D5',
  west: '#0FA62C',
  south: '#A0007E',
  mid_atlantic: '#E89C0C',
  central: '#94A3B8', // unassigned — deliberately gray
}

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

function CompanyTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number | null; payload?: { isPartial?: boolean } }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const byKey = new Map(payload.map((entry) => [entry.dataKey, entry.value]))
  const current = byKey.get('current')
  const prior = byKey.get('prior')
  const isPartial = payload[0]?.payload?.isPartial
  const change = typeof current === 'number' && typeof prior === 'number' && prior > 0
    ? ((current - prior) / prior) * 100
    : null

  return (
    <div className="rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-1 text-[0.813rem] font-medium text-[#1C3C6E]">
        {label}{isPartial ? ' (QTD vs same point last year)' : ''}
      </p>
      <p className="text-[0.813rem] text-[#576671]">
        This year: <span className="font-semibold text-[#1E98D5]">{typeof current === 'number' ? formatCurrency(current) : '—'}</span>
      </p>
      <p className="text-[0.813rem] text-[#576671]">
        Prior year: <span className="font-semibold text-[#576671]">{typeof prior === 'number' ? formatCurrency(prior) : '—'}</span>
      </p>
      {change !== null && (
        <p className={`text-[0.813rem] font-semibold ${change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs prior-year quarter
        </p>
      )}
    </div>
  )
}

type TerritoryRow = Record<string, string | number | boolean | null>

function TerritoryTooltip({ active, payload, label, names }: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number | null; color?: string; payload?: TerritoryRow }>
  label?: string
  names: Map<string, string>
}) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0]?.payload
  return (
    <div className="rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-1 text-[0.813rem] font-medium text-[#1C3C6E]">
        {label}{row?.isPartial ? ' (QTD vs same point last year)' : ''}
      </p>
      {payload.map((entry) => {
        const key = String(entry.dataKey ?? '')
        const current = row?.[`${key}_current`]
        const prior = row?.[`${key}_prior`]
        return (
          <p key={key} className="text-[0.813rem] text-[#576671]">
            <span className="font-medium" style={{ color: entry.color }}>{names.get(key) ?? key}</span>:{' '}
            <span className={`font-semibold ${typeof entry.value === 'number' && entry.value < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
              {typeof entry.value === 'number' ? `${entry.value >= 0 ? '+' : ''}${entry.value.toFixed(1)}%` : 'n/a'}
            </span>
            {typeof current === 'number' && typeof prior === 'number' && (
              <span className="text-xs"> ({formatCurrency(current)} vs {formatCurrency(prior)})</span>
            )}
          </p>
        )
      })}
    </div>
  )
}

export function TerritoryQoQCharts({ data }: { data: TerritoryQoQPayload }) {
  const axisTick = { fontSize: 12, fill: '#576671', fontFamily: 'Outfit' }

  const companyRows = data.quarters.map((quarter) => ({
    quarter: quarter.isPartial ? `${quarter.quarter} (QTD)` : quarter.quarter,
    isPartial: quarter.isPartial,
    current: quarter.company.current,
    prior: quarter.company.prior,
  }))

  const territoryNames = new Map(
    data.territories.map((territory) => [
      territory.key,
      territory.repName ? `${territory.name} (${territory.repName.split(' ').pop()})` : `${territory.name} (unassigned)`,
    ])
  )
  const territoryRows: TerritoryRow[] = data.quarters.map((quarter) => {
    const row: TerritoryRow = {
      quarter: quarter.isPartial ? `${quarter.quarter} (QTD)` : quarter.quarter,
      isPartial: quarter.isPartial,
    }
    for (const territory of quarter.territories) {
      row[territory.key] = territory.growthPct
      row[`${territory.key}_current`] = territory.current
      row[`${territory.key}_prior`] = territory.prior
    }
    return row
  })

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Quarterly Revenue vs Prior Year
            <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700">
              Company-wide · Fishbowl SO revenue
            </Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Each quarter against the same quarter last year. The current quarter compares
            quarter-to-date with the prior year through the same day.
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={companyRows} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D6DEE3" />
              <XAxis dataKey="quarter" tick={axisTick} axisLine={{ stroke: '#D6DEE3' }} tickLine={false} />
              <YAxis tickFormatter={formatYAxis} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip content={<CompanyTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'Outfit' }} />
              <Bar dataKey="prior" name="Prior year" fill={PRIOR_COLOR} radius={[3, 3, 0, 0]} />
              <Bar dataKey="current" name="This year" fill={CURRENT_COLOR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            YoY Growth by Territory
            <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700">
              By ship-to state
            </Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Revenue is attributed to the territory of the order&apos;s ship-to state, regardless of
            selling rep. Hover for dollar figures.
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={territoryRows} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D6DEE3" />
              <XAxis dataKey="quarter" tick={axisTick} axisLine={{ stroke: '#D6DEE3' }} tickLine={false} />
              <YAxis tickFormatter={(value: number) => `${value}%`} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip content={<TerritoryTooltip names={territoryNames} />} />
              <Legend
                wrapperStyle={{ fontSize: 12, fontFamily: 'Outfit' }}
                formatter={(value: string) => territoryNames.get(value) ?? value}
              />
              <ReferenceLine y={0} stroke="#576671" strokeWidth={1} />
              {data.territories.map((territory) => (
                <Bar
                  key={territory.key}
                  dataKey={territory.key}
                  fill={TERRITORY_COLORS[territory.key] ?? '#94A3B8'}
                  radius={[3, 3, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
