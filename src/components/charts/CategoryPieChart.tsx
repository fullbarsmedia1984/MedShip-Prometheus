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

const COLORS = ['#1E98D5', '#0FA62C', '#1C3C6E', '#A0007E', '#E89C0C', '#B5C8CD']

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
    <div className="rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="mb-1 text-[0.813rem] font-medium text-[#1C3C6E]">{entry.category}</p>
      <p className="text-[0.813rem] text-[#576671]">
        Revenue: <span className="font-semibold text-[#1E98D5]">{formatCurrency(entry.revenue)}</span>
      </p>
      <p className="text-[0.813rem] text-[#576671]">
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
      fill="#1C3C6E"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight={500}
      fontFamily="Outfit"
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
                <span style={{ fontSize: '0.75rem', color: '#576671', fontFamily: 'Outfit' }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
