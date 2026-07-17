'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { DataTable } from '@/components/dashboard/DataTable'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { InventoryAnalytics, type ChartDrill } from '@/components/inventory/InventoryAnalytics'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { X } from 'lucide-react'
import { fetchJson } from '@/lib/client-api'
import type { PaginatedResult, InventoryKpis } from '@/lib/data'
import type { InboundBucketKey, OutboundDay } from '@/lib/inventory/analytics'
import type { Product } from '@/lib/seed-data'
import { cn } from '@/lib/utils'

interface Filters {
  category: string
  stockStatus: string
  search: string
  sort: string
  inboundBucket: InboundBucketKey | ''
  page: number
}

const SORT_OPTIONS = [
  { value: 'sku:asc', label: 'SKU A–Z' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'qtyAvailable:asc', label: 'Available: low first' },
  { value: 'qtyAvailable:desc', label: 'Available: high first' },
  { value: 'qtyOnHand:asc', label: 'On hand: low first' },
  { value: 'qtyOnHand:desc', label: 'On hand: high first' },
] as const

type InventoryDashboardResponse = {
  result: PaginatedResult<Product>
  kpis: InventoryKpis
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
  const now = new Date()
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
    sort: 'sku:asc',
    inboundBucket: '',
    page: 1,
  })
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [result, setResult] = useState<PaginatedResult<Product> | null>(null)
  const [loading, setLoading] = useState(true)
  // Chart-driven state: a chip describing the active drill filter, and the
  // shipment detail for a clicked Outbound Velocity day.
  const [drillChip, setDrillChip] = useState<string | null>(null)
  const [dayDetail, setDayDetail] = useState<OutboundDay | null>(null)

  const handleDrill = useCallback((drill: ChartDrill) => {
    if (drill.type === 'part') {
      const p = drill.part
      setFilters((prev) => ({
        ...prev,
        search: p.part,
        sort: 'qtyAvailable:asc',
        inboundBucket: '',
        page: 1,
      }))
      const coverage =
        p.onOrder > 0
          ? `${p.onOrder.toLocaleString()} on order${p.eta ? `, ETA ${p.eta}` : ''}`
          : 'NO PO'
      setDrillChip(
        `Shortage ${p.part}: ${p.short.toLocaleString()} short · ${p.onHand.toLocaleString()} on hand · ${coverage} · ${p.sos} SOs`
      )
    } else if (drill.type === 'bucket') {
      setFilters((prev) => ({
        ...prev,
        search: '',
        inboundBucket: drill.key,
        sort: 'qtyAvailable:asc',
        page: 1,
      }))
      setDrillChip(`Inbound: ${drill.label} — parts with POs landing in this window`)
    } else {
      setDayDetail(drill.day)
    }
  }, [])

  const clearDrill = useCallback(() => {
    setDrillChip(null)
    setFilters((prev) => ({ ...prev, search: '', inboundBucket: '', sort: 'sku:asc', page: 1 }))
  }, [])

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search)
    }, 300)
    return () => clearTimeout(timer)
  }, [filters.search])

  // Fetch inventory on filter change
  const fetchInventory = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        category: filters.category,
        stockStatus: filters.stockStatus,
        search: debouncedSearch,
        sort: filters.sort,
        page: String(filters.page),
        pageSize: '20',
      })
      if (filters.inboundBucket) params.set('inboundBucket', filters.inboundBucket)
      const data = await fetchJson<InventoryDashboardResponse>(`/api/dashboard/inventory?${params}`)
      setResult(data.result)
    } finally {
      setLoading(false)
    }
  }, [filters.category, filters.stockStatus, debouncedSearch, filters.sort, filters.inboundBucket, filters.page])

  useEffect(() => {
    fetchInventory()
  }, [fetchInventory])

  // Reset page on filter change
  useEffect(() => {
    setFilters((prev) => ({ ...prev, page: 1 }))
  }, [filters.category, filters.stockStatus, debouncedSearch, filters.sort, filters.inboundBucket])

  const columns = [
    {
      key: 'sku',
      label: 'SKU',
      render: (value: string, row: Product) => (
        <Link
          href={`/dashboard/inventory/${encodeURIComponent(row.id)}`}
          className="font-mono text-sm text-medship-primary hover:underline"
        >
          {value}
        </Link>
      ),
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
        {/* Warehouse analytics band: stock health, committed demand,
            shortages w/ PO coverage, inbound pipeline, outbound velocity.
            Bar clicks drill into the table via handleDrill. */}
        <InventoryAnalytics onDrill={handleDrill} />

        {/* Outbound day drill-down: the SOs that shipped that day */}
        {dayDetail && (
          <Card className="border-medship-success/40 shadow-sm">
            <CardContent className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-card-foreground">
                  Shipped {dayDetail.label}
                </span>
                <span className="rounded-full bg-medship-success/10 px-2 py-0.5 text-xs font-medium text-medship-success">
                  {dayDetail.shipments} shipment{dayDetail.shipments === 1 ? '' : 's'} · {dayDetail.cartons} cartons
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {dayDetail.ships.length === 0 ? (
                  <span className="text-sm text-muted-foreground">No shipments this day</span>
                ) : (
                  dayDetail.ships.map((s, i) => (
                    <span
                      key={`${s.so}-${i}`}
                      className="rounded-md border border-[#D6DEE3] px-2 py-0.5 font-mono text-xs text-medship-primary-dark dark:border-[rgba(255,255,255,0.1)] dark:text-medship-primary-light"
                      title={`${s.cartons} carton${s.cartons === 1 ? '' : 's'}`}
                    >
                      {s.so}
                    </span>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => setDayDetail(null)}
                className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Dismiss shipped-day detail"
              >
                <X className="h-4 w-4" />
              </button>
            </CardContent>
          </Card>
        )}

        {/* Filters bar */}
        <Card className="shadow-sm">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder="Search by product name or SKU..."
                value={filters.search}
                onChange={(e) => {
                  setDrillChip(null)
                  setFilters((prev) => ({ ...prev, search: e.target.value }))
                }}
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
              <Select
                value={filters.sort}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, sort: value ?? 'sku:asc' }))
                }
              >
                <SelectTrigger className="w-full sm:w-52">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      Sort: {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {drillChip && (
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-medship-primary/10 px-3 py-1 text-xs font-medium text-medship-primary-dark dark:text-medship-primary-light">
                  <span className="truncate">{drillChip}</span>
                  <button
                    type="button"
                    onClick={clearDrill}
                    className="shrink-0 rounded-full p-0.5 hover:bg-medship-primary/20"
                    aria-label="Clear chart filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
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
