'use client'

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card'

interface CategoryPieChartProps {
  data: { category: string; revenue: number; percentage: number }[]
}

const COLORS = ['#452B90', '#3A9B94', '#F8B940', '#58BAD7', '#FF9F00', '#FF5E5E']

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function CustomTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload?: { category: string; revenue: number; percentage: number } }>
}) {
  if (!active || !payload || payload.length === 0) return null

  const entry = payload[0]?.payload

  if (!entry) return null

  return (
    <div className="rounded-lg bg-white px-4 py-3 shadow-lg ring-1 ring-black/5">
      <p className="mb-1 text-sm font-medium text-gray-900">{entry.category}</p>
      <p className="text-sm text-gray-600">
        Revenue: <span className="font-semibold">{formatCurrency(entry.revenue)}</span>
      </p>
      <p className="text-sm text-gray-600">
        Share: <span className="font-semibold">{entry.percentage}%</span>
      </p>
    </div>
  )
}

function renderLabel(props: Record<string, unknown>) {
  const cx = props.cx as number
  const cy = props.cy as number
  const midAngle = props.midAngle as number
  const innerRadius = props.innerRadius as number
  const outerRadius = props.outerRadius as number
  const percent = props.percent as number

  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5 + 20
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)

  const pct = Math.round(percent * 100)
  if (pct < 5) return null

  return (
    <text
      x={x}
      y={y}
      fill="#374151"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight={500}
    >
      {`${pct}%`}
    </text>
  )
}

export function CategoryPieChart({ data }: CategoryPieChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales by Category</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="45%"
              innerRadius={60}
              outerRadius={90}
              dataKey="revenue"
              nameKey="category"
              label={renderLabel as unknown as boolean}
              labelLine={false}
            >
              {data.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={8}
              formatter={(value: string) => (
                <span className="text-xs text-gray-600">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
