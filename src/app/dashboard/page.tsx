'use client'

import { useEffect, useState } from 'react'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { SyncStatusCard } from '@/components/dashboard/SyncStatusCard'
import { SalesLeaderboard } from '@/components/dashboard/SalesLeaderboard'
import { SalesActivityFeed } from '@/components/dashboard/SalesActivityFeed'
import { PipelineSnapshot } from '@/components/dashboard/PipelineSnapshot'
import { ClientMapPreview } from '@/components/dashboard/ClientMapPreview'
import { RevenueChart } from '@/components/charts/RevenueChart'
import { CategoryPieChart } from '@/components/charts/CategoryPieChart'
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
  ShoppingCart,
  CheckCircle,
  Clock,
  FileText,
  TrendingUp,
  Phone,
  ArrowRight,
} from 'lucide-react'
import Link from 'next/link'
import {
  getRevenueMetrics,
  getMonthlyRevenue,
  getCategorySales,
  getRecentOrders,
  getInventoryAlerts,
  getIntegrationStatus,
  getSalesLeaderboard,
  getSalesActivity,
  getPipelineSnapshot,
  getSalesKpis,
  getCustomersWithLocations,
  getRegionSummaries,
  getProfileCallMetrics,
} from '@/lib/data'
import type { RevenueMetrics, SalesKpis } from '@/lib/data'
import type { MonthlyRevenue, CategorySales, Order, Product, IntegrationStatusData, SeedSalesRep, SeedSalesActivity, SeedPipelineStage, Customer, SeedRegionSummary } from '@/lib/seed-data'
import type { AutomationType } from '@/types'

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<RevenueMetrics | null>(null)
  const [salesKpis, setSalesKpis] = useState<SalesKpis | null>(null)
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevenue[]>([])
  const [categorySales, setCategorySales] = useState<CategorySales[]>([])
  const [recentOrders, setRecentOrders] = useState<Order[]>([])
  const [inventoryAlerts, setInventoryAlerts] = useState<Product[]>([])
  const [integrations, setIntegrations] = useState<IntegrationStatusData[]>([])
  const [leaderboard, setLeaderboard] = useState<SeedSalesRep[]>([])
  const [activities, setActivities] = useState<SeedSalesActivity[]>([])
  const [pipeline, setPipeline] = useState<SeedPipelineStage[]>([])
  const [mapCustomers, setMapCustomers] = useState<Customer[]>([])
  const [regionSummaries, setRegionSummaries] = useState<SeedRegionSummary[]>([])
  const [profileCallData, setProfileCallData] = useState<{ totalMTD: number; totalLastMonth: number; conversionRate: number } | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const [
          metricsData,
          salesKpisData,
          revenueData,
          categoryData,
          ordersData,
          alertsData,
          integrationsData,
          leaderboardData,
          activitiesData,
          pipelineData,
          customersData,
          regionsData,
          profileCallsData,
        ] = await Promise.all([
          getRevenueMetrics(),
          getSalesKpis(),
          getMonthlyRevenue(),
          getCategorySales(),
          getRecentOrders(10),
          getInventoryAlerts(5),
          getIntegrationStatus(),
          getSalesLeaderboard(),
          getSalesActivity(10),
          getPipelineSnapshot(),
          getCustomersWithLocations(),
          getRegionSummaries(),
          getProfileCallMetrics(),
        ])

        setMetrics(metricsData)
        setSalesKpis(salesKpisData)
        setMonthlyRevenue(revenueData)
        setCategorySales(categoryData)
        setRecentOrders(ordersData)
        setInventoryAlerts(alertsData)
        setIntegrations(integrationsData)
        setLeaderboard(leaderboardData)
        setActivities(activitiesData)
        setPipeline(pipelineData)
        setMapCustomers(customersData)
        setRegionSummaries(regionsData)
        setProfileCallData(profileCallsData)
      } catch (error) {
        console.error('Failed to load dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  if (loading || !metrics || !salesKpis) {
    return (
      <div className="flex flex-col">
        <Header title="Dashboard" />
        <div className="flex h-64 items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <Header title="Dashboard" />

      <div className="space-y-6 p-6">
        {/* Row 1 — KPI Cards (6 total: 3x2 grid) */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            title="Revenue (MTD)"
            value={`$${metrics.mtdRevenue.toLocaleString()}`}
            change={metrics.mtdRevenueChange}
            changeLabel="vs last month"
            icon={DollarSign}
            iconColor="text-medship-primary"
          />
          <KpiCard
            title="Open Orders"
            value={metrics.openOrders}
            change={metrics.openOrdersChange}
            changeLabel="vs last month"
            icon={ShoppingCart}
            iconColor="text-medship-info"
          />
          <KpiCard
            title="Fulfillment Rate"
            value={`${metrics.fulfillmentRate.toFixed(1)}%`}
            change={metrics.fulfillmentRateChange}
            changeLabel="vs last month"
            icon={CheckCircle}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="Avg Ship Time"
            value={`${metrics.avgShipDays.toFixed(1)} days`}
            change={metrics.avgShipDaysChange}
            changeLabel="vs last month"
            icon={Clock}
            iconColor="text-medship-warning"
            invertChange
          />
          <KpiCard
            title="Quotes Sent (MTD)"
            value={salesKpis.quotesSentMTD}
            change={12.4}
            changeLabel="vs last month"
            icon={FileText}
            iconColor="text-medship-secondary"
          />
          <KpiCard
            title="Profile Calls (MTD)"
            value={profileCallData?.totalMTD ?? 0}
            change={profileCallData && profileCallData.totalLastMonth > 0
              ? Math.round(((profileCallData.totalMTD - profileCallData.totalLastMonth) / profileCallData.totalLastMonth) * 1000) / 10
              : 0}
            changeLabel="vs last month"
            icon={Phone}
            iconColor="text-medship-success"
          />
        </div>

        {/* Row 2 — Sales Leaderboard */}
        <SalesLeaderboard reps={leaderboard} />

        {/* Row 3 — Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <RevenueChart data={monthlyRevenue} />
          </div>
          <div className="lg:col-span-5">
            <CategoryPieChart data={categorySales} />
          </div>
        </div>

        {/* Row 4 — Client Map Preview */}
        <ClientMapPreview customers={mapCustomers} regionSummaries={regionSummaries} />

        {/* Row 5 — Sales Activity Feed + Pipeline Snapshot */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <SalesActivityFeed activities={activities} reps={leaderboard} />
          </div>
          <div className="lg:col-span-5">
            <PipelineSnapshot stages={pipeline} />
          </div>
        </div>

        {/* Row 5 — Recent Orders + Inventory Alerts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Recent Orders */}
          <div className="lg:col-span-7">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>Recent Orders</CardTitle>
                <Link
                  href="/dashboard/orders"
                  className="flex items-center gap-1 text-sm text-medship-primary hover:underline"
                >
                  View All
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Amount ($)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Sales Rep</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">
                          {order.orderNumber}
                        </TableCell>
                        <TableCell>{order.customerName}</TableCell>
                        <TableCell className="text-right">
                          ${order.subtotal.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={order.status} />
                        </TableCell>
                        <TableCell>{formatDate(order.date)}</TableCell>
                        <TableCell>{order.salesRepName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Inventory Alerts */}
          <div className="lg:col-span-5">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>Inventory Alerts</CardTitle>
                <Link
                  href="/dashboard/inventory"
                  className="flex items-center gap-1 text-sm text-medship-primary hover:underline"
                >
                  View All
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {inventoryAlerts.map((product) => {
                    const isOutOfStock = product.qtyAvailable <= 0
                    return (
                      <div
                        key={product.id}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {product.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            SKU: {product.sku}
                          </p>
                        </div>
                        <div className="ml-4 flex items-center gap-3">
                          <div className="text-right">
                            <p
                              className={`text-sm font-semibold ${
                                isOutOfStock
                                  ? 'text-medship-danger'
                                  : 'text-medship-warning'
                              }`}
                            >
                              {product.qtyAvailable}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              / {product.reorderPoint} min
                            </p>
                          </div>
                          <StatusBadge
                            status={isOutOfStock ? 'Out of Stock' : 'Low Stock'}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Row 6 — Integration Health */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Integration Health</CardTitle>
            <Link
              href="/dashboard/integrations"
              className="flex items-center gap-1 text-sm text-medship-primary hover:underline"
            >
              View All
              <ArrowRight className="h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              {integrations.map((integration) => (
                <SyncStatusCard
                  key={integration.automation}
                  stats={{
                    automation: integration.automation as AutomationType,
                    isActive: integration.isActive,
                    lastRunAt: integration.lastRunAt,
                    lastRunStatus: integration.status === 'healthy' ? 'success' : integration.status === 'error' ? 'failed' : 'success',
                    lastRunDurationMs: integration.lastRunDurationMs,
                    recordsProcessed: integration.recordsProcessed,
                    cronExpression: integration.schedule,
                    stats24h: {
                      total: integration.last7Days.reduce((sum, d) => sum + d.success + d.failed, 0),
                      success: integration.last7Days.reduce((sum, d) => sum + d.success, 0),
                      failed: integration.last7Days.reduce((sum, d) => sum + d.failed, 0),
                      pending: 0,
                      successRate: integration.successRate,
                    },
                  }}
                  compact
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
