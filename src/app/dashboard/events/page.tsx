'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { EventLogTable } from '@/components/dashboard/EventLogTable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SyncEvent, Automation, SyncStatus } from '@/types'
import { AUTOMATION_INFO } from '@/types'

export default function EventsPage() {
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<SyncEvent[]>([])
  const [filteredEvents, setFilteredEvents] = useState<SyncEvent[]>([])
  const [automationFilter, setAutomationFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const fetchEvents = useCallback(async () => {
    try {
      const response = await fetch('/api/sync/status')
      const data = await response.json()

      if (data.success) {
        setEvents(data.data.recentEvents)
      }
    } catch (error) {
      console.error('Failed to fetch events:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  useEffect(() => {
    let filtered = [...events]

    // Filter by automation
    if (automationFilter !== 'all') {
      filtered = filtered.filter((e) => e.automation === automationFilter)
    }

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter((e) => e.status === statusFilter)
    }

    // Filter by search query (searches sourceRecordId, targetRecordId, errorMessage)
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (e) =>
          e.sourceRecordId?.toLowerCase().includes(query) ||
          e.targetRecordId?.toLowerCase().includes(query) ||
          e.errorMessage?.toLowerCase().includes(query)
      )
    }

    setFilteredEvents(filtered)
  }, [events, automationFilter, statusFilter, searchQuery])

  const automations = Object.keys(AUTOMATION_INFO) as Automation[]
  const statuses: SyncStatus[] = ['pending', 'success', 'failed', 'retrying']

  return (
    <div className="flex flex-col">
      <Header title="Event Log" showRefresh onRefresh={fetchEvents} />

      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Sync Events</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="mb-6 flex flex-wrap gap-4">
              <div className="w-64">
                <Select value={automationFilter} onValueChange={(value) => setAutomationFilter(value ?? 'all')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by automation" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Automations</SelectItem>
                    {automations.map((automation) => (
                      <SelectItem key={automation} value={automation}>
                        {AUTOMATION_INFO[automation].name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-48">
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? 'all')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {statuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1">
                <Input
                  placeholder="Search by record ID or error message..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Results */}
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="text-gray-500">Loading...</div>
              </div>
            ) : (
              <>
                <div className="mb-4 text-sm text-gray-500">
                  Showing {filteredEvents.length} of {events.length} events
                </div>
                <EventLogTable events={filteredEvents} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
