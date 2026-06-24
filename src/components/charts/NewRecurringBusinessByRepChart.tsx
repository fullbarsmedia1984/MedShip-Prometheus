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
import type { MonthlyBusinessRevenueByRep } from '@/lib/data'

interface NewRecurringBusinessByRepChartProps {
  data: MonthlyBusinessRevenueByRep[]
}

const repPalette = ['#1C3C6E', '#1E98D5', '#0FA62C', '#A0007E', '#E89C0C', '#D93025', '#B5C8CD', '#3AACE3']
const newBusinessColor = '#0FA62C'
const recurringColor = '#1E98D5'

function formatYAxis(value: number): string {
  return `$${Math.round(value / 1000)}k`
}

function repFromKey(key: string): string {
  return key.replace(/ - (New|Recurring)$/, '')
}

function businessTypeFromKey(key: string): 'New' | 'Recurring' {
  return key.endsWith(' - New') ? 'New' : 'Recurring'
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ dataKey?: string; name?: string; value?: number; color?: string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  const rows = payload
    .filter((entry) => (entry.value || 0) > 0 && typeof entry.dataKey === 'string')
    .map((entry) => ({
      rep: repFromKey(entry.dataKey as string),
      type: businessTypeFromKey(entry.dataKey as string),
      value: entry.value || 0,
      color: entry.color,
    }))
  const total = rows.reduce((sum, row) => sum + row.value, 0)

  if (rows.length === 0) return null

  return (
    <div className="max-w-[18rem] rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-2 text-[0.813rem] font-medium text-[#1C3C6E]">{label}</p>
      {rows.map((entry) => (
        <p key={`${entry.rep}-${entry.type}`} className="flex items-center gap-2 text-[0.75rem] text-[#576671]">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
          <span className="truncate">{entry.rep} {entry.type}:</span>
          <span className="ml-auto font-semibold" style={{ color: entry.color }}>
            ${entry.value.toLocaleString()}
          </span>
        </p>
      ))}
      <p className="mt-1 border-t border-[#D6DEE3] pt-1 text-[0.75rem] font-semibold text-[#1C3C6E]">
        Total: ${total.toLocaleString()}
      </p>
    </div>
  )
}

export function NewRecurringBusinessByRepChart({ data }: NewRecurringBusinessByRepChartProps) {
  const keys = Array.from(
    new Set(data.flatMap((row) => Object.keys(row).filter((key) => key !== 'month')))
  )
  const repNames = Array.from(new Set(keys.map(repFromKey))).slice(0, 8)
  const hasRevenue = data.some((row) =>
    Object.entries(row).some(([key, value]) => key !== 'month' && Number(value) > 0)
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Monthly New vs Recurring Revenue by Rep
          {!hasRevenue && <ComingSoonBadge />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasRevenue ? (
          <ComingSoonPanel
            title="New vs recurring by rep"
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
              {repNames.flatMap((repName, index) => {
                const repColor = repPalette[index % repPalette.length]
                return [
                  <Bar
                    key={`${repName} - New`}
                    dataKey={`${repName} - New`}
                    name={`${repName} New`}
                    stackId={repName}
                    fill={newBusinessColor}
                  />,
                  <Bar
                    key={`${repName} - Recurring`}
                    dataKey={`${repName} - Recurring`}
                    name={`${repName} Recurring`}
                    stackId={repName}
                    fill={recurringColor}
                    stroke={repColor}
                    strokeWidth={1}
                    radius={[3, 3, 0, 0]}
                  />,
                ]
              })}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
