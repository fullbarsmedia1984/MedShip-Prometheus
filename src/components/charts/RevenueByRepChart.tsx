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
} from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { SeedMonthlyRepRevenue } from '@/lib/seed-data'

interface RevenueByRepChartProps {
  data: SeedMonthlyRepRevenue[]
}

const repColors: Record<string, string> = {
  'Sarah Mitchell': '#1E98D5',
  'James Thornton': '#0FA62C',
  'Maria Gonzalez': '#1C3C6E',
  'David Kim': '#A0007E',
  'Lisa Chen': '#E89C0C',
}

function formatYAxis(value: number): string {
  return `$${Math.round(value / 1000)}k`
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-2 text-[0.813rem] font-medium text-[#1C3C6E]">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 text-[0.75rem] text-[#576671]">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-semibold" style={{ color: entry.color }}>
            ${(entry.value || 0).toLocaleString()}
          </span>
        </p>
      ))}
    </div>
  )
}

export function RevenueByRepChart({ data }: RevenueByRepChartProps) {
  const repNames = Object.keys(repColors)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Revenue by Rep</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#D6DEE3" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 12, fill: '#576671', fontFamily: 'Outfit' }}
              axisLine={{ stroke: '#D6DEE3' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatYAxis}
              tick={{ fontSize: 12, fill: '#576671', fontFamily: 'Outfit' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '0.75rem', fontFamily: 'Outfit' }}
            />
            {repNames.map((name) => (
              <Bar
                key={name}
                dataKey={name}
                stackId="revenue"
                fill={repColors[name]}
                radius={name === 'Lisa Chen' ? [3, 3, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
