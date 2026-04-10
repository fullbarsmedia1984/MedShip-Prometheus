'use client'

import { cn } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Phone } from 'lucide-react'
import { ConnectRateBadge } from '@/components/dashboard/ConnectRateBadge'
import type { SeedSalesRep } from '@/lib/seed-data'
import type { ProfileCallMetricsResult } from '@/lib/data'

interface ProfileCallLeaderboardProps {
  reps: SeedSalesRep[]
  metrics: ProfileCallMetricsResult
}

export function ProfileCallLeaderboard({ reps, metrics }: ProfileCallLeaderboardProps) {
  const repColorMap = new Map(reps.map((r) => [r.name, r.color]))

  const sorted = [...metrics.byRep].sort((a, b) => b.calls - a.calls)
  const topCalls = sorted[0]?.calls || 1

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/50 bg-gradient-to-r from-medship-success/[0.03] to-transparent">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-success/10">
              <Phone className="h-4 w-4 text-medship-success" />
            </span>
            Profile Call Leaderboard &mdash; March 2026
          </CardTitle>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right">
              <p className="font-semibold text-card-foreground">{metrics.totalMTD}</p>
              <p className="text-[0.65rem] text-muted-foreground">Total MTD</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-card-foreground">{metrics.connectRate}%</p>
              <p className="text-[0.65rem] text-muted-foreground">Connect Rate</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-card-foreground">{metrics.conversionRate}%</p>
              <p className="text-[0.65rem] text-muted-foreground">Conversion</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-card-foreground">{metrics.avgDuration}m</p>
              <p className="text-[0.65rem] text-muted-foreground">Avg Duration</p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16 text-center">Rank</TableHead>
              <TableHead>Sales Rep</TableHead>
              <TableHead className="text-center">Profile Calls</TableHead>
              <TableHead className="hidden w-[200px] md:table-cell">Volume</TableHead>
              <TableHead className="text-center">Connect Rate</TableHead>
              <TableHead className="text-center">Converted</TableHead>
              <TableHead className="text-center">Conversion Rate</TableHead>
              <TableHead className="hidden text-center lg:table-cell">Avg Duration</TableHead>
              <TableHead className="hidden text-center lg:table-cell">Avg Rating</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((repMetric, i) => {
              const rank = i + 1
              const repColor = repColorMap.get(repMetric.repName) || '#888'
              const barPct = (repMetric.calls / topCalls) * 100
              const convColor = repMetric.conversionRate >= 35
                ? 'text-emerald-600'
                : repMetric.conversionRate >= 20
                  ? 'text-amber-600'
                  : 'text-red-500'

              return (
                <TableRow
                  key={repMetric.repName}
                  className={cn(
                    'transition-colors',
                    rank === 1 && 'bg-emerald-50/30 dark:bg-emerald-950/10'
                  )}
                >
                  <TableCell className="text-center">
                    {rank === 1 ? <span className="text-lg">&#x1F947;</span>
                      : rank === 2 ? <span className="text-lg">&#x1F948;</span>
                      : rank === 3 ? <span className="text-lg">&#x1F949;</span>
                      : <span className="text-sm font-semibold text-muted-foreground">#{rank}</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold text-white"
                        style={{ backgroundColor: repColor }}
                      >
                        {repMetric.repName.split(' ').map((n) => n[0]).join('')}
                      </div>
                      <p className="font-semibold leading-tight text-card-foreground">{repMetric.repName}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-lg font-bold tabular-nums text-card-foreground">
                    {repMetric.calls}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${barPct}%`,
                          background: `linear-gradient(90deg, ${repColor}CC, ${repColor})`,
                        }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <ConnectRateBadge rate={repMetric.connectRate} />
                  </TableCell>
                  <TableCell className="text-center font-medium tabular-nums">{repMetric.converted}</TableCell>
                  <TableCell className={cn('text-center font-semibold tabular-nums', convColor)}>
                    {repMetric.conversionRate}%
                  </TableCell>
                  <TableCell className="hidden text-center tabular-nums text-muted-foreground lg:table-cell">
                    {repMetric.avgDuration}m
                  </TableCell>
                  <TableCell className="hidden text-center tabular-nums text-muted-foreground lg:table-cell">
                    {repMetric.avgRating !== null ? repMetric.avgRating.toFixed(1) : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
