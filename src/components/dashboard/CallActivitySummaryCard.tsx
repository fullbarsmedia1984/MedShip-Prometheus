'use client'

import { BarChart3, Clock, PhoneOutgoing } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ComingSoonBadge, ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import type { CallActivitySummary, CallActivityPeriodSummary } from '@/lib/data'

interface CallActivitySummaryCardProps {
  summary: CallActivitySummary | null
}

function formatMinutes(value: number): string {
  return `${Math.round(value * 10) / 10}m`
}

function latestPeriod(periods: CallActivityPeriodSummary[]): CallActivityPeriodSummary | null {
  return periods.at(-1) ?? null
}

function PeriodStat({ label, period }: { label: string; period: CallActivityPeriodSummary | null }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <p className="text-lg font-bold tabular-nums text-card-foreground">{period?.outboundCalls ?? 0}</p>
          <p className="text-[0.65rem] text-muted-foreground">Outbound</p>
        </div>
        <div>
          <p className="text-lg font-bold tabular-nums text-card-foreground">{formatMinutes(period?.totalDurationMin ?? 0)}</p>
          <p className="text-[0.65rem] text-muted-foreground">Call Time</p>
        </div>
      </div>
    </div>
  )
}

export function CallActivitySummaryCard({ summary }: CallActivitySummaryCardProps) {
  const daily = latestPeriod(summary?.daily ?? [])
  const weekly = latestPeriod(summary?.weekly ?? [])
  const monthly = latestPeriod(summary?.monthly ?? [])
  const reps = summary?.byRep ?? []
  const recentDaily = (summary?.daily ?? []).slice(-7)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/50 bg-gradient-to-r from-medship-info/[0.05] to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-info/10">
              <BarChart3 className="h-4 w-4 text-medship-info" />
            </span>
            RingDNA Activity Cadence
            {reps.length === 0 && <ComingSoonBadge />}
          </CardTitle>
          <div className="text-right text-xs text-muted-foreground">
            <p>Latest activity: {summary?.latestActivityDate ?? 'No data'}</p>
            <p>Refreshes with Salesforce incremental sync</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!summary || reps.length === 0 ? (
          <ComingSoonPanel
            title="RingDNA activity cadence"
            description="Live Salesforce RingDNA call activity has not synced yet."
            className="m-5 min-h-40"
          />
        ) : (
          <>
            <div className="grid gap-3 p-5 sm:grid-cols-3">
              <PeriodStat label="Today" period={daily} />
              <PeriodStat label="This Week" period={weekly} />
              <PeriodStat label="This Month" period={monthly} />
            </div>
            <div className="grid grid-cols-4 gap-2 border-t border-border/50 px-5 py-4 sm:grid-cols-7">
              {recentDaily.map((period) => (
                <div key={period.periodStart} className="rounded-md bg-muted/20 px-2 py-2">
                  <p className="truncate text-[0.65rem] font-semibold text-muted-foreground">{period.label}</p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-card-foreground">{period.outboundCalls}</p>
                  <p className="text-[0.65rem] text-muted-foreground">{formatMinutes(period.totalDurationMin)}</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto border-t border-border/50">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Sales Rep</TableHead>
                    <TableHead className="text-center">
                      <span className="inline-flex items-center gap-1">
                        <PhoneOutgoing className="h-3.5 w-3.5" />
                        Today Outbound
                      </span>
                    </TableHead>
                    <TableHead className="text-center">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        Today Time
                      </span>
                    </TableHead>
                    <TableHead className="text-center">Week Outbound</TableHead>
                    <TableHead className="text-center">Week Time</TableHead>
                    <TableHead className="text-center">Month Outbound</TableHead>
                    <TableHead className="text-center">Month Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reps.map((rep) => (
                    <TableRow key={rep.ownerSfId}>
                      <TableCell>
                        <p className="font-semibold text-card-foreground">{rep.repName}</p>
                      </TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">{rep.today.outboundCalls}</TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">{formatMinutes(rep.today.totalDurationMin)}</TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">{rep.weekToDate.outboundCalls}</TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">{formatMinutes(rep.weekToDate.totalDurationMin)}</TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">{rep.monthToDate.outboundCalls}</TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">{formatMinutes(rep.monthToDate.totalDurationMin)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
