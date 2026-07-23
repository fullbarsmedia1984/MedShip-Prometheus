'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { SummaryCardPicker } from '@/components/dashboard/SummaryCardPicker'
import { QuoteStatusBadge } from '@/components/dashboard/QuoteStatusBadge'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { ComingSoonBadge, ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { ChartSkeleton } from '@/components/charts/ChartSkeleton'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  PhoneOutgoing,
  Zap,
  ArrowUpDown,
  AlertTriangle,
  Database,
  Save,
  Users,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/client-api'
import type { SalesKpis, ProfileCallMetricsResult, SalesRepPerformance, SalesDataHealth, CallActivitySummary, MonthlyBusinessRevenue, MonthlyBusinessRevenueByRep, TerritoryQoQPayload, YoYRevenueComparison } from '@/lib/data'
import type { SeedMonthlyRepRevenue, SeedPipelineByRep, SeedQuote, SeedProfileCall, SeedWeeklyCallVolume } from '@/lib/seed-data'
import { ProfileCallTable } from '@/components/dashboard/ProfileCallTable'
import { ProfileCallLeaderboard } from '@/components/dashboard/ProfileCallLeaderboard'
import { CallActivitySummaryCard } from '@/components/dashboard/CallActivitySummaryCard'
import { RevenueCohortSection } from '@/components/dashboard/RevenueCohortSection'
import { ReportingMethodologyDialog } from '@/components/dashboard/ReportingMethodologyDialog'
import type { CohortDashboard } from '@/lib/cohorts'

// Chart components pull in recharts (~100kb+ gzipped). Load them lazily so
// the page shell paints without the charting bundle; the fixed-height
// skeletons keep the layout from shifting while each chart mounts.
const RevenueByRepChart = dynamic(
  () => import('@/components/charts/RevenueByRepChart').then((m) => m.RevenueByRepChart),
  { ssr: false, loading: () => <ChartSkeleton height={460} /> }
)
const PipelineByRepChart = dynamic(
  () => import('@/components/charts/PipelineByRepChart').then((m) => m.PipelineByRepChart),
  { ssr: false, loading: () => <ChartSkeleton height={460} /> }
)
const NewRecurringBusinessChart = dynamic(
  () => import('@/components/charts/NewRecurringBusinessChart').then((m) => m.NewRecurringBusinessChart),
  { ssr: false, loading: () => <ChartSkeleton height={460} /> }
)
const NewRecurringBusinessByRepChart = dynamic(
  () => import('@/components/charts/NewRecurringBusinessByRepChart').then((m) => m.NewRecurringBusinessByRepChart),
  { ssr: false, loading: () => <ChartSkeleton height={460} /> }
)
const WeeklyCallVolumeChart = dynamic(
  () => import('@/components/charts/WeeklyCallVolumeChart').then((m) => m.WeeklyCallVolumeChart),
  { ssr: false, loading: () => <ChartSkeleton height={390} /> }
)
const CallOutcomeChart = dynamic(
  () => import('@/components/charts/CallOutcomeChart').then((m) => m.CallOutcomeChart),
  { ssr: false, loading: () => <ChartSkeleton height={330} /> }
)
const RingDnaRepActivityCharts = dynamic(
  () => import('@/components/charts/RingDnaRepActivityCharts').then((m) => m.RingDnaRepActivityCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartSkeleton height={440} />
        <ChartSkeleton height={440} />
      </div>
    ),
  }
)
const YoYRevenueCharts = dynamic(
  () => import('@/components/charts/YoYRevenueCharts').then((m) => m.YoYRevenueCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartSkeleton height={420} />
        <ChartSkeleton height={420} />
      </div>
    ),
  }
)
const TerritoryQoQCharts = dynamic(
  () => import('@/components/charts/TerritoryQoQCharts').then((m) => m.TerritoryQoQCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartSkeleton height={440} />
        <ChartSkeleton height={440} />
      </div>
    ),
  }
)

