'use client'

import { useEffect, useState, useCallback } from 'react'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { ClientMap } from '@/components/dashboard/ClientMap'
import { TerritoryList } from '@/components/dashboard/TerritoryList'
import { RevenueByRegionChart } from '@/components/charts/RevenueByRegionChart'
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
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts'
import {
  getCustomersWithLocations,
  getRegionSummaries,
  getClientMapStats,
} from '@/lib/data'
import type { ClientMapStats } from '@/lib/data'
import type { Customer, SeedRegionSummary } from '@/lib/seed-data'

const REP_COLORS: Record<string, string> = {
  'Sarah Mitchell': '#452B90',
  'James Thornton': '#3A9B94',
  'Maria Gonzalez': '#F8B940',
  'David Kim': '#58BAD7',
  'Lisa Chen': '#FF9F00',
}

type ColorMode = 'status' | 'rep'
type RegionSortKey = 'region' | 'customerCount' | 'activeCustomers' | 'totalRevenue' | 'avgOrderValue' | 'growth'

function RepDonutTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; payload?: { revenue?: number } }>
}) {
  if (!active || !payload || payload.length === 0) return null
  const entry = payload[0]
  return (
    <div className="rounded-[0.625rem] border border-[#E6E6E6] bg-white px-4 py-3 shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]">
      <p className="text-[0.813rem] font-medium text-[#374557]">{entry.name}</p>
      <p className="text-[0.75rem] text-[#888]">
        Clients: <span className="font-semibold text-[#374557]">{entry.value}</span>
      </p>
      <p className="text-[0.75rem] text-[#888]">
        Revenue: <span className="font-semibold text-[#452B90]">${(entry.payload?.revenue || 0).toLocaleString()}</span>
      </p>
    </div>
  )
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
        const [customersData, regionsData, statsData] = await Promise.all([
          getCustomersWithLocations(),
          getRegionSummaries(),
          getClientMapStats(),
        ])
        setCustomers(customersData)
        setRegions(regionsData)
        setStats(statsData)
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
    color: REP_COLORS[name] || '#888',
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

      <div className="space-y-6 p-6">
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
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
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
          <Card>
            <CardHeader>
              <CardTitle>Client Distribution by Rep</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={repDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {repDistribution.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<RepDonutTooltip />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '0.75rem', fontFamily: 'Poppins' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
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
                            style={{ backgroundColor: REP_COLORS[r.topRep] || '#888' }}
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
