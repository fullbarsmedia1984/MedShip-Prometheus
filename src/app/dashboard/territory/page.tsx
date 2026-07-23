'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { ClientMap } from '@/components/dashboard/ClientMap'
import { TerritoryList } from '@/components/dashboard/TerritoryList'
import { ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { ChartSkeleton } from '@/components/charts/ChartSkeleton'
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
  Users,
  UserCheck,
  MapPin,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  ArrowUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/client-api'
import type { ClientMapStats } from '@/lib/data'
import type { Customer, SeedRegionSummary } from '@/lib/seed-data'

// Both charts pull in recharts — load them lazily so the page shell paints
// without the charting bundle. Fixed-height skeletons prevent layout shift.
const RevenueByRegionChart = dynamic(
  () => import('@/components/charts/RevenueByRegionChart').then((m) => m.RevenueByRegionChart),
  { ssr: false, loading: () => <ChartSkeleton height={410} /> }
)
const RepDistributionDonut = dynamic(
  () => import('@/components/charts/RepDistributionDonut').then((m) => m.RepDistributionDonut),
  { ssr: false, loading: () => <ChartSkeleton height={410} /> }
)

const REP_COLORS: Record<string, string> = {
  'Sarah Mitchell': '#1E98D5',
  'James Thornton': '#0FA62C',
  'Maria Gonzalez': '#1C3C6E',
  'David Kim': '#A0007E',
  'Lisa Chen': '#E89C0C',
}

type ColorMode = 'status' | 'rep'
type RegionSortKey = 'region' | 'customerCount' | 'activeCustomers' | 'totalRevenue' | 'avgOrderValue' | 'growth'

type TerritoryDashboardResponse = {
  customers: Customer[]
  regions: SeedRegionSummary[]
  stats: ClientMapStats
}

export default function TerritoryPage() {
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [regions, setRegions] = useState<SeedRegionSummary[]>([])
  const [stats, setStats] = useState<ClientMapStats | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>()
  const [colorBy, setColorBy] = useState<ColorMode>('status')
  const [regionSort, setRegionSort] = useState<RegionSortKey>('totalRevenue')
  const [regionSortAsc, setRegionSortAsc] = useState(false)

  useEffect(() => {
    async function loadData() {
      try {
        const data = await fetchJson<TerritoryDashboardResponse>('/api/dashboard/territory')
        setCustomers(data.customers)
        setRegions(data.regions)
        setStats(data.stats)
      } catch (error) {
        console.error('Failed to load territory data:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const handleCustomerClick = useCallback((customer: Customer) => {
    setSelectedCustomerId(customer.id)
  }, [])

  const handleRegionSort = (key: RegionSortKey) => {
    if (regionSort === key) {
      setRegionSortAsc(!regionSortAsc)
    } else {
      setRegionSort(key)
      setRegionSortAsc(false)
    }
  }

  const sortedRegions = [...regions].sort((a, b) => {
    const multiplier = regionSortAsc ? 1 : -1
    if (regionSort === 'region') return a.region.localeCompare(b.region) * multiplier
    return ((a[regionSort] as number) - (b[regionSort] as number)) * multiplier
  })

  // Build rep distribution for donut
  const repDistribution = Object.entries(
    customers.reduce((acc, c) => {
      acc[c.assignedRep] = (acc[c.assignedRep] || { count: 0, revenue: 0 })
      acc[c.assignedRep].count++
      acc[c.assignedRep].revenue += c.totalRevenue
      return acc
    }, {} as Record<string, { count: number; revenue: number }>)
  ).map(([name, data]) => ({
    name,
    value: data.count,
    revenue: data.revenue,
    color: REP_COLORS[name] || '#576671',
  })).sort((a, b) => b.value - a.value)

  if (loading || !stats) {
    return (
      <div className="flex flex-col">
        <Header title="Territory" />
        <div className="flex h-64 items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  if (customers.length === 0) {
    return (
      <div className="flex flex-col">
        <Header title="Territory" />
        <div className="p-4 md:p-6">
          <Card>
            <CardContent>
              <ComingSoonPanel
                title="Territory mapping"
                description="Live geocoded Salesforce account locations are not available yet."
              />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const SortHeader = ({ label, field, className: cls }: { label: string; field: RegionSortKey; className?: string }) => (
    <TableHead
      className={cn('cursor-pointer select-none transition-colors hover:text-card-foreground', cls)}
      onClick={() => handleRegionSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn('h-3 w-3', regionSort === field ? 'text-medship-primary' : 'text-muted-foreground/40')} />
      </span>
    </TableHead>
  )

  return (
    <div className="flex flex-col">
      <Header title="Territory" />

      <div className="space-y-6 p-4 md:p-6">
        {/* Row 1 — KPI Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Total Clients"
            value={stats.totalClients}
            icon={Users}
            iconColor="text-medship-primary"
          />
          <KpiCard
            title="Active Clients"
            value={stats.activeClients}
            change={4.2}
            changeLabel="vs last quarter"
            icon={UserCheck}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="States Covered"
            value={stats.statesCovered}
            icon={MapPin}
            iconColor="text-medship-info"
          />
          <KpiCard
            title="Avg Revenue/Client"
            value={`$${stats.avgRevenuePerClient.toLocaleString()}`}
            change={6.8}
            changeLabel="vs last quarter"
            icon={DollarSign}
            iconColor="text-medship-secondary"
          />
        </div>

        {/* Row 2 — Map + Territory List */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle>Client Map</CardTitle>
                <div className="flex gap-1 rounded-lg bg-muted/60 p-0.5">
                  <button
                    onClick={() => setColorBy('status')}
                    className={cn(
                      'rounded-md px-3 py-1 text-[0.7rem] font-medium transition-colors',
                      colorBy === 'status' ? 'bg-white text-card-foreground shadow-sm dark:bg-card' : 'text-muted-foreground'
                    )}
                  >
                    By Status
                  </button>
                  <button
                    onClick={() => setColorBy('rep')}
                    className={cn(
                      'rounded-md px-3 py-1 text-[0.7rem] font-medium transition-colors',
                      colorBy === 'rep' ? 'bg-white text-card-foreground shadow-sm dark:bg-card' : 'text-muted-foreground'
                    )}
                  >
                    By Rep
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <ClientMap
                  customers={customers}
                  height="500px"
                  colorBy={colorBy}
                  interactive={true}
                  showClusters={true}
                  onCustomerClick={handleCustomerClick}
                  selectedCustomerId={selectedCustomerId}
                  fitBounds={true}
                />
                {/* Legend */}
                <div className="mt-3 flex flex-wrap gap-3">
                  {colorBy === 'status' ? (
                    <>
                      <span className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#22c55e]" /> Active</span>
                      <span className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#9ca3af]" /> Inactive</span>
                      <span className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#3b82f6]" /> Prospect</span>
                    </>
                  ) : (
                    Object.entries(REP_COLORS).map(([name, color]) => (
                      <span key={name} className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                        {name}
                      </span>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-4">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Client Directory</CardTitle>
              </CardHeader>
              <CardContent className="h-[580px]">
                <TerritoryList
                  customers={customers}
                  onCustomerClick={handleCustomerClick}
                  selectedCustomerId={selectedCustomerId}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Row 3 — Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RevenueByRegionChart data={regions} />
          <RepDistributionDonut data={repDistribution} />
        </div>

        {/* Row 4 — Region Breakdown Table */}
        <Card>
          <CardHeader>
            <CardTitle>Region Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortHeader label="Region" field="region" />
                  <SortHeader label="Clients" field="customerCount" className="text-center" />
                  <SortHeader label="Active" field="activeCustomers" className="text-center" />
                  <TableHead className="text-center">Inactive</TableHead>
                  <TableHead className="text-center">Prospects</TableHead>
                  <SortHeader label="Revenue" field="totalRevenue" className="text-right" />
                  <SortHeader label="Avg Order Value" field="avgOrderValue" className="text-right" />
                  <TableHead>Top Rep</TableHead>
                  <SortHeader label="YoY Growth" field="growth" className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRegions.map((r) => {
                  const inactive = r.customerCount - r.activeCustomers
                  const prospects = customers.filter(c => c.region === r.region && c.customerStatus === 'prospect').length
                  const actualInactive = inactive - prospects

                  return (
                    <TableRow key={r.region}>
                      <TableCell className="font-semibold text-card-foreground">{r.region}</TableCell>
                      <TableCell className="text-center">{r.customerCount}</TableCell>
                      <TableCell className="text-center font-medium text-emerald-600">{r.activeCustomers}</TableCell>
                      <TableCell className="text-center text-muted-foreground">{actualInactive}</TableCell>
                      <TableCell className="text-center text-blue-500">{prospects}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">${r.totalRevenue.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">${r.avgOrderValue.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <div
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.45rem] font-bold text-white"
                            style={{ backgroundColor: REP_COLORS[r.topRep] || '#576671' }}
                          >
                            {r.topRep.split(' ').map(n => n[0]).join('')}
                          </div>
                          <span className="text-[0.8rem]">{r.topRep}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn(
                          'inline-flex items-center gap-0.5 font-semibold',
                          r.growth >= 0 ? 'text-emerald-600' : 'text-red-500'
                        )}>
                          {r.growth >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                          {Math.abs(r.growth)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