type SortKey =
  | 'revenueMTD'
  | 'revenueQTD'
  | 'revenueYTD'
  | 'newBusinessRevenueMTD'
  | 'recurringBusinessRevenueMTD'
  | 'dealsClosed'
  | 'dealsLost'
  | 'winRate'
  | 'quotesSent'
  | 'quoteValueMTD'
  | 'avgDealSize'
  | 'pipelineValue'

type SummaryCard = {
  id: string
  title: string
  value: string | number
  icon: React.ElementType
  iconColor?: string
  change?: number
  changeLabel?: string
}

const SUMMARY_CARD_IDS = [
  'operational-mtd',
  'new-business-mtd',
  'recurring-mtd',
  'new-business-mix',
  'operational-qtd',
  'operational-ytd',
  'fishbowl-quotes',
  'issued-sos',
  'sf-pipeline',
  'ringdna-calls',
] as const

// Default to the first 8 registry entries; the rest stay one click away in
// the Customize picker.
const DEFAULT_SUMMARY_CARD_IDS: string[] = SUMMARY_CARD_IDS.slice(0, 8)
const SUMMARY_CARDS_STORAGE_KEY = 'medship.sales.summary-cards.v1'

type LeaderboardHistoryEntry = { key: string; label: string; reps: SalesRepPerformance[] }

