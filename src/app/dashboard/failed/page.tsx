'use client'

import { useState, useEffect, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AlertTriangle, RefreshCw, X, CheckCircle2, RotateCcw } from 'lucide-react'
import { getFailedSyncs } from '@/lib/data'
import { AUTOMATION_INFO, type AutomationType } from '@/types'
import type { SyncEvent } from '@/types'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

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

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FailedPage() {
  const [failedEvents, setFailedEvents] = useState<SyncEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedError, setExpandedError] = useState<string | null>(null)

  const fetchFailed = useCallback(async () => {
    try {
      const data = await getFailedSyncs()
      setFailedEvents(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFailed()
  }, [fetchFailed])

  const handleRetry = (id: string) => {
    setFailedEvents((prev) => prev.filter((e) => e.id !== id))
    toast.success('Retry triggered')
  }

  const handleDismiss = (id: string) => {
    setFailedEvents((prev) => prev.filter((e) => e.id !== id))
    toast.success('Dismissed')
  }

  const handleRetryAll = () => {
    setFailedEvents([])
    toast.success(`Retry triggered for all failed syncs`)
  }

  const handleDismissAll = () => {
    setFailedEvents([])
    toast.success('All failures dismissed')
  }

  // Derived stats
  const failedCount = failedEvents.filter((e) => e.status === 'failed').length
  const retryingCount = failedEvents.filter((e) => e.status === 'retrying').length
  const oldestFailure =
    failedEvents.length > 0
      ? failedEvents.reduce((oldest, e) =>
          new Date(e.created_at).getTime() < new Date(oldest.created_at).getTime() ? e : oldest
        )
      : null

  if (loading) {
    return (
      <div className="flex flex-col">
        <Header title="Failed Syncs" />
        <div className="flex h-96 items-center justify-center text-muted-foreground">
          Loading...
        </div>
      </div>
    )
  }

  // Empty state
  if (failedEvents.length === 0) {
    return (
      <div className="flex flex-col">
        <Header title="Failed Syncs" />
        <div className="p-6">
          <EmptyState
            icon={CheckCircle2}
            title="All Syncs Healthy"
            description="No failed or retrying sync events found."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <Header title="Failed Syncs" />

      <div className="space-y-6 p-6">
        {/* Summary bar */}
        <Card className="shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-medship-danger" />
              <span className="text-sm font-medium">
                {failedCount} failed sync{failedCount !== 1 ? 's' : ''}
              </span>
            </div>
            {retryingCount > 0 && (
              <span className="text-sm text-medship-warning font-medium">
                {retryingCount} retrying
              </span>
            )}
            {oldestFailure && (
              <span className="text-xs text-muted-foreground">
                Oldest failure: {formatRelativeTime(oldestFailure.created_at)}
              </span>
            )}

            <div className="ml-auto flex gap-2">
              <Button size="sm" className="gap-1.5" onClick={handleRetryAll}>
                <RefreshCw className="h-3.5 w-3.5" />
                Retry All
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handleDismissAll}
              >
                <X className="h-3.5 w-3.5" />
                Dismiss All
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Automation</TableHead>
                  <TableHead className="min-w-[200px]">Error Message</TableHead>
                  <TableHead>Source Record</TableHead>
                  <TableHead>Retry Count</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedEvents.map((event) => {
                  const isExhausted =
                    event.status === 'failed' && event.retry_count >= event.max_retries
                  const isExpanded = expandedError === event.id
                  const autoInfo = AUTOMATION_INFO[event.automation as AutomationType]

                  return (
                    <TableRow
                      key={event.id}
                      className={cn(
                        isExhausted
                          ? 'bg-red-50 dark:bg-red-900/10'
                          : event.status === 'retrying'
                            ? 'bg-yellow-50 dark:bg-yellow-900/10'
                            : ''
                      )}
                    >
                      <TableCell className="text-xs" title={event.created_at}>
                        {formatRelativeTime(event.created_at)}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {autoInfo?.name ?? event.automation}
                      </TableCell>
                      <TableCell>
                        {event.error_message ? (
                          <button
                            type="button"
                            className="max-w-[300px] text-left text-xs text-foreground hover:text-medship-primary"
                            onClick={() =>
                              setExpandedError((prev) =>
                                prev === event.id ? null : event.id
                              )
                            }
                          >
                            {isExpanded
                              ? event.error_message
                              : truncate(event.error_message, 100)}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">
                          {event.source_record_id ?? '-'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {event.retry_count}/{event.max_retries}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={event.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => handleRetry(event.id)}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Retry
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => handleDismiss(event.id)}
                          >
                            <X className="h-3 w-3" />
                            Dismiss
                          </Button>
                        </div>
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
