'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts'

export interface RepDistributionSlice {
  name: string
  value: number
  revenue: number
  color: string
}

function RepDonutTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; payload?: { revenue?: number } }>
}) {
  if (!active || !payload || payload.length === 0) return null
  const entry = payload[0]
  return (
    <div className="rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="text-[0.813rem] font-medium text-[#1C3C6E]">{entry.name}</p>
      <p className="text-[0.75rem] text-[#576671]">
        Clients: <span className="font-semibold text-[#1C3C6E]">{entry.value}</span>
      </p>
      <p className="text-[0.75rem] text-[#576671]">
        Revenue: <span className="font-semibold text-[#1E98D5]">${(entry.payload?.revenue || 0).toLocaleString()}</span>
      </p>
    </div>
  )
}

export function RepDistributionDonut({ data }: { data: RepDistributionSlice[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Client Distribution by Rep</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={3}
              dataKey="value"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<RepDonutTooltip />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '0.75rem', fontFamily: 'Outfit' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
