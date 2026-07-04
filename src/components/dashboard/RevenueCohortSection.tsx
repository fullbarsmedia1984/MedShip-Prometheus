'use client'

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
import { Sparkles, RotateCcw, Repeat, MoonStar } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CohortRevenueChart } from '@/components/charts/CohortRevenueChart'
import type { CohortDashboard } from '@/lib/cohorts'

const COHORT_BADGE_STYLES: Record<string, string> = {
  NEW: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  WINBACK: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  RECURRING: 'border-sky-500/30 bg-sky-500/10 text-sky-700',
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StateCard({
  title,
  customers,
  detail,
  icon: Icon,
  iconClass,
}: {
  title: string
  customers: number
  detail: string
  icon: typeof Sparkles
  iconClass: string
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-card-foreground">
            {customers.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', iconClass)}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </CardContent>
    </Card>
  )
}

export function RevenueCohortSection({ cohorts }: { cohorts: CohortDashboard }) {
  const { monthly, snapshot, recentEntries } = cohorts

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-card-foreground">Revenue Cohorts</h2>
        <Badge variant="outline">
          New = first-ever purchase · Winback = returns after 365+ day lapse · each lasts 365 days
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StateCard
          title="New Customers (in 365-day window)"
          customers={snapshot.customers.NEW}
          detail={`+${snapshot.mtdNewCustomers} first-ever buyers this month · $${snapshot.mtdRevenue.NEW.toLocaleString()} MTD`}
          icon={Sparkles}
          iconClass="bg-emerald-500/10 text-emerald-700"
        />
        <StateCard
          title="Winback (in 365-day window)"
          customers={snapshot.customers.WINBACK}
          detail={`+${snapshot.mtdWinbackEntries} won back this month · $${snapshot.mtdRevenue.WINBACK.toLocaleString()} MTD`}
          icon={RotateCcw}
          iconClass="bg-amber-500/10 text-amber-700"
        />
        <StateCard
          title="Recurring Customers"
          customers={snapshot.customers.RECURRING}
          detail={`$${snapshot.mtdRevenue.RECURRING.toLocaleString()} MTD · ${snapshot.mtdOrders.RECURRING} SOs`}
          icon={Repeat}
          iconClass="bg-sky-500/10 text-sky-700"
        />
        <StateCard
          title="Lapsed (winback-eligible)"
          customers={snapshot.customers.LAPSED}
          detail="No purchase in 365+ days — next order re-enters as Winback"
          icon={MoonStar}
          iconClass="bg-slate-500/10 text-slate-700"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <CohortRevenueChart data={monthly} />
        </div>
        <div className="lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>Latest Cohort Entries</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {recentEntries.length === 0 ? (
                <div className="p-5 text-sm text-muted-foreground">No cohort entries recorded yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Customer</TableHead>
                      <TableHead>Cohort</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentEntries.map((entry) => (
                      <TableRow key={entry.soNumber}>
                        <TableCell>
                          <p className="max-w-[13rem] truncate font-semibold text-card-foreground">
                            {entry.customerName ?? 'Unknown customer'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            SO {entry.soNumber} · {formatDate(entry.orderAt)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={COHORT_BADGE_STYLES[entry.cohort]}>
                            {entry.cohort === 'NEW' ? 'New' : 'Winback'}
                          </Badge>
                          {entry.cohort === 'WINBACK' && entry.priorGapDays !== null && (
                            <p className="mt-1 text-xs text-muted-foreground">{entry.priorGapDays}d lapse</p>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {entry.amount === null ? '—' : `$${entry.amount.toLocaleString()}`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
