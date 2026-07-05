'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  GATE_FEASIBILITY_BAND,
  monthlyRequirementToWeeklyPace,
} from '@/lib/incentive/calculator'

interface GateFeasibilityChartProps {
  data: Array<{ weekStart: string; enrollments: number }>
}

function formatWeekLabel(weekStart: string): string {
  const date = new Date(weekStart + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * The chart that tells the CEO at day 30 whether the 2-per-rep gate needs
 * tuning: weekly company-wide first-ever enrollments vs the roster
 * requirement (8/month) and the historical 5-26/month organic band.
 */
export function GateFeasibilityChart({ data }: GateFeasibilityChartProps) {
  const chartData = data.map((week) => ({ ...week, label: formatWeekLabel(week.weekStart) }))
  const requiredWeekly = monthlyRequirementToWeeklyPace(GATE_FEASIBILITY_BAND.rosterRequirementPerMonth)
  const bandLow = monthlyRequirementToWeeklyPace(GATE_FEASIBILITY_BAND.historicalLow)
  const bandHigh = monthlyRequirementToWeeklyPace(GATE_FEASIBILITY_BAND.historicalHigh)

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-info/10">
            <TrendingUp className="h-4 w-4 text-medship-info" />
          </span>
          Gate Feasibility — New Enrollments per Week
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Company-wide first-ever-order customers per week. Shaded band = historical 5–26/month organic pace;
          dashed line = pace required for every rep to clear the gate (8/month).
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                }}
                labelStyle={{ fontWeight: 600, marginBottom: 4 }}
              />
              <ReferenceArea y1={bandLow} y2={bandHigh} fill="var(--medship-info, #38bdf8)" fillOpacity={0.08} />
              <ReferenceLine
                y={requiredWeekly}
                stroke="#ef4444"
                strokeDasharray="6 4"
                label={{ value: 'Roster requirement', fontSize: 10, fill: '#ef4444', position: 'insideTopRight' }}
              />
              <Bar dataKey="enrollments" fill="#0ea5e9" radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
