'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from './StatusBadge'
import { ConnectionIndicator } from './ConnectionIndicator'
import { Play, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AutomationStats } from '@/types'
import { AUTOMATION_INFO } from '@/types'

interface SyncStatusCardProps {
  stats: AutomationStats
  onTrigger?: () => void
  compact?: boolean
}

export function SyncStatusCard({ stats, onTrigger, compact = false }: SyncStatusCardProps) {
  const info = AUTOMATION_INFO[stats.automation]

  const getConnectionStatus = () => {
    if (!stats.lastRunStatus) return 'disconnected' as const
    if (stats.lastRunStatus === 'success') return 'connected' as const
    if (stats.lastRunStatus === 'failed') return 'error' as const
    return 'disconnected' as const
  }

  const getStatusLabel = () => {
    if (!stats.lastRunStatus) return 'Pending'
    if (stats.lastRunStatus === 'success') return 'Synced'
    if (stats.lastRunStatus === 'failed') return 'Failed'
    return stats.lastRunStatus
  }

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  const formatRelativeTime = (timestamp?: string) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    return `${Math.floor(diffHr / 24)}d ago`
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  // Compact mode: single row layout for dashboard overview
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <div className="flex items-center gap-3">
          <ConnectionIndicator status={getConnectionStatus()} size="sm" />
          <div>
            <p className="text-sm font-medium">{info.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(stats.lastRunAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {stats.recordsProcessed} records
          </span>
          <StatusBadge status={getStatusLabel()} variant="dot" />
        </div>
      </div>
    )
  }

  // Full mode: detailed card
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <ConnectionIndicator status={getConnectionStatus()} size="lg" />
          <div>
            <CardTitle className="text-base font-medium">{info.name}</CardTitle>
            <p className="text-xs text-muted-foreground">Phase {info.phase}</p>
          </div>
        </div>
        <StatusBadge
          status={stats.isActive ? 'Active' : 'Disabled'}
          variant="dot"
        />
      </CardHeader>

      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">{info.description}</p>

        {/* Stats grid */}
        <div className="mb-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center text-medship-success">
              <CheckCircle className="mr-1 h-4 w-4" />
              <span className="text-lg font-semibold">
                {stats.stats24h.success}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Success</p>
          </div>
          <div>
            <div className="flex items-center justify-center text-medship-danger">
              <XCircle className="mr-1 h-4 w-4" />
              <span className="text-lg font-semibold">
                {stats.stats24h.failed}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
          <div>
            <div className="flex items-center justify-center text-medship-warning">
              <AlertCircle className="mr-1 h-4 w-4" />
              <span className="text-lg font-semibold">
                {stats.stats24h.pending}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Pending</p>
          </div>
        </div>

        {/* Timing info */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center text-muted-foreground">
              <Clock className="mr-1 h-3 w-3" />
              Last Run
            </span>
            <span className="font-medium">{formatTime(stats.lastRunAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Duration</span>
            <span className="font-medium">
              {formatDuration(stats.lastRunDurationMs)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Records</span>
            <span className="font-medium">{stats.recordsProcessed}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Schedule</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {stats.cronExpression || 'Event-driven'}
            </code>
          </div>
        </div>

        {/* Trigger button */}
        {onTrigger && (
          <Button
            className="mt-4 w-full"
            variant="outline"
            size="sm"
            onClick={onTrigger}
          >
            <Play className="mr-2 h-4 w-4" />
            Run Now
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
