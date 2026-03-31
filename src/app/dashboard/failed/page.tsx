'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { FailedSyncRow } from '@/components/dashboard/FailedSyncRow'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type { Automation } from '@/types'

interface FailedEvent {
  id: string
  automation: Automation
  sourceRecordId?: string
  errorMessage?: string
  retryCount: number
  maxRetries: number
  createdAt: string
}

export default function FailedPage() {
  const [loading, setLoading] = useState(true)
  const [failedEvents, setFailedEvents] = useState<FailedEvent[]>([])
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())

  const fetchFailed = useCallback(async () => {
    try {
      const response = await fetch('/api/sync/status')
      const data = await response.json()

      if (data.success) {
        setFailedEvents(data.data.failedEvents)
      }
    } catch (error) {
      console.error('Failed to fetch failed events:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFailed()
  }, [fetchFailed])

  const handleRetry = async (id: string) => {
    setRetryingIds((prev) => new Set(prev).add(id))

    try {
      // Find the event to get automation type
      const event = failedEvents.find((e) => e.id === id)
      if (!event) return

      const response = await fetch('/api/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automation: event.automation,
          params: { eventId: id },
        }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Retry triggered successfully')
        // Remove from failed list after short delay
        setTimeout(() => {
          setFailedEvents((prev) => prev.filter((e) => e.id !== id))
        }, 1000)
      } else {
        toast.error(data.error || 'Failed to trigger retry')
      }
    } catch (error) {
      toast.error('Failed to trigger retry')
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <div className="flex flex-col">
      <Header title="Failed Syncs" showRefresh onRefresh={fetchFailed} />

      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Failed Sync Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="text-gray-500">Loading...</div>
              </div>
            ) : failedEvents.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-gray-500">
                <AlertTriangle className="mb-2 h-12 w-12 text-gray-300" />
                <p>No failed syncs! Everything is running smoothly.</p>
              </div>
            ) : (
              <div className="divide-y">
                {failedEvents.map((event) => (
                  <FailedSyncRow
                    key={event.id}
                    id={event.id}
                    automation={event.automation}
                    sourceRecordId={event.sourceRecordId}
                    errorMessage={event.errorMessage}
                    retryCount={event.retryCount}
                    maxRetries={event.maxRetries}
                    createdAt={event.createdAt}
                    onRetry={handleRetry}
                    isRetrying={retryingIds.has(event.id)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
