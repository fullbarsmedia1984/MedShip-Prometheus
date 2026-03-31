'use client'

import { cn } from '@/lib/utils'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
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

interface SalesLeaderboardProps {
  reps: SeedSalesRep[]
}

const rankDisplay = (rank: number) => {
  if (rank === 1) return <span className="text-lg">&#x1F947;</span>
  if (rank === 2) return <span className="text-lg">&#x1F948;</span>
  if (rank === 3) return <span className="text-lg">&#x1F949;</span>
  return <span className="text-sm font-semibold text-muted-foreground">#{rank}</span>
}

const activityBadge = (score: SeedSalesRep['activityScore']) => {
  const styles = {
    hot: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20',
    active: 'bg-blue-500/15 text-blue-600 border-blue-500/20',
    slow: 'bg-amber-500/15 text-amber-600 border-amber-500/20',
    cold: 'bg-red-500/15 text-red-600 border-red-500/20',
  }
  const labels = { hot: 'Hot', active: 'Active', slow: 'Slow', cold: 'Cold' }
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide', styles[score])}>
      {labels[score]}
    </span>
  )
}

export function SalesLeaderboard({ reps }: SalesLeaderboardProps) {
  const sorted = [...reps].sort((a, b) => b.revenueMTD - a.revenueMTD)
  const topRevenue = sorted[0]?.revenueMTD || 1

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/50 bg-gradient-to-r from-medship-primary/[0.03] to-transparent">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-primary/10">
              <svg className="h-4 w-4 text-medship-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </span>
            Sales Leaderboard &mdash; March 2026
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16 text-center">Rank</TableHead>
              <TableHead>Sales Rep</TableHead>
              <TableHead className="text-right">Revenue (MTD)</TableHead>
              <TableHead className="hidden w-[220px] lg:table-cell">Revenue Bar</TableHead>
              <TableHead className="hidden text-center md:table-cell">Deals Closed</TableHead>
              <TableHead className="hidden text-center md:table-cell">Quotes Sent</TableHead>
              <TableHead className="hidden text-center lg:table-cell">Profile Calls</TableHead>
              <TableHead className="hidden text-right xl:table-cell">Avg Deal Size</TableHead>
              <TableHead className="hidden text-center lg:table-cell">Win Rate</TableHead>
              <TableHead className="text-center">Activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((rep, i) => {
              const rank = i + 1
              const barPct = (rep.revenueMTD / topRevenue) * 100
              const winRateColor = rep.winRate > 40 ? 'text-emerald-600' : rep.winRate >= 20 ? 'text-amber-600' : 'text-red-500'

              return (
                <TableRow
                  key={rep.id}
                  className={cn(
                    'transition-colors',
                    rank === 1 && 'bg-amber-50/40 dark:bg-amber-950/10'
                  )}
                >
                  <TableCell className="text-center">{rankDisplay(rank)}</TableCell>
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
                  <TableCell className="text-right font-semibold tabular-nums text-card-foreground">
                    ${rep.revenueMTD.toLocaleString()}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${barPct}%`,
                          background: `linear-gradient(90deg, ${rep.color}CC, ${rep.color})`,
                        }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-center font-medium md:table-cell">{rep.dealsClosed}</TableCell>
                  <TableCell className="hidden text-center font-medium md:table-cell">{rep.quotesSent}</TableCell>
                  <TableCell className="hidden text-center lg:table-cell">
                    <div className="flex items-center justify-center gap-1">
                      <span className="font-semibold tabular-nums">{rep.profileCalls}</span>
                      {rep.profileCallsChange !== 0 && (
                        <span className={cn(
                          'inline-flex items-center text-[0.6rem]',
                          rep.profileCallsChange > 0 ? 'text-emerald-500' : 'text-red-400'
                        )}>
                          {rep.profileCallsChange > 0 ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" />
                          )}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums xl:table-cell">
                    ${rep.avgDealSize.toLocaleString()}
                  </TableCell>
                  <TableCell className={cn('hidden text-center font-semibold lg:table-cell', winRateColor)}>
                    {rep.winRate.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-center">{activityBadge(rep.activityScore)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
