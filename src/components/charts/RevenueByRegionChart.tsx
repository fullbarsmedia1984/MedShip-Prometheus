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
  Midwest: '#452B90',
  Northeast: '#3A9B94',
  Southeast: '#F8B940',
  West: '#58BAD7',
  Southwest: '#FF9F00',
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
    <div className="rounded-[0.625rem] border border-[#E6E6E6] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-1 text-[0.813rem] font-medium text-[#374557]">{data.region}</p>
      <p className="text-[0.75rem] text-[#888]">
        Revenue: <span className="font-semibold text-[#452B90]">${(data.totalRevenue || 0).toLocaleString()}</span>
      </p>
      <p className="text-[0.75rem] text-[#888]">
        Clients: <span className="font-semibold text-[#374557]">{data.customerCount}</span>
      </p>
      <p className="text-[0.75rem] text-[#888]">
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
            <CartesianGrid strokeDasharray="3 3" stroke="#E6E6E6" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={formatYAxis}
              tick={{ fontSize: 12, fill: '#888888', fontFamily: 'Poppins' }}
              axisLine={{ stroke: '#E6E6E6' }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="region"
              tick={{ fontSize: 12, fill: '#888888', fontFamily: 'Poppins' }}
              axisLine={false}
              tickLine={false}
              width={80}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(69,43,144,0.04)' }} />
            <Bar dataKey="totalRevenue" radius={[0, 4, 4, 0]} barSize={28}>
              {sorted.map((entry) => (
                <Cell key={entry.region} fill={regionColors[entry.region] || '#452B90'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
