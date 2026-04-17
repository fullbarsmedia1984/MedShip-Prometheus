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
import type { SeedPipelineByRep } from '@/lib/seed-data'

interface PipelineByRepChartProps {
  data: SeedPipelineByRep[]
}

const stageColors: Record<string, string> = {
  Prospecting: '#B5C8CD',
  Qualification: '#1E98D5',
  Proposal: '#1C3C6E',
  Negotiation: '#0FA62C',
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

  const total = payload.reduce((sum, p) => sum + (p.value || 0), 0)

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
      <p className="mt-1 border-t border-[#D6DEE3] pt-1 text-[0.75rem] font-semibold text-[#1C3C6E]">
        Total: ${total.toLocaleString()}
      </p>
    </div>
  )
}

export function PipelineByRepChart({ data }: PipelineByRepChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline by Rep</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#D6DEE3" />
            <XAxis
              dataKey="repName"
              tick={{ fontSize: 11, fill: '#576671', fontFamily: 'Outfit' }}
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
            {Object.entries(stageColors).map(([stage, color]) => (
              <Bar
                key={stage}
                dataKey={stage}
                fill={color}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
