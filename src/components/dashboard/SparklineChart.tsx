'use client'

import { BarChart, Bar, ResponsiveContainer } from 'recharts'

interface SparklineChartProps {
  data: { date: string; success: number; failed: number }[]
  height?: number
  width?: number
}

export function SparklineChart({
  data,
  height = 40,
  width = 120,
}: SparklineChartProps) {
  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Bar
            dataKey="success"
            stackId="a"
            fill="var(--color-medship-success)"
            radius={0}
            isAnimationActive={false}
          />
          <Bar
            dataKey="failed"
            stackId="a"
            fill="var(--color-medship-danger)"
            radius={[1, 1, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
