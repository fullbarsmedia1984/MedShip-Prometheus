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
    <div className="rounded-[0.625rem] border border-[#E6E6E6] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-1 text-[0.813rem] font-medium text-[#374557]">{label}</p>
      <p className="text-[0.813rem] text-[#888]">
        Revenue: <span className="font-semibold text-[#452B90]">{formatCurrency(revenue)}</span>
      </p>
      <p className="text-[0.813rem] text-[#888]">
        Orders: <span className="font-semibold text-[#3A9B94]">{orderCount}</span>
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
                <stop offset="0%" stopColor="#452B90" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#452B90" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E6E6E6" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 12, fill: '#888888', fontFamily: 'Poppins' }}
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
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#452B90"
              strokeWidth={2.5}
              fill="url(#revenueGradient)"
              dot={false}
              activeDot={{ r: 5, fill: '#452B90', stroke: '#fff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
