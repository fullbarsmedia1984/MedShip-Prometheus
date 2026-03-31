'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { SyncEvent, SyncStatus } from '@/types'
import { AUTOMATION_INFO } from '@/types'

interface EventLogTableProps {
  events: SyncEvent[]
  showAutomation?: boolean
}

const statusVariants: Record<SyncStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  running: 'secondary',
  success: 'default',
  failed: 'destructive',
  retrying: 'outline',
  dismissed: 'outline',
}

const statusLabels: Record<SyncStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
  retrying: 'Retrying',
  dismissed: 'Dismissed',
}

export function EventLogTable({ events, showAutomation = true }: EventLogTableProps) {
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  const formatDuration = (start: string, end?: string) => {
    if (!end) return '-'
    const ms = new Date(end).getTime() - new Date(start).getTime()
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  if (events.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">
        No sync events found.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showAutomation && <TableHead>Automation</TableHead>}
          <TableHead>Source</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Source ID</TableHead>
          <TableHead>Target ID</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            {showAutomation && (
              <TableCell className="font-medium">
                {AUTOMATION_INFO[event.automation]?.name || event.automation}
              </TableCell>
            )}
            <TableCell className="capitalize">{event.source_system}</TableCell>
            <TableCell className="capitalize">{event.target_system}</TableCell>
            <TableCell>
              <Badge variant={statusVariants[event.status]}>
                {statusLabels[event.status]}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {event.source_record_id
                ? event.source_record_id.substring(0, 15) + '...'
                : '-'}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {event.target_record_id || '-'}
            </TableCell>
            <TableCell>
              {formatDuration(event.created_at, event.completed_at ?? undefined)}
            </TableCell>
            <TableCell className="text-sm text-gray-500">
              {formatTime(event.created_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
