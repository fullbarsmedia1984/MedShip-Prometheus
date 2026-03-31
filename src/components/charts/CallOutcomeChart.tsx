'use client'

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

interface OutcomeData {
  outcome: string
  count: number
  percentage: number
  color: string
}

interface CallOutcomeChartProps {
  data: OutcomeData[]
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload as OutcomeData
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-card-foreground">{d.outcome}</p>
      <p className="text-muted-foreground">
        {d.count} profile calls ({d.percentage}%)
      </p>
    </div>
  )
}

export function CallOutcomeChart({ data }: CallOutcomeChartProps) {
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-success/10">
            <svg className="h-4 w-4 text-medship-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </span>
          Profile Call Outcomes
        </CardTitle>
        <p className="text-xs text-muted-foreground">Distribution this month — {total} total profile calls</p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div className="h-[220px] w-[220px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="count"
                  nameKey="outcome"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            {data.map((d) => (
              <div key={d.outcome} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: d.color }}
                />
                <span className="flex-1 truncate text-[0.7rem] text-muted-foreground">{d.outcome}</span>
                <span className="text-[0.7rem] font-semibold tabular-nums text-card-foreground">{d.count}</span>
                <span className="w-10 text-right text-[0.65rem] tabular-nums text-muted-foreground">{d.percentage}%</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
