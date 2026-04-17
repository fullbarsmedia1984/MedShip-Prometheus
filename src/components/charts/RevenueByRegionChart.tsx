'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { SeedRegionSummary } from '@/lib/seed-data'

interface RevenueByRegionChartProps {
  data: SeedRegionSummary[]
}

const regionColors: Record<string, string> = {
  Midwest: '#1E98D5',
  Northeast: '#0FA62C',
  Southeast: '#1C3C6E',
  West: '#A0007E',
  Southwest: '#E89C0C',
}

function formatYAxis(value: number): string {
  return `$${Math.round(value / 1000)}k`
}

function CustomTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload?: { region?: string; totalRevenue?: number; customerCount?: number; growth?: number } }>
}) {
  if (!active || !payload || payload.length === 0) return null
  const data = payload[0]?.payload
  if (!data) return null

  return (
    <div className="rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-1 text-[0.813rem] font-medium text-[#1C3C6E]">{data.region}</p>
      <p className="text-[0.75rem] text-[#576671]">
        Revenue: <span className="font-semibold text-[#1E98D5]">${(data.totalRevenue || 0).toLocaleString()}</span>
      </p>
      <p className="text-[0.75rem] text-[#576671]">
        Clients: <span className="font-semibold text-[#1C3C6E]">{data.customerCount}</span>
      </p>
      <p className="text-[0.75rem] text-[#576671]">
        Growth: <span className={`font-semibold ${(data.growth || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {(data.growth || 0) >= 0 ? '+' : ''}{data.growth}%
        </span>
      </p>
    </div>
  )
}

export function RevenueByRegionChart({ data }: RevenueByRegionChartProps) {
  const sorted = [...data].sort((a, b) => b.totalRevenue - a.totalRevenue)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue by Region</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={sorted} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#D6DEE3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={formatYAxis}
              tick={{ fontSize: 12, fill: '#576671', fontFamily: 'Outfit' }}
              axisLine={{ stroke: '#D6DEE3' }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="region"
              tick={{ fontSize: 12, fill: '#576671', fontFamily: 'Outfit' }}
              axisLine={false}
              tickLine={false}
              width={80}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(30,152,213,0.04)' }} />
            <Bar dataKey="totalRevenue" radius={[0, 4, 4, 0]} barSize={28}>
              {sorted.map((entry) => (
                <Cell key={entry.region} fill={regionColors[entry.region] || '#1E98D5'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