type SalesDashboardResponse = {
  kpis: SalesKpis
  reps: SalesRepPerformance[]
  leaderboardHistory?: LeaderboardHistoryEntry[]
  monthlyRevenue: SeedMonthlyRepRevenue[]
  monthlyBusinessRevenue: MonthlyBusinessRevenue[]
  monthlyBusinessRevenueByRep: MonthlyBusinessRevenueByRep[]
  pipelineByRep: SeedPipelineByRep[]
  salesHealth: SalesDataHealth
  quotes: SeedQuote[]
  profileCalls: SeedProfileCall[]
  weeklyVolume: SeedWeeklyCallVolume[]
  outcomeBreakdown: Array<{ outcome: string; count: number; percentage: number; color: string }>
  profileMetrics: ProfileCallMetricsResult
  callActivitySummary: CallActivitySummary
  cohorts: CohortDashboard | null
  yoyRevenue?: YoYRevenueComparison | null
  territoryQoQ?: TerritoryQoQPayload | null
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
  const [leaderboardHistory, setLeaderboardHistory] = useState<LeaderboardHistoryEntry[]>([])
  const [selectedPerfMonth, setSelectedPerfMonth] = useState('current')
  const [monthlyRevenue, setMonthlyRevenue] = useState<SeedMonthlyRepRevenue[]>([])
  const [monthlyBusinessRevenue, setMonthlyBusinessRevenue] = useState<MonthlyBusinessRevenue[]>([])
  const [monthlyBusinessRevenueByRep, setMonthlyBusinessRevenueByRep] = useState<MonthlyBusinessRevenueByRep[]>([])
  const [pipelineByRep, setPipelineByRep] = useState<SeedPipelineByRep[]>([])
  const [salesHealth, setSalesHealth] = useState<SalesDataHealth | null>(null)
  const [quotes, setQuotes] = useState<SeedQuote[]>([])
  const [profileCalls, setProfileCalls] = useState<SeedProfileCall[]>([])
  const [weeklyVolume, setWeeklyVolume] = useState<SeedWeeklyCallVolume[]>([])
  const [outcomeBreakdown, setOutcomeBreakdown] = useState<Array<{ outcome: string; count: number; percentage: number; color: string }>>([])
  const [profileMetrics, setProfileMetrics] = useState<ProfileCallMetricsResult | null>(null)
  const [callActivitySummary, setCallActivitySummary] = useState<CallActivitySummary | null>(null)
  const [cohorts, setCohorts] = useState<CohortDashboard | null>(null)
  const [yoyRevenue, setYoyRevenue] = useState<YoYRevenueComparison | null>(null)
  const [territoryQoQ, setTerritoryQoQ] = useState<TerritoryQoQPayload | null>(null)
  const [selectedRosterAliases, setSelectedRosterAliases] = useState<string[]>([])
  const [rosterExpanded, setRosterExpanded] = useState(false)
  const [savingRoster, setSavingRoster] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('revenueMTD')
  const [sortAsc, setSortAsc] = useState(false)
  const [visibleSummaryCards, setVisibleSummaryCards] = useState<string[]>(DEFAULT_SUMMARY_CARD_IDS)

  // Restore the user's card selection after mount (localStorage is
  // unavailable during SSR/hydration).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SUMMARY_CARDS_STORAGE_KEY)
      if (!stored) return
      const parsed: unknown = JSON.parse(stored)
      if (!Array.isArray(parsed)) return
      const valid = parsed.filter(
        (id): id is string => typeof id === 'string' && (SUMMARY_CARD_IDS as readonly string[]).includes(id)
      )
      if (valid.length > 0) setVisibleSummaryCards(valid)
    } catch {
      // Corrupted value — fall back to the default selection.
    }
  }, [])

  const updateVisibleSummaryCards = (ids: string[]) => {
    setVisibleSummaryCards(ids)
    try {
      window.localStorage.setItem(SUMMARY_CARDS_STORAGE_KEY, JSON.stringify(ids))
    } catch {
      // Private browsing / quota — selection still applies for this session.
    }
  }

  const loadData = useCallback(async () => {
    try {
      const data = await fetchJson<SalesDashboardResponse>('/api/dashboard/sales')
      setKpis(data.kpis)
      setReps(data.reps)
      setLeaderboardHistory(data.leaderboardHistory ?? [])
      setMonthlyRevenue(data.monthlyRevenue)
      setMonthlyBusinessRevenue(data.monthlyBusinessRevenue ?? [])
      setMonthlyBusinessRevenueByRep(data.monthlyBusinessRevenueByRep ?? [])
      setPipelineByRep(data.pipelineByRep)
      setSalesHealth(data.salesHealth)
      setSelectedRosterAliases(data.salesHealth.rosterOptions.filter((option) => option.isSelected).map((option) => option.fishbowlSalesperson))
      setQuotes(data.quotes)
      setProfileCalls(data.profileCalls)
      setWeeklyVolume(data.weeklyVolume)
      setOutcomeBreakdown(data.outcomeBreakdown)
      setProfileMetrics(data.profileMetrics)
      setCallActivitySummary(data.callActivitySummary)
      setCohorts(data.cohorts ?? null)
      setYoyRevenue(data.yoyRevenue ?? null)
      setTerritoryQoQ(data.territoryQoQ ?? null)
    } catch (error) {
      console.error('Failed to load sales data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const currentDailyCallActivity = callActivitySummary?.daily[callActivitySummary.daily.length - 1] ?? null
  const currentMonthlyCallActivity = callActivitySummary?.monthly[callActivitySummary.monthly.length - 1] ?? null

  useEffect(() => {
    loadData()
  }, [loadData])

  const rosterGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string
      displayName: string
      aliases: string[]
      latestActivityAt: string | null
    }>()

    for (const option of salesHealth?.rosterOptions ?? []) {
      const key = option.sfUserId ?? option.displayName
      const group = groups.get(key) ?? {
        key,
        displayName: option.displayName,
        aliases: [],
        latestActivityAt: null,
      }
      group.aliases.push(option.fishbowlSalesperson)
      if (option.latestActivityAt && (!group.latestActivityAt || option.latestActivityAt > group.latestActivityAt)) {
        group.latestActivityAt = option.latestActivityAt
      }
      groups.set(key, group)
    }

    return Array.from(groups.values())
  }, [salesHealth])

  const toggleRosterGroup = (aliases: string[]) => {
    setRosterError(null)
    setSelectedRosterAliases((current) => {
      const selected = new Set(current)
      const shouldRemove = aliases.some((alias) => selected.has(alias))
      for (const alias of aliases) {
        if (shouldRemove) selected.delete(alias)
        else selected.add(alias)
      }
      return [...selected]
    })
  }

  const saveRoster = async () => {
    setRosterError(null)
    setSavingRoster(true)
    try {
      await fetchJson<{ selectedAliases: string[] }>('/api/dashboard/sales/roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedAliases: selectedRosterAliases }),
      })
      await loadData()
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : 'Could not save roster')
    } finally {
      setSavingRoster(false)
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  // The performance table can flip to a prior full month; every other
  // section (charts, roster, call metrics) stays on the current period.
  const perfMonthEntry = selectedPerfMonth === 'current'
    ? null
    : leaderboardHistory.find((month) => month.key === selectedPerfMonth) ?? null
  const perfReps = perfMonthEntry?.reps ?? reps

  const sortedReps = [...perfReps].sort((a, b) => {
    const multiplier = sortAsc ? 1 : -1
    return (a[sortKey] - b[sortKey]) * multiplier
  })

  const topPerformerId = sortedReps[0]?.id
  const activeMetricLabel = salesHealth?.activeMetricPeriodLabel ?? 'MTD'
  const shortMetricLabel = salesHealth?.isMetricPeriodFallback ? activeMetricLabel : 'MTD'
  // Column label for the month-scoped table columns.
  const tableMetricLabel = perfMonthEntry ? perfMonthEntry.label : shortMetricLabel

  const summaryCards: SummaryCard[] = kpis
    ? [
        {
          id: 'operational-mtd',
          title: `Operational Revenue ${shortMetricLabel}`,
          value: `$${kpis.revenueMTD.toLocaleString()}`,
          icon: DollarSign,
          iconColor: 'text-medship-primary',
        },
        {
          id: 'new-business-mtd',
          title: `New Business Revenue ${shortMetricLabel}`,
          value: `$${kpis.newBusinessRevenueMTD.toLocaleString()}`,
          icon: Zap,
          iconColor: 'text-medship-success',
        },
        {
          id: 'recurring-mtd',
          title: `Recurring Revenue ${shortMetricLabel}`,
          value: `$${kpis.recurringBusinessRevenueMTD.toLocaleString()}`,
          icon: Users,
          iconColor: 'text-medship-info',
        },
        {
          id: 'new-business-mix',
          title: `New Business Mix ${shortMetricLabel}`,
          value: `${kpis.newBusinessMixMTD.toFixed(1)}%`,
          icon: Target,
          iconColor: 'text-medship-warning',
        },
        {
          id: 'operational-qtd',
          title: 'Operational Revenue QTD',
          value: `$${kpis.revenueQTD.toLocaleString()}`,
          icon: TrendingUp,
          iconColor: 'text-medship-success',
        },
        {
          id: 'operational-ytd',
          title: 'Operational Revenue YTD',
          value: `$${kpis.revenueYTD.toLocaleString()}`,
          icon: Award,
          iconColor: 'text-medship-secondary',
        },
        {
          id: 'fishbowl-quotes',
          title: `Fishbowl Quotes ${shortMetricLabel}`,
          value: kpis.quotesSentMTD,
          icon: FileText,
          iconColor: 'text-medship-info',
        },
        {
          id: 'issued-sos',
          title: `Issued SOs ${shortMetricLabel}`,
          value: kpis.dealsClosedMTD,
          icon: Target,
          iconColor: 'text-medship-danger',
        },
        {
          id: 'sf-pipeline',
          title: 'Salesforce Pipeline',
          value: `$${kpis.pipelineValue.toLocaleString()}`,
          icon: Database,
          iconColor: 'text-medship-warning',
        },
        {
          id: 'ringdna-calls',
          title: 'RingDNA Calls (MTD)',
          value: profileMetrics?.totalMTD ?? 0,
          change:
            profileMetrics && profileMetrics.totalLastMonth > 0
              ? Math.round(((profileMetrics.totalMTD - profileMetrics.totalLastMonth) / profileMetrics.totalLastMonth) * 1000) / 10
              : 0,
          changeLabel: 'vs last month',
          icon: Phone,
          iconColor: 'text-medship-success',
        },
      ]
    : []

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

      <div className="space-y-6 p-4 md:p-6">
        {/* KPI Cards — user-configurable via the Customize picker */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.05rem] text-muted-foreground">
              Dashboard Summary
            </span>
            <SummaryCardPicker
              options={summaryCards.map((card) => ({ id: card.id, label: card.title }))}
              visibleIds={visibleSummaryCards}
              defaultIds={DEFAULT_SUMMARY_CARD_IDS}
              onChange={updateVisibleSummaryCards}
            />
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards
              .filter((card) => visibleSummaryCards.includes(card.id))
              .map(({ id, ...card }) => (
                <KpiCard key={id} {...card} />
              ))}
          </div>
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
                    {salesHealth.isMetricPeriodFallback && ` Showing latest available Fishbowl period: ${salesHealth.activeMetricPeriodLabel}.`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {salesHealth.newBusinessDefinition}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-start gap-2 md:items-end">
                <ReportingMethodologyDialog />
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Mapped aliases: {salesHealth.mappedAliasCount}</Badge>
                <Badge variant="outline" className={salesHealth.unmappedAliasCount > 0 ? 'border-amber-500/30 bg-amber-500/10 text-amber-700' : ''}>
                  Unmapped: {salesHealth.unmappedAliasCount}
                </Badge>
                <Badge variant="outline">SO links: {salesHealth.linkCoverage}%</Badge>
                <Badge variant="outline">Link rows: {salesHealth.linkRows}</Badge>
              </div>
              </div>
            </CardContent>
          </Card>
        )}

        {salesHealth && (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex flex-wrap items-center gap-2">
                Active Sales Roster
                <Badge variant="outline">{selectedRosterAliases.length} aliases selected</Badge>
                <Badge variant="outline">{rosterGroups.length} reps</Badge>
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRosterExpanded((expanded) => !expanded)}
                aria-expanded={rosterExpanded}
              >
                {rosterExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {rosterExpanded ? 'Hide Roster' : 'Show Roster'}
              </Button>
            </CardHeader>
            {rosterExpanded && (
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                {rosterGroups.map((group) => {
                  const isSelected = group.aliases.some((alias) => selectedRosterAliases.includes(alias))
                  return (
                    <label
                      key={group.key}
                      className={cn(
                        'flex min-h-24 cursor-pointer flex-col justify-between rounded-lg border p-3 transition-colors',
                        isSelected
                          ? 'border-medship-primary/40 bg-medship-primary/5'
                          : 'border-[#D6DEE3] bg-card hover:bg-muted/30'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRosterGroup(group.aliases)}
                          className="h-4 w-4 accent-medship-primary"
                        />
                        <span className="font-semibold text-card-foreground">{group.displayName}</span>
                      </span>
                      <span className="mt-2 break-words text-xs text-muted-foreground">
                        {group.aliases.join(', ')}
                      </span>
                      <span className="mt-1 text-xs text-muted-foreground">
                        Latest {formatNullableDate(group.latestActivityAt)}
                      </span>
                    </label>
                  )
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={saveRoster} disabled={savingRoster || selectedRosterAliases.length === 0}>
                  <Save className="h-4 w-4" />
                  {savingRoster ? 'Saving' : 'Save Roster'}
                </Button>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  Showing selected roster in leaderboard and operational period metrics.
                </div>
                {rosterError && (
                  <p className="text-sm font-medium text-medship-danger">{rosterError}</p>
                )}
              </div>
            </CardContent>
            )}
          </Card>
        )}

        {/* Revenue Cohorts (NEW / WINBACK / RECURRING, migration 028) */}
        {cohorts && <RevenueCohortSection cohorts={cohorts} />}

        {/* Sales Rep Performance Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex flex-wrap items-center gap-2">
                Sales Rep Performance
                <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700">
                  Fishbowl SO revenue
                </Badge>
              </CardTitle>
              {leaderboardHistory.length > 0 && (
                <Select
                  value={selectedPerfMonth}
                  onValueChange={(value) => setSelectedPerfMonth(value ?? 'current')}
                >
                  <SelectTrigger className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">{activeMetricLabel} (current)</SelectItem>
                    {leaderboardHistory.map((month) => (
                      <SelectItem key={month.key} value={month.key}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {perfReps.length === 0 ? (
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
                  <SortHeader label={`Revenue ${tableMetricLabel}`} field="revenueMTD" className="text-right" />
                  <SortHeader label={`New Biz ${tableMetricLabel}`} field="newBusinessRevenueMTD" className="hidden text-right xl:table-cell" />
                  <SortHeader label={`Recurring ${tableMetricLabel}`} field="recurringBusinessRevenueMTD" className="hidden text-right xl:table-cell" />
                  <SortHeader label="Revenue QTD" field="revenueQTD" className="hidden text-right xl:table-cell" />
                  <SortHeader label="Revenue YTD" field="revenueYTD" className="hidden text-right xl:table-cell" />
                  <SortHeader label={`Issued SOs ${tableMetricLabel}`} field="dealsClosed" className="text-center" />
                  <SortHeader label={`Quotes ${tableMetricLabel}`} field="quotesSent" className="hidden text-center md:table-cell" />
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
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">
                        <div className="font-semibold">${rep.newBusinessRevenueMTD.toLocaleString()}</div>
                        <div className="text-[0.7rem] text-muted-foreground">{rep.newBusinessOrdersMTD} SOs</div>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">
                        <div className="font-semibold">${rep.recurringBusinessRevenueMTD.toLocaleString()}</div>
                        <div className="text-[0.7rem] text-muted-foreground">{rep.recurringBusinessOrdersMTD} SOs</div>
                      </TableCell>
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

        {/* Call Activity Leaderboard */}
        {profileMetrics && (
          <ProfileCallLeaderboard reps={reps} metrics={profileMetrics} />
        )}

        {/* Year-over-year revenue comparison (Fishbowl issue-date basis, company-wide) */}
        {yoyRevenue && <YoYRevenueCharts data={yoyRevenue} />}

        {/* Quarter vs prior-year quarter, company-wide + per territory (ship-to state) */}
        {territoryQoQ && <TerritoryQoQCharts data={territoryQoQ} />}

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RevenueByRepChart data={monthlyRevenue} />
          <NewRecurringBusinessChart data={monthlyBusinessRevenue} />
          <NewRecurringBusinessByRepChart data={monthlyBusinessRevenueByRep} />
          <PipelineByRepChart data={pipelineByRep} />
        </div>

        {/* RingDNA Call Activity Section */}

        {/* Row 1: Call KPIs */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Total RingDNA Calls MTD"
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
            title="Outbound Calls Today"
            value={currentDailyCallActivity?.outboundCalls ?? 0}
            change={0}
            changeLabel="same Salesforce cadence"
            icon={PhoneOutgoing}
            iconColor="text-medship-warning"
          />
          <KpiCard
            title="Call Time MTD"
            value={`${currentMonthlyCallActivity?.totalDurationMin ?? 0}m`}
            change={0}
            changeLabel="company total"
            icon={Clock}
            iconColor="text-medship-info"
          />
        </div>

        <CallActivitySummaryCard summary={callActivitySummary} />

        {/* Row 2: Charts side by side */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <WeeklyCallVolumeChart data={weeklyVolume} reps={reps} />
          </div>
          <div className="lg:col-span-5">
            <CallOutcomeChart data={outcomeBreakdown} />
          </div>
        </div>

        <RingDnaRepActivityCharts summary={callActivitySummary} reps={reps} />

        {/* Row 4: RingDNA Call Log Table */}
        <ProfileCallTable
          calls={profileCalls}
          reps={reps}
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
