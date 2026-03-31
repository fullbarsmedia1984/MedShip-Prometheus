'use client'

import { useState, useEffect, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { DataTable } from '@/components/dashboard/DataTable'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { RefreshIndicator } from '@/components/dashboard/RefreshIndicator'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { List, CheckCircle, Clock, AlertTriangle } from 'lucide-react'
import { getSyncEvents, getEventKpis } from '@/lib/data'
import type { SyncEvent } from '@/types'
import { AUTOMATION_INFO, type AutomationType } from '@/types'
import { cn } from '@/lib/utils'
import { useSearchParams } from 'next/navigation'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string): string {
  const now = new Date('2026-03-31T12:00:00Z')
  const then = new Date(isoString)
  const diffMs = now.getTime() - then.getTime()
  if (diffMs < 0) return 'just now'

  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  return `${diffDays}d ago`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25
const automationKeys = Object.keys(AUTOMATION_INFO) as AutomationType[]
const statusOptions = ['pending', 'success', 'failed', 'retrying'] as const

export default function EventsPage() {
  const searchParams = useSearchParams()

  // Filters
  const [automationFilter, setAutomationFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)

  // Data
  const [events, setEvents] = useState<SyncEvent[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [kpis, setKpis] = useState({ total: 0, successRate: 0, avgDurationMs: 0, failuresToday: 0 })
  const [loading, setLoading] = useState(true)

  // Expanded row
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | undefined>()

  // Read URL search params on mount
  useEffect(() => {
    const urlAutomation = searchParams.get('automation')
    if (urlAutomation && automationKeys.includes(urlAutomation as AutomationType)) {
      setAutomationFilter(urlAutomation)
    }
  }, [searchParams])

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const [eventsResult, kpisResult] = await Promise.all([
        getSyncEvents({
          automation: automationFilter !== 'all' ? automationFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          search: searchQuery || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
        getEventKpis(),
      ])
      setEvents(eventsResult.data)
      setTotalItems(eventsResult.total)
      setKpis(kpisResult)
      setLastRefreshed(new Date())
    } finally {
      setLoading(false)
    }
  }, [automationFilter, statusFilter, searchQuery, page])

  useEffect(() => {
    setLoading(true)
    fetchData()
  }, [fetchData])

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => {
      fetchData()
    }, 30_000)
    return () => clearInterval(timer)
  }, [autoRefresh, fetchData])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [automationFilter, statusFilter, searchQuery])

  // Table columns
  const columns = [
    {
      key: 'created_at',
      label: 'Timestamp',
      render: (value: string) => (
        <span className="text-xs" title={value}>
          {formatRelativeTime(value)}
        </span>
      ),
    },
    {
      key: 'automation',
      label: 'Automation',
      render: (value: AutomationType) => (
        <span className="text-xs font-medium">
          {AUTOMATION_INFO[value]?.name ?? value}
        </span>
      ),
    },
    {
      key: 'source_system',
      label: 'Direction',
      render: (_value: string, row: SyncEvent) => (
        <span className="text-xs">
          {capitalize(row.source_system)} &rarr; {capitalize(row.target_system)}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      key: 'source_record_id',
      label: 'Source Record',
      render: (value: string | null) => (
        <span className="max-w-[120px] truncate font-mono text-xs" title={value ?? ''}>
          {value ?? '-'}
        </span>
      ),
    },
    {
      key: 'target_record_id',
      label: 'Target Record',
      render: (value: string | null) => (
        <span className="max-w-[120px] truncate font-mono text-xs" title={value ?? ''}>
          {value ?? '-'}
        </span>
      ),
    },
    {
      key: 'completed_at',
      label: 'Duration',
      render: (_value: string | null, row: SyncEvent) => {
        if (!row.completed_at) return <span className="text-xs text-muted-foreground">-</span>
        const ms = new Date(row.completed_at).getTime() - new Date(row.created_at).getTime()
        return <span className="text-xs">{ms} ms</span>
      },
    },
    {
      key: 'retry_count',
      label: 'Retry #',
      render: (value: number, row: SyncEvent) => (
        <span className="text-xs">{value}/{row.max_retries}</span>
      ),
    },
  ]

  return (
    <div className="flex flex-col">
      <Header title="Event Log" />

      <div className="space-y-6 p-6">
        {/* KPI Stats Bar */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Total Events"
            value={kpis.total}
            icon={List}
            iconColor="text-medship-primary"
          />
          <KpiCard
            title="Success Rate"
            value={`${kpis.successRate}%`}
            icon={CheckCircle}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="Avg Duration"
            value={`${kpis.avgDurationMs} ms`}
            icon={Clock}
            iconColor="text-medship-info"
          />
          <KpiCard
            title="Failures Today"
            value={kpis.failuresToday}
            icon={AlertTriangle}
            iconColor="text-medship-danger"
          />
        </div>

        {/* Auto-refresh + Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <RefreshIndicator
            enabled={autoRefresh}
            intervalSeconds={30}
            onToggle={setAutoRefresh}
            lastRefreshed={lastRefreshed}
          />

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <div className="w-56">
              <Select
                value={automationFilter}
                onValueChange={(v) => setAutomationFilter(v ?? 'all')}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Automation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Automations</SelectItem>
                  {automationKeys.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AUTOMATION_INFO[a].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-40">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v ?? 'all')}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {capitalize(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Input
              className="w-64 text-xs"
              placeholder="Search record ID or error..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Data Table */}
        {loading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading...
          </div>
        ) : (
          <DataTable<SyncEvent>
            columns={columns}
            data={events}
            totalItems={totalItems}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onRowClick={(row) =>
              setExpandedRow((prev) => (prev === row.id ? null : row.id))
            }
            expandedRow={expandedRow}
            renderExpanded={(row) => (
              <div className="space-y-3 bg-muted/50 p-4">
                {row.error_message && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-medship-danger">
                      Error Message
                    </p>
                    <p className="text-xs text-foreground">{row.error_message}</p>
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">
                      Payload
                    </p>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                      {row.payload
                        ? JSON.stringify(row.payload, null, 2)
                        : '(no payload)'}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">
                      Response
                    </p>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                      {row.response
                        ? JSON.stringify(row.response, null, 2)
                        : '(no response)'}
                    </pre>
                  </div>
                </div>
              </div>
            )}
            emptyMessage="No events match your filters"
          />
        )}
      </div>
    </div>
  )
}
