'use client'

import { useEffect, useState } from 'react'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { QuoteStatusBadge } from '@/components/dashboard/QuoteStatusBadge'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { ComingSoonBadge, ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { RevenueByRepChart } from '@/components/charts/RevenueByRepChart'
import { PipelineByRepChart } from '@/components/charts/PipelineByRepChart'
import { Header } from '@/components/layout/Header'
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
import {
  DollarSign,
  FileText,
  Target,
  Clock,
  TrendingUp,
  Award,
  Phone,
  PhoneCall,
  Zap,
  ArrowUpDown,
  AlertTriangle,
  Database,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/client-api'
import type { SalesKpis, ProfileCallMetricsResult, KeywordResult, SalesRepPerformance, SalesDataHealth } from '@/lib/data'
import type { SeedMonthlyRepRevenue, SeedPipelineByRep, SeedQuote, SeedProfileCall, SeedWeeklyCallVolume } from '@/lib/seed-data'
import { WeeklyCallVolumeChart } from '@/components/charts/WeeklyCallVolumeChart'
import { CallOutcomeChart } from '@/components/charts/CallOutcomeChart'
import { ProfileCallTable } from '@/components/dashboard/ProfileCallTable'
import { ProfileCallLeaderboard } from '@/components/dashboard/ProfileCallLeaderboard'
import { CompetitorKeywordCard } from '@/components/dashboard/CompetitorKeywordCard'

type SortKey = 'revenueMTD' | 'revenueQTD' | 'revenueYTD' | 'dealsClosed' | 'dealsLost' | 'winRate' | 'quotesSent' | 'quoteValueMTD' | 'avgDealSize' | 'pipelineValue'

type SalesDashboardResponse = {
  kpis: SalesKpis
  reps: SalesRepPerformance[]
  monthlyRevenue: SeedMonthlyRepRevenue[]
  pipelineByRep: SeedPipelineByRep[]
  salesHealth: SalesDataHealth
  quotes: SeedQuote[]
  profileCalls: SeedProfileCall[]
  weeklyVolume: SeedWeeklyCallVolume[]
  outcomeBreakdown: Array<{ outcome: string; count: number; percentage: number; color: string }>
  profileMetrics: ProfileCallMetricsResult
  competitorKeywords: KeywordResult[]
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatNullableDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'No data'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'No data'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function MappingBadge({ status }: { status: SalesRepPerformance['mappingStatus'] }) {
  const styles: Record<SalesRepPerformance['mappingStatus'], string> = {
    mapped: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
    unmapped: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
    house: 'border-sky-500/30 bg-sky-500/10 text-sky-700',
    system: 'border-slate-500/30 bg-slate-500/10 text-slate-700',
  }

  return (
    <Badge variant="outline" className={cn('capitalize', styles[status])}>
      {status}
    </Badge>
  )
}

export default function SalesPage() {
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<SalesKpis | null>(null)
  const [reps, setReps] = useState<SalesRepPerformance[]>([])
  const [monthlyRevenue, setMonthlyRevenue] = useState<SeedMonthlyRepRevenue[]>([])
  const [pipelineByRep, setPipelineByRep] = useState<SeedPipelineByRep[]>([])
  const [salesHealth, setSalesHealth] = useState<SalesDataHealth | null>(null)
  const [quotes, setQuotes] = useState<SeedQuote[]>([])
  const [profileCalls, setProfileCalls] = useState<SeedProfileCall[]>([])
  const [weeklyVolume, setWeeklyVolume] = useState<SeedWeeklyCallVolume[]>([])
  const [outcomeBreakdown, setOutcomeBreakdown] = useState<Array<{ outcome: string; count: number; percentage: number; color: string }>>([])
  const [profileMetrics, setProfileMetrics] = useState<ProfileCallMetricsResult | null>(null)
  const [competitorKeywords, setCompetitorKeywords] = useState<KeywordResult[]>([])
  const [keywordFilter, setKeywordFilter] = useState<string | undefined>(undefined)
  const [sortKey, setSortKey] = useState<SortKey>('revenueMTD')
  const [sortAsc, setSortAsc] = useState(false)

  useEffect(() => {
    async function loadData() {
      try {
        const data = await fetchJson<SalesDashboardResponse>('/api/dashboard/sales')
        setKpis(data.kpis)
        setReps(data.reps)
        setMonthlyRevenue(data.monthlyRevenue)
        setPipelineByRep(data.pipelineByRep)
        setSalesHealth(data.salesHealth)
        setQuotes(data.quotes)
        setProfileCalls(data.profileCalls)
        setWeeklyVolume(data.weeklyVolume)
        setOutcomeBreakdown(data.outcomeBreakdown)
        setProfileMetrics(data.profileMetrics)
        setCompetitorKeywords(data.competitorKeywords)
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
            title="Operational Revenue MTD"
            value={`$${kpis.revenueMTD.toLocaleString()}`}
            icon={DollarSign}
            iconColor="text-medship-primary"
          />
          <KpiCard
            title="Operational Revenue QTD"
            value={`$${kpis.revenueQTD.toLocaleString()}`}
            icon={TrendingUp}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="Operational Revenue YTD"
            value={`$${kpis.revenueYTD.toLocaleString()}`}
            icon={Award}
            iconColor="text-medship-secondary"
          />
          <KpiCard
            title="Fishbowl Quotes MTD"
            value={kpis.quotesSentMTD}
            icon={FileText}
            iconColor="text-medship-info"
          />
          <KpiCard
            title="Issued SOs MTD"
            value={kpis.dealsClosedMTD}
            icon={Target}
            iconColor="text-medship-danger"
          />
          <KpiCard
            title="Salesforce Pipeline"
            value={`$${kpis.pipelineValue.toLocaleString()}`}
            icon={Database}
            iconColor="text-medship-warning"
          />
          <KpiCard
            title="Profile Calls (MTD)"
            value={profileMetrics?.totalMTD ?? 0}
            change={profileMetrics && profileMetrics.totalLastMonth > 0
              ? Math.round(((profileMetrics.totalMTD - profileMetrics.totalLastMonth) / profileMetrics.totalLastMonth) * 1000) / 10
              : 0}
            changeLabel="vs last month"
            icon={Phone}
            iconColor="text-medship-success"
          />
        </div>

        {salesHealth && (
          <Card className={cn(salesHealth.isFishbowlOrderStale && 'border-amber-500/50 bg-amber-500/5')}>
            <CardContent className="flex flex-col gap-3 p-4 text-sm md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className={cn(
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  salesHealth.isFishbowlOrderStale ? 'bg-amber-500/10 text-amber-700' : 'bg-emerald-500/10 text-emerald-700'
                )}>
                  {salesHealth.isFishbowlOrderStale ? <AlertTriangle className="h-4 w-4" /> : <Database className="h-4 w-4" />}
                </div>
                <div>
                  <p className="font-semibold text-card-foreground">
                    Revenue source: Fishbowl issued Sales Orders
                  </p>
                  <p className="text-muted-foreground">
                    Latest Fishbowl SO: {formatNullableDate(salesHealth.latestFishbowlOrderDate)}
                    {salesHealth.fishbowlOrderFreshnessDays !== null && ` (${salesHealth.fishbowlOrderFreshnessDays}d old)`}
                    . Salesforce remains the source for pipeline.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                <Badge variant="outline">Mapped aliases: {salesHealth.mappedAliasCount}</Badge>
                <Badge variant="outline" className={salesHealth.unmappedAliasCount > 0 ? 'border-amber-500/30 bg-amber-500/10 text-amber-700' : ''}>
                  Unmapped: {salesHealth.unmappedAliasCount}
                </Badge>
                <Badge variant="outline">SO links: {salesHealth.linkCoverage}%</Badge>
                <Badge variant="outline">Link rows: {salesHealth.linkRows}</Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sales Rep Performance Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Sales Rep Performance
              <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700">
                Fishbowl SO revenue
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {reps.length === 0 ? (
              <EmptyState
                icon={Award}
                title="No live sales reps found"
                description="Force a Salesforce sync after the Salesforce credentials are corrected."
              />
            ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Rep</TableHead>
                  <SortHeader label="Revenue MTD" field="revenueMTD" className="text-right" />
                  <SortHeader label="Revenue QTD" field="revenueQTD" className="hidden text-right xl:table-cell" />
                  <SortHeader label="Revenue YTD" field="revenueYTD" className="hidden text-right xl:table-cell" />
                  <SortHeader label="Issued SOs" field="dealsClosed" className="text-center" />
                  <SortHeader label="Quotes MTD" field="quotesSent" className="hidden text-center md:table-cell" />
                  <SortHeader label="Quote Value" field="quoteValueMTD" className="hidden text-right xl:table-cell" />
                  <SortHeader label="SO Conv." field="winRate" className="text-center" />
                  <SortHeader label="Avg SO" field="avgDealSize" className="hidden text-right lg:table-cell" />
                  <SortHeader label="SF Pipeline" field="pipelineValue" className="hidden text-right md:table-cell" />
                  <TableHead className="hidden text-center lg:table-cell">Mapping</TableHead>
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
                            <p className="max-w-[13rem] truncate text-[0.7rem] text-muted-foreground">
                              {rep.fishbowlAliases.length > 0 ? rep.fishbowlAliases.join(', ') : 'Salesforce only'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">${rep.revenueMTD.toLocaleString()}</TableCell>
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">${rep.revenueQTD.toLocaleString()}</TableCell>
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">${rep.revenueYTD.toLocaleString()}</TableCell>
                      <TableCell className="text-center font-medium">{rep.dealsClosed}</TableCell>
                      <TableCell className="hidden text-center font-medium md:table-cell">{rep.quotesSent}</TableCell>
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">${rep.quoteValueMTD.toLocaleString()}</TableCell>
                      <TableCell className={cn('text-center font-semibold', winRateColor)}>{rep.winRate.toFixed(1)}%</TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">${rep.avgDealSize.toLocaleString()}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">${rep.pipelineValue.toLocaleString()}</TableCell>
                      <TableCell className="hidden text-center lg:table-cell">
                        <MappingBadge status={rep.mappingStatus} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>

        {salesHealth && (salesHealth.unmappedAliases.length > 0 || salesHealth.houseAndSystemAliases.length > 0) && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Fishbowl Alias Mapping
                  {salesHealth.unmappedAliases.length > 0 && (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700">
                      Needs Mapping
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {salesHealth.unmappedAliases.length === 0 ? (
                  <div className="p-5 text-sm text-muted-foreground">All active Fishbowl aliases with YTD activity are mapped.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Alias</TableHead>
                        <TableHead className="text-right">YTD Revenue</TableHead>
                        <TableHead className="text-center">SOs</TableHead>
                        <TableHead className="text-center">Quotes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {salesHealth.unmappedAliases.map((alias) => (
                        <TableRow key={alias.alias}>
                          <TableCell>
                            <p className="font-semibold text-card-foreground">{alias.alias}</p>
                            <p className="text-xs text-muted-foreground">Latest {formatNullableDate(alias.latestActivityAt)}</p>
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">${alias.revenueYTD.toLocaleString()}</TableCell>
                          <TableCell className="text-center tabular-nums">{alias.ordersYTD}</TableCell>
                          <TableCell className="text-center tabular-nums">{alias.quotesYTD}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  House / System Visibility
                  <Badge variant="outline">Not in leaderboard</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {salesHealth.houseAndSystemAliases.length === 0 ? (
                  <div className="p-5 text-sm text-muted-foreground">No house or system alias activity detected this year.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Alias</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">YTD Revenue</TableHead>
                        <TableHead className="text-center">SOs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {salesHealth.houseAndSystemAliases.map((alias) => (
                        <TableRow key={alias.alias}>
                          <TableCell>
                            <p className="font-semibold text-card-foreground">{alias.displayName}</p>
                            <p className="text-xs text-muted-foreground">{alias.alias}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">{alias.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">${alias.revenueYTD.toLocaleString()}</TableCell>
                          <TableCell className="text-center tabular-nums">{alias.ordersYTD}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Profile Call Leaderboard */}
        {profileMetrics && (
          <ProfileCallLeaderboard reps={reps} metrics={profileMetrics} />
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RevenueByRepChart data={monthlyRevenue} />
          <PipelineByRepChart data={pipelineByRep} />
        </div>

        {/* Profile Call Activity Section */}

        {/* Row 1: Call KPIs */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Total Profile Calls MTD"
            value={profileMetrics?.totalMTD ?? 0}
            change={profileMetrics && profileMetrics.totalLastMonth > 0
              ? Math.round(((profileMetrics.totalMTD - profileMetrics.totalLastMonth) / profileMetrics.totalLastMonth) * 1000) / 10
              : 0}
            changeLabel="vs last month"
            icon={Phone}
            iconColor="text-medship-primary"
          />
          <KpiCard
            title="Connect Rate"
            value={`${profileMetrics?.connectRate ?? 0}%`}
            change={0}
            changeLabel="org-wide (RingDNA)"
            icon={PhoneCall}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="Avg Call Duration"
            value={`${profileMetrics?.avgDuration ?? 0}m`}
            change={0}
            changeLabel="from RingDNA"
            icon={Clock}
            iconColor="text-medship-info"
          />
          <KpiCard
            title="Conversion to Opp"
            value={`${profileMetrics?.conversionRate ?? 0}%`}
            change={0}
            changeLabel="calls to opportunities"
            icon={Zap}
            iconColor="text-medship-secondary"
          />
        </div>

        {/* Row 2: Charts side by side */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <WeeklyCallVolumeChart data={weeklyVolume} reps={reps} />
          </div>
          <div className="lg:col-span-5">
            <CallOutcomeChart data={outcomeBreakdown} />
          </div>
        </div>

        {/* Row 3: Competitor Intelligence */}
        <CompetitorKeywordCard
          keywords={competitorKeywords}
          onKeywordClick={(keyword) => setKeywordFilter(keyword)}
        />

        {/* Row 4: Profile Call Log Table */}
        <ProfileCallTable
          calls={profileCalls}
          reps={reps}
          keywordFilter={keywordFilter}
          onClearKeywordFilter={() => setKeywordFilter(undefined)}
        />

        {/* Quote Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Quote Activity
              {quotes.length === 0 && <ComingSoonBadge />}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {quotes.length === 0 ? (
              <ComingSoonPanel
                title="Quote activity"
                description="A live Salesforce quote source is not mapped into Prometheus yet."
              />
            ) : (
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
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
