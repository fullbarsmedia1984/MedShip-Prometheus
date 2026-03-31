'use client'

import { cn } from '@/lib/utils'
import { PhoneCall, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { SeedSalesRep } from '@/lib/seed-data'

interface ProfileCallLeaderboardProps {
  reps: SeedSalesRep[]
  metrics: {
    byRep: Array<{
      repName: string
      calls: number
      converted: number
      conversionRate: number
      avgDuration: number
    }>
  }
}

const prospectingGrade = (calls: number, conversionRate: number) => {
  const score = calls * 0.4 + conversionRate * 0.6
  if (score >= 18) return { label: 'Elite', style: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20' }
  if (score >= 10) return { label: 'Strong', style: 'bg-blue-500/15 text-blue-600 border-blue-500/20' }
  if (score >= 5) return { label: 'Building', style: 'bg-amber-500/15 text-amber-600 border-amber-500/20' }
  return { label: 'Needs Focus', style: 'bg-red-500/15 text-red-600 border-red-500/20' }
}

export function ProfileCallLeaderboard({ reps, metrics }: ProfileCallLeaderboardProps) {
  // Merge rep data with per-rep metrics
  const merged = reps.map((rep) => {
    const repMetrics = metrics.byRep.find((m) => m.repName === rep.name)
    return {
      ...rep,
      converted: repMetrics?.converted ?? 0,
      conversionRate: repMetrics?.conversionRate ?? 0,
      avgDuration: repMetrics?.avgDuration ?? 0,
    }
  }).sort((a, b) => b.profileCalls - a.profileCalls)

  const topCalls = merged[0]?.profileCalls || 1

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/50 bg-gradient-to-r from-medship-secondary/[0.04] to-transparent">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-secondary/15">
              <PhoneCall className="h-4 w-4 text-medship-secondary" />
            </span>
            Profile Call Leaderboard &mdash; March 2026
          </CardTitle>
          <span className="hidden text-[0.7rem] text-muted-foreground sm:inline">
            Discovery &amp; prospecting calls with new clients
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead>Sales Rep</TableHead>
              <TableHead className="text-center">Calls (MTD)</TableHead>
              <TableHead className="hidden w-[180px] lg:table-cell">Activity</TableHead>
              <TableHead className="hidden text-center md:table-cell">Trend</TableHead>
              <TableHead className="hidden text-center md:table-cell">Converted</TableHead>
              <TableHead className="text-center">Conv. Rate</TableHead>
              <TableHead className="hidden text-center lg:table-cell">Avg Duration</TableHead>
              <TableHead className="text-center">Grade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {merged.map((rep, i) => {
              const rank = i + 1
              const barPct = (rep.profileCalls / topCalls) * 100
              const grade = prospectingGrade(rep.profileCalls, rep.conversionRate)
              const convColor = rep.conversionRate >= 30 ? 'text-emerald-600' : rep.conversionRate >= 15 ? 'text-amber-600' : 'text-red-500'

              return (
                <TableRow
                  key={rep.id}
                  className={cn(
                    'transition-colors',
                    rank === 1 && 'bg-medship-secondary/[0.04]'
                  )}
                >
                  <TableCell className="text-center">
                    {rank <= 3 ? (
                      <span className="text-lg">{rank === 1 ? '\u{1F947}' : rank === 2 ? '\u{1F948}' : '\u{1F949}'}</span>
                    ) : (
                      <span className="text-sm font-semibold text-muted-foreground">#{rank}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold text-white"
                        style={{ backgroundColor: rep.color }}
                      >
                        {rep.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="font-semibold leading-tight text-card-foreground">{rep.name}</p>
                        <p className="text-[0.7rem] text-muted-foreground">{rep.region}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-lg font-bold tabular-nums text-card-foreground">
                    {rep.profileCalls}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${barPct}%`,
                          background: `linear-gradient(90deg, ${rep.color}99, ${rep.color})`,
                        }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-center md:table-cell">
                    {rep.profileCallsChange !== 0 && (
                      <span className={cn(
                        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold',
                        rep.profileCallsChange > 0
                          ? 'bg-emerald-500/10 text-emerald-600'
                          : 'bg-red-500/10 text-red-500'
                      )}>
                        {rep.profileCallsChange > 0 ? (
                          <ArrowUpRight className="h-3 w-3" />
                        ) : (
                          <ArrowDownRight className="h-3 w-3" />
                        )}
                        {Math.abs(rep.profileCallsChange)}%
                      </span>
                    )}
                    {rep.profileCallsChange === 0 && (
                      <span className="text-[0.7rem] text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-center font-medium md:table-cell">
                    <span className="tabular-nums">{rep.converted}</span>
                    <span className="text-muted-foreground"> / {rep.profileCalls}</span>
                  </TableCell>
                  <TableCell className={cn('text-center font-semibold tabular-nums', convColor)}>
                    {rep.conversionRate.toFixed(1)}%
                  </TableCell>
                  <TableCell className="hidden text-center tabular-nums lg:table-cell">
                    {rep.avgDuration > 0 ? `${rep.avgDuration}m` : '\u2014'}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={cn(
                      'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide',
                      grade.style
                    )}>
                      {grade.label}
                    </span>
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
