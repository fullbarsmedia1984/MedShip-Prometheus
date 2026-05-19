'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { SparklineChart } from '@/components/dashboard/SparklineChart'
import { ComingSoonBadge, ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Play, Eye, Clock, Zap, RefreshCw, Link as LinkIcon, PackageSearch } from 'lucide-react'
import Link from 'next/link'
import { fetchJson } from '@/lib/client-api'
import type { IntegrationStatusData } from '@/lib/seed-data'
import type { ConnectionConfig, SystemName } from '@/types'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString?: string): string {
  if (!isoString) return 'Never'

  const now = new Date()
  const then = new Date(isoString)
  if (Number.isNaN(then.getTime())) return 'Never'

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

const EXPECTED_CONNECTIONS: SystemName[] = ['salesforce', 'fishbowl', 'quickbooks', 'easypost']
const RUNNABLE_MANUAL_AUTOMATIONS = new Set(['P2_INVENTORY_SYNC', 'P7_FB_SO_SYNC'])

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type IntegrationsDashboardResponse = {
  integrations: IntegrationStatusData[]
  connections: ConnectionConfig[]
  relationshipHealth: RelationshipHealth
}

type RelationshipHealth = {
  salesOrders: number
  lineItems: number
  linkedSalesOrders: number
  unlinkedSalesOrders: number
  opportunityLinks: number
  opportunitiesWithSoNumber: number
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatusData[]>([])
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [relationshipHealth, setRelationshipHealth] = useState<RelationshipHealth | null>(null)
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})
  const [triggeringMap, setTriggeringMap] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchJson<IntegrationsDashboardResponse>('/api/dashboard/integrations')
        setIntegrations(data.integrations)
        setConnections(data.connections)
        setRelationshipHealth(data.relationshipHealth)

        const enabled: Record<string, boolean> = {}
        for (const i of data.integrations) {
          enabled[i.automation] = i.isActive
        }
        setEnabledMap(enabled)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleRunNow = async (automation: string, name: string) => {
    setTriggeringMap((prev) => ({ ...prev, [automation]: true }))

    try {
      const result = await fetchJson<{ eventId?: string; message?: string }>('/api/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation }),
      })
      toast.success(result.message ?? `Triggered manual run for ${name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to trigger ${name}`)
    } finally {
      setTriggeringMap((prev) => ({ ...prev, [automation]: false }))
    }
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

  const connectionBySystem = new Map(connections.map((conn) => [conn.system_name, conn]))
  const connectionRows = EXPECTED_CONNECTIONS.map((systemName) => ({
    systemName,
    connection: connectionBySystem.get(systemName),
  }))
  const relationshipCoverage = relationshipHealth && relationshipHealth.salesOrders > 0
    ? Math.round((relationshipHealth.linkedSalesOrders / relationshipHealth.salesOrders) * 1000) / 10
    : 0

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
        {integrations.length === 0 ? (
          <ComingSoonPanel
            title="No Live Integration Runs"
            description="Integration health will appear after an implemented sync writes schedules or events to the live database."
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {integrations.map((item) => {
              const idLabel = automationIdLabel(item.automation)
              const ScheduleIcon = SCHEDULE_ICONS[item.schedule] ?? Clock
              const enabled = enabledMap[item.automation] ?? true
              const isComingSoon = item.isComingSoon === true
              const canRunNow = RUNNABLE_MANUAL_AUTOMATIONS.has(item.automation)

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
                      {isComingSoon ? <ComingSoonBadge /> : <StatusBadge status={item.status} variant="dot" />}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {isComingSoon ? (
                      <ComingSoonPanel
                        className="min-h-40 p-5"
                        title="Not Implemented Yet"
                        description={
                          item.observedEvents
                            ? `${item.observedEvents.toLocaleString()} placeholder log rows exist in the live DB, but this sync function is not implemented and should not be charted as production activity.`
                            : 'No implemented live sync data exists for this automation yet.'
                        }
                      />
                    ) : (
                      <>
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

                        <div className="flex items-center gap-3">
                          <SparklineChart data={item.last7Days} height={36} width={140} />
                          <span className="text-[10px] text-muted-foreground">7-day trend</span>
                        </div>
                      </>
                    )}

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ScheduleIcon className="h-3.5 w-3.5" />
                      <span>
                        {item.schedule}
                        {item.hasLiveSchedule && isComingSoon ? ' configured' : ''}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 border-t pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        disabled={isComingSoon || !canRunNow || triggeringMap[item.automation]}
                        onClick={() => handleRunNow(item.automation, item.name)}
                        title={canRunNow ? 'Trigger this sync now' : 'Manual trigger requires additional record context'}
                      >
                        {triggeringMap[item.automation] ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        Run Now
                      </Button>
                      <Link href={`/dashboard/events?automation=${item.automation}`}>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                          <Eye className="h-3 w-3" />
                          View Logs
                        </Button>
                      </Link>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        disabled={isComingSoon}
                        onClick={() => toggleEnabled(item.automation)}
                        className={cn(
                          'relative ml-auto inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                          isComingSoon && 'cursor-not-allowed',
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
        )}

        {/* ---- Canonical Relationship Health ---- */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LinkIcon className="h-4 w-4 text-medship-primary" />
              Fishbowl SO Relationship Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!relationshipHealth || relationshipHealth.salesOrders === 0 ? (
              <ComingSoonPanel
                title="Fishbowl sales orders are not cached yet"
                description="P7 must populate fb_sales_orders and fb_sales_order_items before Zeus can link Quotes or Orders to Salesforce Opportunities."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-semibold tabular-nums">{relationshipHealth.salesOrders.toLocaleString('en-US')}</p>
                  <p className="text-xs uppercase text-muted-foreground">SO Headers</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-semibold tabular-nums">{relationshipHealth.lineItems.toLocaleString('en-US')}</p>
                  <p className="text-xs uppercase text-muted-foreground">SO Lines</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-semibold tabular-nums">{relationshipHealth.linkedSalesOrders.toLocaleString('en-US')}</p>
                  <p className="text-xs uppercase text-muted-foreground">Linked SOs</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-semibold tabular-nums">{relationshipHealth.unlinkedSalesOrders.toLocaleString('en-US')}</p>
                  <p className="text-xs uppercase text-muted-foreground">Unlinked SOs</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-semibold tabular-nums">{relationshipCoverage}%</p>
                  <p className="text-xs uppercase text-muted-foreground">Link Coverage</p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <PackageSearch className="h-4 w-4 text-muted-foreground" />
                    <p className="text-2xl font-semibold tabular-nums">{relationshipHealth.opportunityLinks.toLocaleString('en-US')}</p>
                  </div>
                  <p className="text-xs uppercase text-muted-foreground">Link Rows</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---- Connection Status ---- */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Connection Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {connectionRows.map(({ systemName, connection }) => {
                const statusLabel = connection?.is_active
                  ? connection.last_error
                    ? 'warning'
                    : 'connected'
                  : 'not_configured'
                const isComingSoon = !connection

                return (
                  <div
                    key={systemName}
                    className="flex flex-wrap items-center gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="w-28 text-sm font-medium">
                      {systemLabel(systemName)}
                    </span>

                    {isComingSoon ? (
                      <ComingSoonBadge />
                    ) : (
                      <StatusBadge
                        status={statusLabel}
                        variant="dot"
                      />
                    )}

                    {connection?.last_connected_at && (
                      <span className="text-xs text-muted-foreground">
                        Last connected: {formatRelativeTime(connection.last_connected_at)}
                      </span>
                    )}

                    {connection?.last_error && (
                      <span className="text-xs text-medship-danger">
                        {connection.last_error}
                      </span>
                    )}

                    {isComingSoon && (
                      <span className="text-xs text-muted-foreground">
                        No live connection config row exists in the database.
                      </span>
                    )}
                  </div>
                )
              })}
              {connections
                .filter((conn) => !EXPECTED_CONNECTIONS.includes(conn.system_name))
                .map((conn) => {
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
                      status={statusLabel}
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
