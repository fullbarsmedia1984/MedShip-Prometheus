'use client'

import { useState, useEffect, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { DataTable } from '@/components/dashboard/DataTable'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Package, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { getInventory, getInventoryKpis } from '@/lib/data'
import type { PaginatedResult, InventoryKpis } from '@/lib/data'
import type { Product } from '@/lib/seed-data'
import { cn } from '@/lib/utils'

interface Filters {
  category: string
  stockStatus: string
  search: string
  page: number
}

function getStockStatus(product: Product): { label: string; variant: 'success' | 'warning' | 'danger' } {
  if (product.qtyAvailable <= 0) {
    return { label: 'Out of Stock', variant: 'danger' }
  }
  if (product.qtyAvailable <= product.reorderPoint) {
    return { label: 'Low Stock', variant: 'warning' }
  }
  return { label: 'In Stock', variant: 'success' }
}

function formatRelativeTime(isoString: string): string {
  const now = new Date('2026-03-31T12:00:00Z')
  const then = new Date(isoString)
  const diffMs = now.getTime() - then.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}

const CATEGORIES = [
  'Capital Equipment',
  'Simulation',
  'Supplies',
  'Kits',
  'Diagnostics',
  'Consumables',
] as const

export default function InventoryPage() {
  const [filters, setFilters] = useState<Filters>({
    category: 'all',
    stockStatus: 'all',
    search: '',
    page: 1,
  })
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [result, setResult] = useState<PaginatedResult<Product> | null>(null)
  const [kpis, setKpis] = useState<InventoryKpis | null>(null)
  const [loading, setLoading] = useState(true)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search)
    }, 300)
    return () => clearTimeout(timer)
  }, [filters.search])

  // Load KPIs on mount
  useEffect(() => {
    getInventoryKpis().then(setKpis)
  }, [])

  // Fetch inventory on filter change
  const fetchInventory = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getInventory({
        category: filters.category,
        stockStatus: filters.stockStatus as 'all' | 'in_stock' | 'low' | 'out_of_stock',
        search: debouncedSearch,
        page: filters.page,
        pageSize: 20,
      })
      setResult(data)
    } finally {
      setLoading(false)
    }
  }, [filters.category, filters.stockStatus, debouncedSearch, filters.page])

  useEffect(() => {
    fetchInventory()
  }, [fetchInventory])

  // Reset page on filter change
  useEffect(() => {
    setFilters((prev) => ({ ...prev, page: 1 }))
  }, [filters.category, filters.stockStatus, debouncedSearch])

  const columns = [
    {
      key: 'sku',
      label: 'SKU',
      render: (value: string) => <span className="font-mono text-sm">{value}</span>,
    },
    {
      key: 'name',
      label: 'Product Name',
      render: (value: string) => <span className="text-sm font-medium">{value}</span>,
    },
    {
      key: 'category',
      label: 'Category',
      render: (value: string) => <span className="text-sm text-muted-foreground">{value}</span>,
    },
    {
      key: 'qtyOnHand',
      label: 'On Hand',
      className: 'text-right',
      render: (value: number) => <span className="text-sm tabular-nums">{value}</span>,
    },
    {
      key: 'qtyAllocated',
      label: 'Allocated',
      className: 'text-right',
      render: (value: number) => <span className="text-sm tabular-nums">{value}</span>,
    },
    {
      key: 'qtyAvailable',
      label: 'Available',
      className: 'text-right',
      render: (value: number, row: Product) => {
        const colorClass =
          value <= 0
            ? 'text-medship-danger font-semibold'
            : value <= row.reorderPoint
              ? 'text-medship-warning font-semibold'
              : 'text-foreground'
        return <span className={cn('text-sm tabular-nums', colorClass)}>{value}</span>
      },
    },
    {
      key: 'reorderPoint',
      label: 'Reorder Pt',
      className: 'text-right',
      render: (value: number) => <span className="text-sm tabular-nums text-muted-foreground">{value}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (_value: unknown, row: Product) => {
        const stock = getStockStatus(row)
        return <StatusBadge status={stock.label} />
      },
    },
    {
      key: 'lastSyncedAt',
      label: 'Last Synced',
      render: (value: string) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatRelativeTime(value)}
        </span>
      ),
    },
  ]

  return (
    <>
      <Header title="Inventory" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total SKUs"
            value={kpis?.totalSkus ?? 0}
            icon={Package}
          />
          <KpiCard
            title="In Stock"
            value={kpis?.inStock ?? 0}
            icon={CheckCircle}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="Low Stock"
            value={kpis?.lowStock ?? 0}
            icon={AlertTriangle}
            iconColor="text-medship-warning"
          />
          <KpiCard
            title="Out of Stock"
            value={kpis?.outOfStock ?? 0}
            icon={XCircle}
            iconColor="text-medship-danger"
          />
        </div>

        {/* Filters bar */}
        <Card className="shadow-sm">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder="Search by product name or SKU..."
                value={filters.search}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, search: e.target.value }))
                }
                className="w-full sm:w-64"
              />
              <Select
                value={filters.category}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, category: value ?? 'all' }))
                }
              >
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.stockStatus}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, stockStatus: value ?? 'all' }))
                }
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Stock Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stock Status</SelectItem>
                  <SelectItem value="in_stock">In Stock</SelectItem>
                  <SelectItem value="low">Low Stock</SelectItem>
                  <SelectItem value="out_of_stock">Out of Stock</SelectItem>
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
                <span className="ml-2 text-sm text-muted-foreground">Loading inventory...</span>
              </div>
            ) : result ? (
              <DataTable
                columns={columns}
                data={result.data}
                totalItems={result.total}
                page={result.page}
                pageSize={result.pageSize}
                onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
                emptyMessage="No products match your filters"
              />
            ) : null}
          </CardContent>
        </Card>
      </main>
    </>
  )
}
