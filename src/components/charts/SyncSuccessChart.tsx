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
    <div className="rounded-lg bg-white px-4 py-3 shadow-lg ring-1 ring-black/5">
      <p className="mb-1 text-sm font-medium text-gray-900">{label}</p>
      <p className="text-sm text-gray-600">
        Success: <span className="font-semibold text-[#3A9B94]">{success}</span>
      </p>
      <p className="text-sm text-gray-600">
        Failed: <span className="font-semibold text-[#FF5E5E]">{failed}</span>
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
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: '#6b7280' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="circle"
              iconSize={8}
              formatter={(value: string) => (
                <span className="text-xs text-gray-600 capitalize">{value}</span>
              )}
            />
            <Bar
              dataKey="success"
              stackId="sync"
              fill="#3A9B94"
              radius={[0, 0, 0, 0]}
              name="Success"
            />
            <Bar
              dataKey="failed"
              stackId="sync"
              fill="#FF5E5E"
              radius={[4, 4, 0, 0]}
              name="Failed"
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
