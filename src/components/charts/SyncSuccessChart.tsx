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
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card'

interface SyncSuccessChartProps {
  data: { date: string; success: number; failed: number }[]
  title?: string
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  const success = payload.find((p) => p.dataKey === 'success')?.value ?? 0
  const failed = payload.find((p) => p.dataKey === 'failed')?.value ?? 0

  return (
    <div className="rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-1 text-[0.813rem] font-medium text-[#1C3C6E]">{label}</p>
      <p className="text-[0.813rem] text-[#576671]">
        Success: <span className="font-semibold text-[#0FA62C]">{success}</span>
      </p>
      <p className="text-[0.813rem] text-[#576671]">
        Failed: <span className="font-semibold text-[#D93025]">{failed}</span>
      </p>
    </div>
  )
}

export function SyncSuccessChart({ data, title = 'Sync Activity' }: SyncSuccessChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#D6DEE3" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: '#576671', fontFamily: 'Outfit' }}
              axisLine={{ stroke: '#D6DEE3' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#576671', fontFamily: 'Outfit' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="circle"
              iconSize={8}
              formatter={(value: string) => (
                <span style={{ fontSize: '0.75rem', color: '#576671', fontFamily: 'Outfit' }}>{value}</span>
              )}
            />
            <Bar
              dataKey="success"
              stackId="sync"
              fill="#0FA62C"
              radius={[0, 0, 0, 0]}
              name="Success"
            />
            <Bar
              dataKey="failed"
              stackId="sync"
              fill="#D93025"
              radius={[4, 4, 0, 0]}
              name="Failed"
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
