'use client'

import { useState, useEffect, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { DataTable } from '@/components/dashboard/DataTable'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ShoppingCart, DollarSign, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react'
import { getOrders, getSalesReps } from '@/lib/data'
import type { Order, SalesRep } from '@/lib/seed-data'
import type { PaginatedResult } from '@/lib/data'
import { cn } from '@/lib/utils'

interface Filters {
  status: string
  salesRepId: string
  search: string
  page: number
}

function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function OrdersPage() {
  const [filters, setFilters] = useState<Filters>({
    status: 'all',
    salesRepId: 'all',
    search: '',
    page: 1,
  })
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [result, setResult] = useState<PaginatedResult<Order> | null>(null)
  const [salesReps, setSalesReps] = useState<SalesRep[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search)
    }, 300)
    return () => clearTimeout(timer)
  }, [filters.search])

  // Load sales reps on mount
  useEffect(() => {
    getSalesReps().then(setSalesReps)
  }, [])

  // Fetch orders on filter change
  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getOrders({
        status: filters.status,
        salesRepId: filters.salesRepId,
        search: debouncedSearch,
        page: filters.page,
        pageSize: 20,
      })
      setResult(data)
    } finally {
      setLoading(false)
    }
  }, [filters.status, filters.salesRepId, debouncedSearch, filters.page])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // Reset page when filters change
  useEffect(() => {
    setFilters((prev) => ({ ...prev, page: 1 }))
  }, [filters.status, filters.salesRepId, debouncedSearch])

  // Compute summary stats from current result set
  const totalOrders = result?.total ?? 0
  const totalRevenue = result?.data.reduce((sum, o) => sum + o.subtotal, 0) ?? 0
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0

  const columns = [
    {
      key: 'orderNumber',
      label: 'Order #',
      render: (value: string, row: Order) => (
        <div className="flex items-center gap-1.5">
          {expandedRow === row.id ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="font-mono text-sm">{value}</span>
        </div>
      ),
    },
    {
      key: 'date',
      label: 'Date',
      render: (value: string) => (
        <span className="text-sm whitespace-nowrap">{formatDate(value)}</span>
      ),
    },
    {
      key: 'customerName',
      label: 'Customer',
      render: (value: string) => (
        <span className="text-sm max-w-[200px] truncate block" title={value}>
          {value}
        </span>
      ),
    },
    {
      key: 'salesRepName',
      label: 'Sales Rep',
      render: (value: string) => <span className="text-sm whitespace-nowrap">{value}</span>,
    },
    {
      key: 'items',
      label: 'Items',
      render: (_value: unknown, row: Order) => (
        <span className="text-sm">{row.items.length}</span>
      ),
    },
    {
      key: 'subtotal',
      label: 'Subtotal',
      render: (value: number) => (
        <span className="text-sm font-medium whitespace-nowrap">{formatCurrency(value)}</span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      key: 'fulfillmentStatus',
      label: 'Fulfillment',
      render: (value: string) => <StatusBadge status={value} variant="dot" />,
    },
    {
      key: 'trackingNumber',
      label: 'Tracking #',
      render: (value: string | undefined) =>
        value ? (
          <span className="font-mono text-xs">{value}</span>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        ),
    },
  ]

  const renderExpanded = (row: Order) => (
    <div className="bg-muted/50 p-4">
      <h4 className="text-sm font-semibold mb-3 text-foreground">Line Items</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-2 pr-4 font-medium text-muted-foreground">Product</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground">SKU</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Qty</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Unit Price</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {row.items.map((item, idx) => (
              <tr key={idx} className={cn(idx % 2 === 0 && 'bg-muted/30', 'border-b border-border/50')}>
                <td className="py-1.5 pr-4">{item.productName}</td>
                <td className="py-1.5 pr-4 font-mono text-xs">{item.sku}</td>
                <td className="py-1.5 pr-4 text-right">{item.quantity}</td>
                <td className="py-1.5 pr-4 text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="py-1.5 text-right font-medium">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={4} className="pt-2 pr-4 text-right">Subtotal</td>
              <td className="pt-2 text-right">{formatCurrency(row.subtotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )

  return (
    <>
      <Header title="Orders" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* Summary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            title="Total Orders"
            value={totalOrders}
            icon={ShoppingCart}
          />
          <KpiCard
            title="Total Revenue"
            value={formatCurrency(totalRevenue)}
            icon={DollarSign}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="Avg Order Value"
            value={formatCurrency(avgOrderValue)}
            icon={TrendingUp}
            iconColor="text-medship-info"
          />
        </div>

        {/* Filters bar */}
        <Card className="shadow-sm">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder="Search by customer or order #..."
                value={filters.search}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, search: e.target.value }))
                }
                className="w-full sm:w-64"
              />
              <Select
                value={filters.status}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, status: value ?? 'all' }))
                }
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="Closed Won">Closed Won</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Shipped">Shipped</SelectItem>
                  <SelectItem value="Delivered">Delivered</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.salesRepId}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, salesRepId: value ?? 'all' }))
                }
              >
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Sales Rep" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sales Reps</SelectItem>
                  {salesReps.map((rep) => (
                    <SelectItem key={rep.id} value={rep.id}>
                      {rep.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Data table */}
        <Card className="shadow-sm">
          <CardContent className="pt-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-medship-primary border-t-transparent" />
                <span className="ml-2 text-sm text-muted-foreground">Loading orders...</span>
              </div>
            ) : result ? (
              <DataTable
                columns={columns}
                data={result.data}
                totalItems={result.total}
                page={result.page}
                pageSize={result.pageSize}
                onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
                onRowClick={(row) =>
                  setExpandedRow((prev) => (prev === row.id ? null : row.id))
                }
                expandedRow={expandedRow}
                renderExpanded={renderExpanded}
                emptyMessage="No orders match your filters"
              />
            ) : null}
          </CardContent>
        </Card>
      </main>
    </>
  )
}
