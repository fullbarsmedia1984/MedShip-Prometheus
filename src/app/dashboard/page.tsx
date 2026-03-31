'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { SyncStatusCard } from '@/components/dashboard/SyncStatusCard'
import { EventLogTable } from '@/components/dashboard/EventLogTable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AutomationStats, SyncEvent } from '@/types'
import { toast } from 'sonner'

interface SyncStatusResponse {
  success: boolean
  data: {
    automations: AutomationStats[]
    recentEvents: SyncEvent[]
    failedEvents: Array<{
      id: string
      automation: string
      sourceRecordId?: string
      errorMessage?: string
      retryCount: number
      maxRetries: number
      createdAt: string
    }>
  }
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [automations, setAutomations] = useState<AutomationStats[]>([])
  const [recentEvents, setRecentEvents] = useState<SyncEvent[]>([])

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/sync/status')
      const data: SyncStatusResponse = await response.json()

      if (data.success) {
        setAutomations(data.data.automations)
        setRecentEvents(data.data.recentEvents)
      }
    } catch (error) {
      console.error('Failed to fetch status:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    // Refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleTrigger = async (automation: string) => {
    try {
      const response = await fetch('/api/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success(`${automation} triggered successfully`)
        // Refresh status after a short delay
        setTimeout(fetchStatus, 2000)
      } else {
        toast.error(data.error || 'Failed to trigger sync')
      }
    } catch (error) {
      toast.error('Failed to trigger sync')
    }
  }

  // Group automations by phase
  const eventDriven = automations.filter((a) =>
    ['P1_OPP_TO_SO', 'P5_QUOTE_PDF'].includes(a.automation)
  )
  const scheduled = automations.filter(
    (a) => !['P1_OPP_TO_SO', 'P5_QUOTE_PDF'].includes(a.automation)
  )

  return (
    <div className="flex flex-col">
      <Header title="Dashboard" showRefresh onRefresh={fetchStatus} />

      <div className="p-6">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="text-gray-500">Loading...</div>
          </div>
        ) : (
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="recent">Recent Events</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              {/* Event-driven automations */}
              <div>
                <h2 className="mb-4 text-lg font-semibold">
                  Event-Driven Automations
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {eventDriven.map((stats) => (
                    <SyncStatusCard
                      key={stats.automation}
                      stats={stats}
                      onTrigger={
                        stats.automation === 'P1_OPP_TO_SO'
                          ? undefined
                          : () => handleTrigger(stats.automation)
                      }
                    />
                  ))}
                </div>
              </div>

              {/* Scheduled automations */}
              <div>
                <h2 className="mb-4 text-lg font-semibold">
                  Scheduled Automations
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {scheduled.map((stats) => (
                    <SyncStatusCard
                      key={stats.automation}
                      stats={stats}
                      onTrigger={() => handleTrigger(stats.automation)}
                    />
                  ))}
                </div>
              </div>

              {/* Quick stats */}
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500">
                      Total Events (24h)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">
                      {automations.reduce(
                        (sum, a) => sum + a.stats24h.total,
                        0
                      )}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500">
                      Success Rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-green-600">
                      {(() => {
                        const total = automations.reduce(
                          (sum, a) => sum + a.stats24h.total,
                          0
                        )
                        const success = automations.reduce(
                          (sum, a) => sum + a.stats24h.success,
                          0
                        )
                        return total > 0
                          ? Math.round((success / total) * 100)
                          : 0
                      })()}
                      %
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500">
                      Failed (24h)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-red-600">
                      {automations.reduce(
                        (sum, a) => sum + a.stats24h.failed,
                        0
                      )}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500">
                      Active Automations
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">
                      {automations.filter((a) => a.isActive).length}/
                      {automations.length}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="recent">
              <Card>
                <CardHeader>
                  <CardTitle>Recent Sync Events</CardTitle>
                </CardHeader>
                <CardContent>
                  <EventLogTable events={recentEvents} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
