'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConnectionIndicator } from './ConnectionIndicator'
import { Play, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import type { AutomationStats } from '@/types'
import { AUTOMATION_INFO } from '@/types'

interface SyncStatusCardProps {
  stats: AutomationStats
  onTrigger?: () => void
}

export function SyncStatusCard({ stats, onTrigger }: SyncStatusCardProps) {
  const info = AUTOMATION_INFO[stats.automation]

  const getStatusColor = () => {
    if (!stats.lastRunStatus) return 'disconnected'
    if (stats.lastRunStatus === 'success') return 'connected'
    if (stats.lastRunStatus === 'failed') return 'error'
    return 'disconnected'
  }

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <ConnectionIndicator status={getStatusColor()} size="lg" />
          <div>
            <CardTitle className="text-base font-medium">{info.name}</CardTitle>
            <p className="text-xs text-gray-500">Phase {info.phase}</p>
          </div>
        </div>
        <Badge variant={stats.isActive ? 'default' : 'secondary'}>
          {stats.isActive ? 'Active' : 'Disabled'}
        </Badge>
      </CardHeader>

      <CardContent>
        <p className="mb-4 text-sm text-gray-600">{info.description}</p>

        {/* Stats grid */}
        <div className="mb-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center text-green-600">
              <CheckCircle className="mr-1 h-4 w-4" />
              <span className="text-lg font-semibold">
                {stats.stats24h.success}
              </span>
            </div>
            <p className="text-xs text-gray-500">Success</p>
          </div>
          <div>
            <div className="flex items-center justify-center text-red-600">
              <XCircle className="mr-1 h-4 w-4" />
              <span className="text-lg font-semibold">
                {stats.stats24h.failed}
              </span>
            </div>
            <p className="text-xs text-gray-500">Failed</p>
          </div>
          <div>
            <div className="flex items-center justify-center text-yellow-600">
              <AlertCircle className="mr-1 h-4 w-4" />
              <span className="text-lg font-semibold">
                {stats.stats24h.pending}
              </span>
            </div>
            <p className="text-xs text-gray-500">Pending</p>
          </div>
        </div>

        {/* Timing info */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center text-gray-500">
              <Clock className="mr-1 h-3 w-3" />
              Last Run
            </span>
            <span className="font-medium">{formatTime(stats.lastRunAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Duration</span>
            <span className="font-medium">
              {formatDuration(stats.lastRunDurationMs)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Records</span>
            <span className="font-medium">{stats.recordsProcessed}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Schedule</span>
            <code className="rounded bg-gray-100 px-1 text-xs">
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
