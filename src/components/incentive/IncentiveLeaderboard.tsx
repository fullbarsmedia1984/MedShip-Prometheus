'use client'

import { Award } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatUsd } from '@/lib/incentive/calculator'
import { PayoutBlockedCard } from './PayoutBlockedCard'
import type { RepIncentiveMonthlyRow } from '@/lib/incentive/types'

interface IncentiveLeaderboardProps {
  rows: RepIncentiveMonthlyRow[]
  payoutBlocked: boolean
}

export function IncentiveLeaderboard({ rows, payoutBlocked }: IncentiveLeaderboardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-primary/10">
            <Award className="h-4 w-4 text-medship-primary" />
          </span>
          Incentive Leaderboard (MTD)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No classified orders this month yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rep</TableHead>
                <TableHead className="text-right">Enrollments</TableHead>
                <TableHead>Recurring rate</TableHead>
                <TableHead className="text-right">New-customer revenue</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Winback</TableHead>
                <TableHead className="text-right">Recurring</TableHead>
                <TableHead className="text-right">Projected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.rep_key}>
                  <TableCell className="font-medium">
                    <Link
                      className="hover:underline"
                      href={`/dashboard/incentives/scorecard?rep=${encodeURIComponent(row.rep_key)}`}
                    >
                      {row.rep_display_name ?? row.rep_key}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    {row.enrollments}
                    <span className="text-muted-foreground"> / {row.enrollment_gate}</span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        row.qualifies
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                          : row.enrollments >= 1
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                            : 'border-red-500/30 bg-red-500/10 text-red-700'
                      )}
                    >
                      {`${(row.recurring_rate * 100).toFixed(0)}%${row.qualifies ? '' : ' — quota missed'}`}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{formatUsd(row.new_revenue)}</TableCell>
                  {payoutBlocked || row.projected_total === null ? (
                    <TableCell colSpan={4} className="text-right">
                      <PayoutBlockedCard blockingUnmappedCount={row.blocking_unmapped_count} compact />
                    </TableCell>
                  ) : (
                    <>
                      <TableCell className="text-right">{formatUsd(row.new_commission ?? 0)}</TableCell>
                      <TableCell className="text-right">{formatUsd(row.winback_commission ?? 0)}</TableCell>
                      <TableCell className="text-right">{formatUsd(row.recurring_commission ?? 0)}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatUsd(row.projected_total ?? 0)}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
