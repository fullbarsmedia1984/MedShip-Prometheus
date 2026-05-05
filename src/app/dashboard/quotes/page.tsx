'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Clock3, DollarSign, FileText } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { DataTable } from '@/components/dashboard/DataTable'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { QuoteStatusBadge } from '@/components/dashboard/QuoteStatusBadge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fetchJson } from '@/lib/client-api'
import type { PaginatedResult } from '@/lib/data'
import type { SeedQuote } from '@/lib/seed-data'

type Filters = {
  status: string
  search: string
  page: number
}

type QuoteSummary = {
  total: number
  totalAmount: number
  accepted: number
  avgDaysOpen: number
  statusCounts: Record<SeedQuote['status'], number>
}

type QuotesDashboardResponse = {
  result: PaginatedResult<SeedQuote>
  summary: QuoteSummary
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function formatDate(dateStr: string): string {
  if (!dateStr) return 'Not available'

  const date = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 'Not available'

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function hasActiveFilters(filters: Filters, debouncedSearch: string): boolean {
  return filters.status !== 'all' || debouncedSearch.trim().length > 0
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All Statuses' },
  { value: 'sent', label: 'Sent' },
  { value: 'viewed', label: 'Viewed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'expired', label: 'Expired' },
  { value: 'rejected', label: 'Rejected' },
]

export default function QuotesPage() {
  const [filters, setFilters] = useState<Filters>({
    status: 'all',
    search: '',
    page: 1,
  })
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [result, setResult] = useState<PaginatedResult<SeedQuote> | null>(null)
  const [summary, setSummary] = useState<QuoteSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search)
    }, 300)

    return () => clearTimeout(timer)
  }, [filters.search])

  const fetchQuotes = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        status: filters.status,
        search: debouncedSearch,
        page: String(filters.page),
        pageSize: '20',
      })
      const data = await fetchJson<QuotesDashboardResponse>(`/api/dashboard/quotes?${params}`)

      setResult(data.result)
      setSummary(data.summary)
    } catch (err) {
      setResult(null)
      setSummary(null)
      setError(err instanceof Error ? err.message : 'Unable to load quotes')
    } finally {
      setLoading(false)
    }
  }, [filters.status, debouncedSearch, filters.page])

  useEffect(() => {
    fetchQuotes()
  }, [fetchQuotes])

  useEffect(() => {
    setFilters((prev) => ({ ...prev, page: 1 }))
  }, [filters.status, debouncedSearch])

  const activeFilters = hasActiveFilters(filters, debouncedSearch)
  const hasLiveQuotes = (summary?.total ?? 0) > 0

  const columns = [
    {
      key: 'id',
      label: 'Quote #',
      render: (value: string) => (
        <Link
          href={`/dashboard/quotes/${encodeURIComponent(value)}`}
          className="font-mono text-sm text-medship-primary hover:underline"
        >
          {value}
        </Link>
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
        <span className="block max-w-[280px] truncate text-sm font-medium" title={value}>
          {value}
        </span>
      ),
    },
    {
      key: 'repName',
      label: 'Sales Rep',
      render: (value: string) => (
        <span className="text-sm whitespace-nowrap">{value}</span>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      className: 'text-right',
      render: (value: number) => (
        <span className="text-sm font-medium tabular-nums whitespace-nowrap">{formatCurrency(value)}</span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (value: SeedQuote['status']) => <QuoteStatusBadge status={value} />,
    },
    {
      key: 'daysOpen',
      label: 'Days Open',
      className: 'text-right',
      render: (value: number) => (
        <span className="text-sm tabular-nums text-muted-foreground">{value}d</span>
      ),
    },
  ]

  return (
    <>
      <Header title="Quotes" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Live Quotes" value={summary?.total ?? 0} icon={FileText} />
          <KpiCard
            title="Quote Value"
            value={formatCurrency(summary?.totalAmount ?? 0)}
            icon={DollarSign}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="Accepted"
            value={summary?.accepted ?? 0}
            icon={CheckCircle2}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="Avg Days Open"
            value={`${summary?.avgDaysOpen ?? 0}d`}
            icon={Clock3}
            iconColor="text-medship-warning"
          />
        </div>

        <Card className="shadow-sm">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder="Search by quote, customer, or rep..."
                value={filters.search}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, search: event.target.value }))
                }
                className="w-full sm:w-72"
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
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="pt-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-medship-primary border-t-transparent" />
                <span className="ml-2 text-sm text-muted-foreground">Loading quotes...</span>
              </div>
            ) : error ? (
              <EmptyState icon={FileText} title="Quotes unavailable" description={error} />
            ) : !hasLiveQuotes && !activeFilters ? (
              <ComingSoonPanel
                title="Quote module"
                description="No live canonical Fishbowl quote rows are available yet."
              />
            ) : result ? (
              <DataTable
                columns={columns}
                data={result.data}
                totalItems={result.total}
                page={result.page}
                pageSize={result.pageSize}
                onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
                emptyMessage="No quotes match your filters"
              />
            ) : null}
          </CardContent>
        </Card>
      </main>
    </>
  )
}
