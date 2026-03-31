'use client'

import { useEffect, useState } from 'react'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { QuoteStatusBadge } from '@/components/dashboard/QuoteStatusBadge'
import { RevenueByRepChart } from '@/components/charts/RevenueByRepChart'
import { PipelineByRepChart } from '@/components/charts/PipelineByRepChart'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DollarSign,
  FileText,
  Target,
  Clock,
  TrendingUp,
  Award,
  ArrowUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getSalesKpis,
  getEnhancedSalesReps,
  getMonthlyRepRevenue,
  getPipelineByRep,
  getQuotes,
} from '@/lib/data'
import type { SalesKpis } from '@/lib/data'
import type { SeedSalesRep, SeedMonthlyRepRevenue, SeedPipelineByRep, SeedQuote } from '@/lib/seed-data'

type SortKey = 'revenueMTD' | 'revenueQTD' | 'revenueYTD' | 'dealsClosed' | 'dealsLost' | 'winRate' | 'quotesSent' | 'avgDealSize' | 'avgDaysToClose' | 'pipelineValue'

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function SalesPage() {
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<SalesKpis | null>(null)
  const [reps, setReps] = useState<SeedSalesRep[]>([])
  const [monthlyRevenue, setMonthlyRevenue] = useState<SeedMonthlyRepRevenue[]>([])
  const [pipelineByRep, setPipelineByRep] = useState<SeedPipelineByRep[]>([])
  const [quotes, setQuotes] = useState<SeedQuote[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('revenueMTD')
  const [sortAsc, setSortAsc] = useState(false)

  useEffect(() => {
    async function loadData() {
      try {
        const [kpisData, repsData, revenueData, pipelineData, quotesData] = await Promise.all([
          getSalesKpis(),
          getEnhancedSalesReps(),
          getMonthlyRepRevenue(),
          getPipelineByRep(),
          getQuotes({ pageSize: 40 }),
        ])
        setKpis(kpisData)
        setReps(repsData)
        setMonthlyRevenue(revenueData)
        setPipelineByRep(pipelineData)
        setQuotes(quotesData.data)
      } catch (error) {
        console.error('Failed to load sales data:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const sortedReps = [...reps].sort((a, b) => {
    const multiplier = sortAsc ? 1 : -1
    return (a[sortKey] - b[sortKey]) * multiplier
  })

  const topPerformerId = sortedReps[0]?.id

  if (loading || !kpis) {
    return (
      <div className="flex flex-col">
        <Header title="Sales" />
        <div className="flex h-64 items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  const SortHeader = ({ label, field, className: cls }: { label: string; field: SortKey; className?: string }) => (
    <TableHead
      className={cn('cursor-pointer select-none transition-colors hover:text-card-foreground', cls)}
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn('h-3 w-3', sortKey === field ? 'text-medship-primary' : 'text-muted-foreground/40')} />
      </span>
    </TableHead>
  )

  return (
    <div className="flex flex-col">
      <Header title="Sales" />

      <div className="space-y-6 p-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            title="Revenue MTD"
            value={`$${kpis.revenueMTD.toLocaleString()}`}
            change={14.2}
            changeLabel="vs last month"
            icon={DollarSign}
            iconColor="text-medship-primary"
          />
          <KpiCard
            title="Revenue QTD"
            value={`$${kpis.revenueQTD.toLocaleString()}`}
            change={8.6}
            changeLabel="vs last quarter"
            icon={TrendingUp}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="Revenue YTD"
            value={`$${kpis.revenueYTD.toLocaleString()}`}
            change={22.1}
            changeLabel="vs last year"
            icon={Award}
            iconColor="text-medship-secondary"
          />
          <KpiCard
            title="Quotes Sent MTD"
            value={kpis.quotesSentMTD}
            change={12.4}
            changeLabel="vs last month"
            icon={FileText}
            iconColor="text-medship-info"
          />
          <KpiCard
            title="Deals Closed MTD"
            value={kpis.dealsClosedMTD}
            change={5.8}
            changeLabel="vs last month"
            icon={Target}
            iconColor="text-medship-danger"
          />
          <KpiCard
            title="Avg Days to Close"
            value={`${kpis.avgDaysToClose} days`}
            change={-3.2}
            changeLabel="vs last month"
            icon={Clock}
            iconColor="text-medship-warning"
            invertChange
          />
        </div>

        {/* Sales Rep Performance Table */}
        <Card>
          <CardHeader>
            <CardTitle>Sales Rep Performance</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Rep</TableHead>
                  <SortHeader label="Revenue MTD" field="revenueMTD" className="text-right" />
                  <SortHeader label="Revenue QTD" field="revenueQTD" className="hidden text-right xl:table-cell" />
                  <SortHeader label="Revenue YTD" field="revenueYTD" className="hidden text-right xl:table-cell" />
                  <SortHeader label="Deals Closed" field="dealsClosed" className="text-center" />
                  <SortHeader label="Deals Lost" field="dealsLost" className="hidden text-center lg:table-cell" />
                  <SortHeader label="Win Rate" field="winRate" className="text-center" />
                  <SortHeader label="Quotes Sent" field="quotesSent" className="hidden text-center md:table-cell" />
                  <SortHeader label="Avg Deal Size" field="avgDealSize" className="hidden text-right lg:table-cell" />
                  <SortHeader label="Avg Days" field="avgDaysToClose" className="hidden text-center lg:table-cell" />
                  <SortHeader label="Pipeline" field="pipelineValue" className="hidden text-right md:table-cell" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedReps.map((rep) => {
                  const winRateColor = rep.winRate > 40 ? 'text-emerald-600' : rep.winRate >= 20 ? 'text-amber-600' : 'text-red-500'
                  const isTop = rep.id === topPerformerId

                  return (
                    <TableRow
                      key={rep.id}
                      className={cn(isTop && 'bg-emerald-50/30 dark:bg-emerald-950/10')}
                    >
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
                      <TableCell className="text-right font-semibold tabular-nums">${rep.revenueMTD.toLocaleString()}</TableCell>
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">${rep.revenueQTD.toLocaleString()}</TableCell>
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">${rep.revenueYTD.toLocaleString()}</TableCell>
                      <TableCell className="text-center font-medium">{rep.dealsClosed}</TableCell>
                      <TableCell className="hidden text-center font-medium lg:table-cell">{rep.dealsLost}</TableCell>
                      <TableCell className={cn('text-center font-semibold', winRateColor)}>{rep.winRate.toFixed(1)}%</TableCell>
                      <TableCell className="hidden text-center font-medium md:table-cell">{rep.quotesSent}</TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">${rep.avgDealSize.toLocaleString()}</TableCell>
                      <TableCell className="hidden text-center lg:table-cell">{rep.avgDaysToClose}d</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">${rep.pipelineValue.toLocaleString()}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RevenueByRepChart data={monthlyRevenue} />
          <PipelineByRepChart data={pipelineByRep} />
        </div>

        {/* Quote Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Quote Activity</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Rep</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Days Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((quote) => (
                  <TableRow key={quote.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(quote.date)}</TableCell>
                    <TableCell className="font-medium">{quote.repName}</TableCell>
                    <TableCell className="max-w-[300px] truncate">{quote.customerName}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">${quote.amount.toLocaleString()}</TableCell>
                    <TableCell><QuoteStatusBadge status={quote.status} /></TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">{quote.daysOpen}d</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
