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
  Prospecting: '#93C5FD',
  Qualification: '#60A5FA',
  Proposal: '#3B82F6',
  Negotiation: '#2563EB',
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
    <div className="rounded-[0.625rem] border border-[#E6E6E6] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-2 text-[0.813rem] font-medium text-[#374557]">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 text-[0.75rem] text-[#888]">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-semibold" style={{ color: entry.color }}>
            ${(entry.value || 0).toLocaleString()}
          </span>
        </p>
      ))}
      <p className="mt-1 border-t border-[#E6E6E6] pt-1 text-[0.75rem] font-semibold text-[#374557]">
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
            <CartesianGrid strokeDasharray="3 3" stroke="#E6E6E6" />
            <XAxis
              dataKey="repName"
              tick={{ fontSize: 11, fill: '#888888', fontFamily: 'Poppins' }}
              axisLine={{ stroke: '#E6E6E6' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatYAxis}
              tick={{ fontSize: 12, fill: '#888888', fontFamily: 'Poppins' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '0.75rem', fontFamily: 'Poppins' }}
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
