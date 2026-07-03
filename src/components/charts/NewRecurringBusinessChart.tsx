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
import { ComingSoonBadge, ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import type { MonthlyBusinessRevenue } from '@/lib/data'

interface NewRecurringBusinessChartProps {
  data: MonthlyBusinessRevenue[]
}

const series = [
  { key: 'newBusinessRevenue', name: 'New Business', color: '#0FA62C' },
  { key: 'recurringBusinessRevenue', name: 'Recurring', color: '#1E98D5' },
] as const

function formatYAxis(value: number): string {
  return `$${Math.round(value / 1000)}k`
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: MonthlyBusinessRevenue }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  const total = payload.reduce((sum, entry) => sum + (entry.value || 0), 0)
  const row = payload[0]?.payload

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
      {row && (
        <p className="mt-1 border-t border-[#D6DEE3] pt-1 text-[0.75rem] text-[#576671]">
          {row.newBusinessOrders} new SOs / {row.recurringBusinessOrders} recurring SOs
        </p>
      )}
      <p className="mt-1 text-[0.75rem] font-semibold text-[#1C3C6E]">
        Total: ${total.toLocaleString()}
      </p>
    </div>
  )
}

export function NewRecurringBusinessChart({ data }: NewRecurringBusinessChartProps) {
  const hasRevenue = data.some((row) => row.newBusinessRevenue > 0 || row.recurringBusinessRevenue > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Monthly New vs Recurring Revenue
          {!hasRevenue && <ComingSoonBadge />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasRevenue ? (
          <ComingSoonPanel
            title="New vs recurring revenue"
            description="Fishbowl issued Sales Orders need New/Recurring classification before this chart can populate."
            className="h-[350px]"
          />
        ) : (
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
              {series.map((item, index) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.name}
                  stackId="businessType"
                  fill={item.color}
                  radius={index === series.length - 1 ? [3, 3, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
