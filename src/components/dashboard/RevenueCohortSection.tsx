'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CohortRevenueChart } from '@/components/charts/CohortRevenueChart'
import type { CohortDashboard, WinbackOpportunityRow } from '@/lib/cohorts'

const COHORT_BADGE_STYLES: Record<string, string> = {
  NEW: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  WINBACK: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  RECURRING: 'border-sky-500/30 bg-sky-500/10 text-sky-700',
  LAPSED: 'border-slate-500/30 bg-slate-500/10 text-slate-700',
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type WinbackSortKey = 'revenue3yr' | 'revenueLifetime' | 'daysLapsed' | 'state'

function WinbackTargets({ rows }: { rows: WinbackOpportunityRow[] }) {
  const [filter, setFilter] = useState('')
  const [sortKey, setSortKey] = useState<WinbackSortKey>('revenue3yr')
  const [sortAsc, setSortAsc] = useState(false)

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase()
    const matched = query
      ? rows.filter(
          (row) =>
            (row.customerName ?? '').toLowerCase().includes(query) ||
            (row.state ?? '').toLowerCase().includes(query) ||
            (row.lastRep ?? '').toLowerCase().includes(query)
        )
      : rows
    const multiplier = sortAsc ? 1 : -1
    return [...matched].sort((a, b) => {
      if (sortKey === 'state') return multiplier * (a.state ?? '').localeCompare(b.state ?? '')
      return multiplier * (a[sortKey] - b[sortKey])
    })
  }, [rows, filter, sortKey, sortAsc])

  const sortBy = (key: WinbackSortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else {
      setSortKey(key)
      setSortAsc(key === 'state')
    }
  }

  const SortHead = ({ label, field, className }: { label: string; field: WinbackSortKey; className?: string }) => (
    <TableHead
      className={cn('cursor-pointer select-none whitespace-nowrap hover:text-card-foreground', className)}
      onClick={() => sortBy(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn('h-3 w-3', sortKey === field ? 'text-medship-primary' : 'text-muted-foreground/40')} />
      </span>
    </TableHead>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs text-muted-foreground">
          Lapsed customers ranked by recent value — their next order re-enters as a Winback.
        </p>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name, state, or rep…"
          className="h-8 w-full sm:w-64"
        />
      </div>
      <div className="max-h-[420px] overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead>Customer</TableHead>
              <SortHead label="State" field="state" />
              <TableHead>Last rep</TableHead>
              <SortHead label="Lapsed" field="daysLapsed" className="text-right" />
              <SortHead label="3-yr revenue" field="revenue3yr" className="text-right" />
              <SortHead label="Lifetime" field="revenueLifetime" className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 100).map((row) => (
              <TableRow key={row.canonicalKey}>
                <TableCell>
                  <p className="max-w-[16rem] truncate font-medium text-card-foreground">
                    {row.customerName ?? row.canonicalKey}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    last order {formatDate(row.lastOrderAt)} · {row.lifetimeOrders} lifetime orders
                  </p>
                </TableCell>
                <TableCell className="whitespace-nowrap">{row.state ?? '—'}</TableCell>
                <TableCell className="max-w-[9rem] truncate">{row.lastRep ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{Math.round(row.daysLapsed / 30.44)} mo</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  ${Math.round(row.revenue3yr).toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  ${Math.round(row.revenueLifetime).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No lapsed customers match that filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {filtered.length > 100 && (
        <p className="px-1 text-xs text-muted-foreground">Showing top 100 of {filtered.length} — refine the filter to narrow.</p>
      )}
    </div>
  )
}

export function RevenueCohortSection({ cohorts }: { cohorts: CohortDashboard }) {
  const { monthly, snapshot, recentEntries, winbackOpportunities } = cohorts

  const chips: Array<{ label: string; cohort: string; value: string; sub: string }> = [
    {
      label: 'New',
      cohort: 'NEW',
      value: snapshot.customers.NEW.toLocaleString(),
      sub: `+${snapshot.mtdNewCustomers} MTD · $${snapshot.mtdRevenue.NEW.toLocaleString()}`,
    },
    {
      label: 'Winback',
      cohort: 'WINBACK',
      value: snapshot.customers.WINBACK.toLocaleString(),
      sub: `+${snapshot.mtdWinbackEntries} MTD · $${snapshot.mtdRevenue.WINBACK.toLocaleString()}`,
    },
    {
      label: 'Recurring',
      cohort: 'RECURRING',
      value: snapshot.customers.RECURRING.toLocaleString(),
      sub: `$${snapshot.mtdRevenue.RECURRING.toLocaleString()} MTD`,
    },
    {
      label: 'Lapsed',
      cohort: 'LAPSED',
      value: snapshot.customers.LAPSED.toLocaleString(),
      sub: 'winback-eligible',
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Revenue Cohorts</CardTitle>
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <Badge key={chip.cohort} variant="outline" className={cn('px-2.5 py-1', COHORT_BADGE_STYLES[chip.cohort])}>
                <span className="font-semibold">{chip.label} {chip.value}</span>
                <span className="ml-1.5 hidden font-normal opacity-80 lg:inline">{chip.sub}</span>
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="winbacks">
          <TabsList>
            <TabsTrigger value="winbacks">Winback Targets ({winbackOpportunities.length})</TabsTrigger>
            <TabsTrigger value="trend">Monthly Trend</TabsTrigger>
            <TabsTrigger value="entries">Latest Entries</TabsTrigger>
          </TabsList>

          <TabsContent value="winbacks" className="mt-4">
            <WinbackTargets rows={winbackOpportunities} />
          </TabsContent>

          <TabsContent value="trend" className="mt-4">
            <CohortRevenueChart data={monthly} />
          </TabsContent>

          <TabsContent value="entries" className="mt-4">
            {recentEntries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No cohort entries recorded yet.</p>
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
                        <p className="max-w-[16rem] truncate font-medium text-card-foreground">
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
                          <span className="ml-2 text-xs text-muted-foreground">{entry.priorGapDays}d lapse</span>
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
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
