'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { SparklineChart } from '@/components/dashboard/SparklineChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Play, Eye, Clock, BarChart3, Zap, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { getIntegrationStatus, getConnectionConfigs } from '@/lib/data'
import type { IntegrationStatusData } from '@/lib/seed-data'
import type { ConnectionConfig } from '@/types'
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

function automationIdLabel(automation: string): string {
  const match = automation.match(/^P(\d)/)
  return match ? `P${match[1]}` : automation
}

const SCHEDULE_ICONS: Record<string, React.ElementType> = {
  'Every 2 minutes': Clock,
  'Every 15 minutes': Clock,
  'Every 1 hour': Clock,
  'On-demand': Zap,
  'After P2 completes': RefreshCw,
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatusData[]>([])
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [intData, connData] = await Promise.all([
          getIntegrationStatus(),
          getConnectionConfigs(),
        ])
        setIntegrations(intData)
        setConnections(connData)

        const enabled: Record<string, boolean> = {}
        for (const i of intData) {
          enabled[i.automation] = i.isActive
        }
        setEnabledMap(enabled)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleRunNow = (automation: string, name: string) => {
    toast.success(`Triggered manual run for ${name}`)
  }

  const toggleEnabled = (automation: string) => {
    setEnabledMap((prev) => {
      const next = { ...prev, [automation]: !prev[automation] }
      toast.success(
        next[automation]
          ? `${automationIdLabel(automation)} enabled`
          : `${automationIdLabel(automation)} disabled`
      )
      return next
    })
  }

  const systemLabel = (name: string): string => {
    const map: Record<string, string> = {
      salesforce: 'Salesforce',
      fishbowl: 'Fishbowl',
      quickbooks: 'QuickBooks',
      easypost: 'EasyPost',
    }
    return map[name] ?? name
  }

  if (loading) {
    return (
      <div className="flex flex-col">
        <Header title="Integrations" />
        <div className="flex h-96 items-center justify-center text-muted-foreground">
          Loading...
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <Header title="Integrations" />

      <div className="space-y-6 p-6">
        {/* ---- Integration Cards ---- */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {integrations.map((item) => {
            const idLabel = automationIdLabel(item.automation)
            const ScheduleIcon = SCHEDULE_ICONS[item.schedule] ?? Clock
            const enabled = enabledMap[item.automation] ?? true

            return (
              <Card key={item.automation} className={cn('shadow-sm', !enabled && 'opacity-60')}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-medship-primary/10 text-xs font-bold text-medship-primary">
                        {idLabel}
                      </span>
                      <CardTitle className="text-sm font-semibold leading-tight">
                        {item.name}
                      </CardTitle>
                    </div>
                    <StatusBadge status={item.status} variant="dot" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Stats row */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Last run</span>
                      <p className="font-medium">{formatRelativeTime(item.lastRunAt)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Duration</span>
                      <p className="font-medium">{item.lastRunDurationMs} ms</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Records</span>
                      <p className="font-medium">{item.recordsProcessed}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Success rate</span>
                      <p className="font-medium">{item.successRate}%</p>
                    </div>
                  </div>

                  {/* Sparkline */}
                  <div className="flex items-center gap-3">
                    <SparklineChart data={item.last7Days} height={36} width={140} />
                    <span className="text-[10px] text-muted-foreground">7-day trend</span>
                  </div>

                  {/* Schedule */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ScheduleIcon className="h-3.5 w-3.5" />
                    <span>{item.schedule}</span>
                  </div>

                  {/* Actions row */}
                  <div className="flex items-center gap-2 border-t pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => handleRunNow(item.automation, item.name)}
                    >
                      <Play className="h-3 w-3" />
                      Run Now
                    </Button>
                    <Link href={`/dashboard/events?automation=${item.automation}`}>
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                        <Eye className="h-3 w-3" />
                        View Logs
                      </Button>
                    </Link>

                    {/* Enable / Disable toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() => toggleEnabled(item.automation)}
                      className={cn(
                        'relative ml-auto inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                        enabled ? 'bg-medship-success' : 'bg-muted-foreground/30'
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                          enabled ? 'translate-x-4' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* ---- Connection Status ---- */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Connection Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {connections.map((conn) => {
                const isEasyPost = conn.system_name === 'easypost'
                const statusLabel = conn.is_active
                  ? conn.last_error
                    ? 'warning'
                    : 'connected'
                  : 'error'

                return (
                  <div
                    key={conn.id}
                    className="flex flex-wrap items-center gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="w-28 text-sm font-medium">
                      {systemLabel(conn.system_name)}
                    </span>

                    <StatusBadge
                      status={isEasyPost ? 'Phase 2' : statusLabel}
                      variant="dot"
                    />

                    {conn.last_connected_at && (
                      <span className="text-xs text-muted-foreground">
                        Last connected: {formatRelativeTime(conn.last_connected_at)}
                      </span>
                    )}

                    {conn.last_error && (
                      <span className="text-xs text-medship-danger">
                        {conn.last_error}
                      </span>
                    )}

                    {isEasyPost && (
                      <span className="text-xs text-muted-foreground italic">
                        Phase 2 - not yet integrated
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
