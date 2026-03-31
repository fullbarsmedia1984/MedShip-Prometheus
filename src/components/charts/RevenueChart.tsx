'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card'

interface RevenueChartProps {
  data: { month: string; revenue: number; orderCount: number }[]
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
  return `$${Math.round(value / 1000)}k`
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value?: number; payload?: { orderCount?: number } }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  const revenue = payload[0]?.value ?? 0
  const orderCount = payload[0]?.payload?.orderCount ?? 0

  return (
    <div className="rounded-lg bg-white px-4 py-3 shadow-lg ring-1 ring-black/5">
      <p className="mb-1 text-sm font-medium text-gray-900">{label}</p>
      <p className="text-sm text-gray-600">
        Revenue: <span className="font-semibold">{formatCurrency(revenue)}</span>
      </p>
      <p className="text-sm text-gray-600">
        Orders: <span className="font-semibold">{orderCount}</span>
      </p>
    </div>
  )
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#452B90" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#452B90" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 12, fill: '#6b7280' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatYAxis}
              tick={{ fontSize: 12, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#452B90"
              strokeWidth={2}
              fill="url(#revenueGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
