'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Header } from '@/components/layout/Header'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  RefreshCw,
  Database,
  Cloud,
  Server,
  Truck,
  AlertTriangle,
  Eye,
  EyeOff,
  Lock,
  Save,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Play,
  Zap,
} from 'lucide-react'
import type { ConnectionConfig } from '@/types'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncTableState {
  table_name: string
  last_full_sync_at: string | null
  last_incremental_sync_at: string | null
  record_count: number
  last_error: string | null
  last_sync_duration_ms: number | null
}

type ManualAutomation = 'P2_INVENTORY_SYNC' | 'P7_FB_SO_SYNC'

interface SyncAutomationStatus {
  automation: string
  cronExpression: string | null
  isActive: boolean
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunDurationMs: number | null
  nextRunAt: string | null
  recordsProcessed: number | null
  latestError: {
    message: string | null
    status: string
    createdAt: string
    completedAt: string | null
  } | null
  stats24h: {
    success: number
    failed: number
    pending: number
    total: number
    successRate: number
  }
}

interface SyncStatusResponse {
  success: boolean
  data?: {
    automations?: SyncAutomationStatus[]
  }
}

interface SystemConfig {
  key: string
  label: string
  icon: React.ElementType
  fields: { name: string; label: string; type: 'text' | 'password'; placeholder: string }[]
  phase2?: boolean
}

type SettingsConnectionConfig = ConnectionConfig & {
  configured_fields?: string[]
  locked_fields?: string[]
  credential_source?: 'database' | 'environment'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_CONFIGS: SystemConfig[] = [
  {
    key: 'salesforce',
    label: 'Salesforce',
    icon: Cloud,
    fields: [
      { name: 'loginUrl', label: 'Login URL', type: 'text', placeholder: 'https://login.salesforce.com' },
      { name: 'clientId', label: 'Client ID', type: 'password', placeholder: 'Connected App Client ID' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Client Secret' },
      { name: 'username', label: 'Username', type: 'text', placeholder: 'integration@medshipllc.com' },
      { name: 'password', label: 'Password + Security Token', type: 'password', placeholder: 'Password' },
    ],
  },
  {
    key: 'fishbowl',
    label: 'Fishbowl Inventory',
    icon: Server,
    fields: [
      { name: 'apiUrl', label: 'API URL', type: 'text', placeholder: 'http://192.168.1.100:28192' },
      { name: 'username', label: 'Username', type: 'text', placeholder: 'api_user' },
      { name: 'password', label: 'Password', type: 'password', placeholder: 'Password' },
    ],
  },
  {
    key: 'quickbooks',
    label: 'QuickBooks',
    icon: Database,
    phase2: true,
    fields: [
      { name: 'environment', label: 'Environment', type: 'text', placeholder: 'sandbox' },
      { name: 'clientId', label: 'Client ID', type: 'password', placeholder: 'Client ID' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Client Secret' },
      { name: 'realmId', label: 'Realm ID', type: 'text', placeholder: '1234567890' },
    ],
  },
  {
    key: 'easypost',
    label: 'EasyPost',
    icon: Truck,
    phase2: true,
    fields: [
      { name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'API Key' },
    ],
  },
]

const TABLE_LABELS: Record<string, string> = {
  sf_users: 'Users',
  sf_accounts: 'Accounts',
  sf_products: 'Products',
  sf_opportunities: 'Opportunities',
  sf_opportunity_line_items: 'Line Items',
  sf_profile_calls: 'Profile Calls',
}

const FISHBOWL_SYNC_CONTROLS: {
  automation: ManualAutomation
  label: string
  description: string
}[] = [
  {
    automation: 'P2_INVENTORY_SYNC',
    label: 'Fishbowl Inventory',
    description: 'Inventory quantities to Salesforce products',
  },
  {
    automation: 'P7_FB_SO_SYNC',
    label: 'Fishbowl Sales Orders',
    description: 'Sales orders into canonical Prometheus cache',
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(isoStr: string | null): string {
  if (!isoStr) return 'Never'
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} sec`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function formatSchedule(cronExpression: string | null | undefined): string {
  if (!cronExpression) return 'Manual'

  const knownSchedules: Record<string, string> = {
    '*/15 * * * *': 'Every 15 min',
    '*/5 * * * *': 'Every 5 min',
    '0 * * * *': 'Hourly',
    '0 0 * * *': 'Daily',
  }

  return knownSchedules[cronExpression] ?? cronExpression
}

function displayStatus(status: string | null | undefined): string {
  if (!status) return 'Pending'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  // Connection config state
  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState<SettingsConnectionConfig[]>([])
  const [testing, setTesting] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({})
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set())
  const [resetConfirm, setResetConfirm] = useState('')

  // Live cache state
  const [dataSourceMode, setDataSourceMode] = useState<'live'>('live')
  const [pendingMode, setPendingMode] = useState<'live' | null>(null)
  const [syncState, setSyncState] = useState<SyncTableState[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncExpanded, setSyncExpanded] = useState(false)
  const [automationStatus, setAutomationStatus] = useState<SyncAutomationStatus[]>([])
  const [triggeringAutomation, setTriggeringAutomation] = useState<ManualAutomation | null>(null)
  const [refreshingAutomationStatus, setRefreshingAutomationStatus] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/connections')
      if (!res.ok) throw new Error('Failed to fetch')
      const data: SettingsConnectionConfig[] = await res.json()
      setConnections(data)

      const populated: Record<string, Record<string, string>> = {}
      for (const conn of data) {
        if (conn.config && typeof conn.config === 'object') {
          populated[conn.system_name] = conn.config as Record<string, string>
        }
      }
      setFormValues((prev) => {
        const merged = { ...prev }
        for (const [system, fields] of Object.entries(populated)) {
          merged[system] = { ...fields, ...prev[system] }
        }
        return merged
      })
    } catch (error) {
      console.error('Failed to fetch connections:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDataSource = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/data-source')
      if (res.ok) {
        await res.json()
        setDataSourceMode('live')
      }
    } catch {
      // Supabase may not be configured; the dashboard remains live-only.
    }
  }, [])

  const fetchSyncState = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/salesforce')
      if (res.ok) {
        const data = await res.json()
        setSyncState(data.syncState ?? [])
      }
    } catch {
      // Ignore — sync state table may not exist yet
    }
  }, [])

  const fetchAutomationStatus = useCallback(async (showToast = false) => {
    if (showToast) setRefreshingAutomationStatus(true)

    try {
      const res = await fetch('/api/sync/status')
      const data: SyncStatusResponse & { error?: string } = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load sync status')
      }

      setAutomationStatus(data.data?.automations ?? [])

      if (showToast) {
        toast.success('Fishbowl sync status refreshed')
      }
    } catch (error) {
      if (showToast) {
        toast.error('Could not refresh Fishbowl sync status', {
          description: error instanceof Error ? error.message : 'The sync status endpoint did not respond.',
        })
      }
      // Ignore silent background refresh failures; production may still be deploying.
    } finally {
      if (showToast) setRefreshingAutomationStatus(false)
    }
  }, [])

  useEffect(() => {
    fetchConnections()
    fetchDataSource()
    fetchSyncState()
    fetchAutomationStatus()
  }, [fetchConnections, fetchDataSource, fetchSyncState, fetchAutomationStatus])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Connection handlers
  // ---------------------------------------------------------------------------

  const testConnection = async (systemName: string) => {
    setTesting(systemName)
    try {
      const res = await fetch(`/api/health/${systemName}`)
      const data = await res.json()
      if (data.connected) {
        toast.success(`${systemName} connection successful`, {
          description: data.orgId
            ? `Org ID: ${data.orgId}`
            : `Responded at ${new Date(data.timestamp).toLocaleTimeString()}`,
        })
      } else {
        const errorMsg = data.error || 'Unable to connect'
        if (errorMsg.includes('fetch failed')) {
          toast.error(`${systemName} — network error`, {
            description: 'Could not reach the service. Check that credentials are set in .env.local and restart the server.',
          })
        } else {
          toast.error(`${systemName} connection failed`, {
            description: errorMsg,
          })
        }
      }
    } catch {
      toast.error(`${systemName} connection test failed`, {
        description: 'Could not reach the health endpoint',
      })
    }
    setTesting(null)
  }

  const saveCredentials = async (systemName: string) => {
    setSaving(systemName)
    const values = formValues[systemName]
    if (!values || Object.values(values).every((v) => !v.trim())) {
      toast.error('No credentials to save', {
        description: 'Enter at least one field before saving',
      })
      setSaving(null)
      return
    }

    try {
      const res = await fetch('/api/settings/connections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: systemName, config: values }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`${systemName} credentials saved`, {
          description: `${data.fieldsUpdated} field(s) saved. Click "Test Connection" to verify.`,
        })
      } else {
        const detail = data.detail || data.error || 'Unknown error'
        if (detail.includes('fetch failed')) {
          toast.error(`Cannot connect to database`, {
            description: 'Supabase is unreachable from the server. Credentials must be set in .env.local for now.',
          })
        } else {
          toast.error(`Failed to save ${systemName} credentials`, {
            description: detail,
          })
        }
      }
    } catch {
      toast.error(`Failed to save ${systemName} credentials`, {
        description: 'Could not reach the settings API',
      })
    }
    setSaving(null)
  }

  const updateField = (systemName: string, fieldName: string, value: string) => {
    setFormValues((prev) => ({
      ...prev,
      [systemName]: {
        ...prev[systemName],
        [fieldName]: value,
      },
    }))
  }

  const togglePasswordVisibility = (fieldKey: string) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev)
      if (next.has(fieldKey)) {
        next.delete(fieldKey)
      } else {
        next.add(fieldKey)
      }
      return next
    })
  }

  const getConnectionForSystem = (systemName: string) => {
    return connections.find((c) => c.system_name === systemName)
  }

  const isFieldLocked = (
    conn: SettingsConnectionConfig | undefined,
    fieldName: string
  ) => conn?.locked_fields?.includes(fieldName) ?? false

  const configuredFieldCount = (conn: SettingsConnectionConfig | undefined) =>
    conn?.configured_fields?.length ?? 0

  const formatTimestamp = (ts: string | null) => {
    if (!ts) return 'Never'
    return new Date(ts).toLocaleString()
  }

  // ---------------------------------------------------------------------------
  // Data source handlers
  // ---------------------------------------------------------------------------

  const handleModeToggle = async (mode: 'live') => {
    if (mode === dataSourceMode) return

    setPendingMode('live')
  }

  const applyMode = async (mode: 'live') => {
    try {
      const res = await fetch('/api/settings/data-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (res.ok) {
        setDataSourceMode(mode)
        setPendingMode(null)
        toast.success('Live data enabled', {
          description: 'Dashboard modules will show live Salesforce and Fishbowl cache data.',
        })
      } else {
        toast.error('Failed to switch data source')
      }
    } catch {
      toast.error('Failed to switch data source', {
        description: 'Could not reach the settings API',
      })
    }
  }

  const triggerSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync/salesforce', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to trigger sync')
      toast.success('Sync started', { description: 'Pulling data from Salesforce...' })

      // Poll for progress every 3 seconds
      pollRef.current = setInterval(async () => {
        try {
          const stateRes = await fetch('/api/sync/salesforce')
          if (stateRes.ok) {
            const data = await stateRes.json()
            const states: SyncTableState[] = data.syncState ?? []
            setSyncState(states)

            // Check if sync finished (all tables have a recent sync time)
            const allSynced = states.length > 0 && states.every((s) => {
              if (!s.last_full_sync_at) return false
              const elapsed = Date.now() - new Date(s.last_full_sync_at).getTime()
              return elapsed < 120_000 // Within last 2 minutes
            })

            if (allSynced) {
              if (pollRef.current) clearInterval(pollRef.current)
              pollRef.current = null
              setSyncing(false)
              const totalRecords = states.reduce((s, t) => s + (t.record_count ?? 0), 0)
              toast.success('Sync complete', {
                description: `${totalRecords.toLocaleString()} records cached across ${states.length} tables.`,
              })
            }
          }
        } catch {
          // Ignore polling errors
        }
      }, 3000)

      // Safety timeout: stop polling after 5 minutes
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
          setSyncing(false)
        }
      }, 300_000)
    } catch {
      setSyncing(false)
      toast.error('Failed to start sync')
    }
  }

  const triggerAutomationSync = async (automation: ManualAutomation) => {
    const control = FISHBOWL_SYNC_CONTROLS.find((item) => item.automation === automation)
    setTriggeringAutomation(automation)

    try {
      const res = await fetch('/api/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automation,
          params: { fullSync: true },
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to trigger sync')
      }

      toast.success(`${control?.label ?? automation} run requested`, {
        description: data.eventId
          ? `Event ${data.eventId} queued. Status updates after Inngest runs it.`
          : 'Sync has been queued. Status updates after Inngest runs it.',
      })
      await fetchAutomationStatus()
      setTimeout(fetchAutomationStatus, 3000)
    } catch (error) {
      toast.error(`Failed to run ${control?.label ?? automation}`, {
        description: error instanceof Error ? error.message : 'Could not reach the sync trigger API',
      })
    } finally {
      setTriggeringAutomation(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const totalRecordsCached = syncState.reduce((s, t) => s + (t.record_count ?? 0), 0)
  const totalSalesforceDurationMs = syncState.reduce(
    (s, t) => s + (t.last_sync_duration_ms ?? 0),
    0
  )
  const lastFullSync = syncState
    .map((s) => s.last_full_sync_at)
    .filter(Boolean)
    .sort()
    .pop() ?? null
  const hasErrors = syncState.some((s) => s.last_error)
  const latestSalesforceError = syncState.find((s) => s.last_error)?.last_error ?? null
  const salesforceSyncStatus = syncing
    ? 'Running'
    : hasErrors
      ? 'Failed'
      : lastFullSync
        ? 'Success'
        : 'Pending'
  const automationStatusById = new Map(
    automationStatus.map((status) => [status.automation, status])
  )
  const isLive = dataSourceMode === 'live'
  const isCacheEmpty = totalRecordsCached === 0

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col">
      <Header title="Settings" />

      <div className="space-y-6 p-6">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        ) : (
          <>
            {/* ============================================================ */}
            {/* Data Source Section                                           */}
            {/* ============================================================ */}
            <Card className="overflow-hidden border-2 border-border/60">
              <CardHeader className="border-b border-border/40 bg-gradient-to-r from-medship-primary/[0.03] to-transparent">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-medship-primary/10">
                    <Database className="h-5 w-5 text-medship-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Data Source</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Dashboard modules read from live Salesforce and Fishbowl cache data
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {/* Left: Mode Toggle */}
                  <div className="space-y-4">
                    <div>
                      <p className="mb-2.5 text-sm font-medium text-card-foreground">Active Mode</p>
                      <button
                        type="button"
                        onClick={() => handleModeToggle('live')}
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-600"
                      >
                        <Zap className="h-4 w-4" />
                        Live Data Only
                      </button>

                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        Dashboard modules use live Salesforce and Fishbowl cache data only. Modules without a live source are flagged as Coming Soon.
                      </p>
                    </div>

                    {/* Inline confirmation for switching to live */}
                    {pendingMode === 'live' && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-50/50 p-4 dark:bg-amber-950/20">
                        <p className="mb-3 text-sm font-medium text-amber-700 dark:text-amber-400">
                          Switch to live data? Make sure you&rsquo;ve run at least one full sync from Salesforce.
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => applyMode('live')}
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPendingMode(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Warning: live but empty */}
                    {isLive && isCacheEmpty && (
                      <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-50/50 p-3 dark:bg-red-950/20">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        <p className="text-sm text-red-600 dark:text-red-400">
                          Live mode active but no data has been synced. Click <strong>Start Sync</strong> to pull from Salesforce.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right: Sync Status */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-card-foreground">Salesforce Cache Sync</p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          Manual full cache refresh
                        </p>
                      </div>
                      <StatusBadge status={salesforceSyncStatus} variant="dot" />
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      <div>
                        <span className="text-muted-foreground">Last run</span>
                        <p className="font-medium">{relativeTime(lastFullSync)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Duration</span>
                        <p className="font-medium">{formatDuration(totalSalesforceDurationMs)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Records</span>
                        <p className="font-medium">{totalRecordsCached.toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Tables</span>
                        <p className="font-medium">{syncState.length.toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Start Sync button */}
                    <Button
                      onClick={triggerSync}
                      disabled={syncing}
                      className={cn(
                        'w-full justify-center gap-2 py-2.5',
                        syncing
                          ? 'bg-medship-primary/80'
                          : 'bg-medship-primary hover:bg-medship-primary-light'
                      )}
                      size="lg"
                    >
                      <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
                      {syncing ? 'Syncing...' : 'Start Sync'}
                    </Button>

                    {/* Error warning */}
                    {latestSalesforceError && !syncing && (
                      <div className="flex items-center gap-2 text-xs text-medship-danger">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span className="line-clamp-2">Latest error: {latestSalesforceError}</span>
                      </div>
                    )}

                    {/* Collapsible per-table breakdown */}
                    {syncState.length > 0 && (
                      <div className="rounded-lg border border-border/50">
                        <button
                          onClick={() => setSyncExpanded(!syncExpanded)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-card-foreground"
                        >
                          {syncExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          Per-table breakdown
                        </button>

                        {syncExpanded && (
                          <div className="border-t border-border/30">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-muted-foreground">
                                  <th className="px-3 py-1.5 font-medium">Table</th>
                                  <th className="px-3 py-1.5 text-right font-medium">Records</th>
                                  <th className="px-3 py-1.5 text-right font-medium">Last Sync</th>
                                  <th className="px-3 py-1.5 text-center font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/20">
                                {syncState.map((table) => (
                                  <tr key={table.table_name} className="text-card-foreground">
                                    <td className="px-3 py-1.5 font-medium">
                                      {TABLE_LABELS[table.table_name] ?? table.table_name}
                                    </td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">
                                      {(table.record_count ?? 0).toLocaleString()}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                                      {relativeTime(table.last_full_sync_at)}
                                    </td>
                                    <td className="px-3 py-1.5 text-center">
                                      {table.last_error ? (
                                        <span title={table.last_error}>
                                          <AlertTriangle className="mx-auto h-3.5 w-3.5 text-medship-danger" />
                                        </span>
                                      ) : table.last_full_sync_at ? (
                                        <CheckCircle className="mx-auto h-3.5 w-3.5 text-emerald-500" />
                                      ) : (
                                        <span className="text-muted-foreground/40">—</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 rounded-lg border border-border/50">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-card-foreground">Fishbowl Sync Schedules</p>
                      <p className="text-xs text-muted-foreground">
                        Manual controls for scheduled Fishbowl automations
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchAutomationStatus(true)}
                      disabled={refreshingAutomationStatus}
                      className="gap-1.5 text-xs"
                    >
                      <RefreshCw
                        className={cn('h-3.5 w-3.5', refreshingAutomationStatus && 'animate-spin')}
                      />
                      Refresh
                    </Button>
                  </div>

                  <div className="divide-y divide-border/30">
                    {FISHBOWL_SYNC_CONTROLS.map((control) => {
                      const status = automationStatusById.get(control.automation)
                      const isTriggering = triggeringAutomation === control.automation

                      return (
                        <div
                          key={control.automation}
                          className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_auto]"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-card-foreground">{control.label}</p>
                              <StatusBadge
                                status={isTriggering ? 'Running' : displayStatus(status?.lastRunStatus)}
                                variant="dot"
                              />
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{control.description}</p>
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock className="h-3.5 w-3.5" />
                              {formatSchedule(status?.cronExpression)}
                              {status?.isActive === false && ' (disabled)'}
                            </p>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                            <div>
                              <span className="text-muted-foreground">Last run</span>
                              <p className="font-medium">{relativeTime(status?.lastRunAt ?? null)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Duration</span>
                              <p className="font-medium">{formatDuration(status?.lastRunDurationMs)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Records</span>
                              <p className="font-medium">
                                {(status?.recordsProcessed ?? 0).toLocaleString()}
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">24h success</span>
                              <p className="font-medium">{status?.stats24h.successRate ?? 0}%</p>
                            </div>
                            {status?.latestError?.message && (
                              <div className="col-span-2 flex items-start gap-1.5 text-medship-danger sm:col-span-4">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span className="line-clamp-2">
                                  Latest error: {status.latestError.message}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-start lg:justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => triggerAutomationSync(control.automation)}
                              disabled={isTriggering}
                              className="gap-1.5"
                            >
                              {isTriggering ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                              Run Now
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ============================================================ */}
            {/* Connection Config Cards (existing)                           */}
            {/* ============================================================ */}
            {SYSTEM_CONFIGS.map((system) => {
              const conn = getConnectionForSystem(system.key)
              const isConnected = conn?.is_active ?? false
              const isPhase2 = system.phase2
              const isEnvBacked = conn?.credential_source === 'environment'
              const allFieldsLocked = system.fields.every((field) =>
                isFieldLocked(conn, field.name)
              )

              return (
                <Card key={system.key} className={cn(isPhase2 && 'opacity-60')}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-lg',
                            isConnected ? 'bg-medship-success/10' : 'bg-muted'
                          )}
                        >
                          <system.icon
                            className={cn(
                              'h-5 w-5',
                              isConnected ? 'text-medship-success' : 'text-muted-foreground'
                            )}
                          />
                        </div>
                        <div>
                          <CardTitle className="text-base">{system.label}</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {isPhase2
                              ? 'Coming in Phase 2'
                              : isEnvBacked
                                ? `${configuredFieldCount(conn)} field(s) configured in Railway env`
                              : conn?.last_error
                                ? conn.last_error
                                : `Last connected: ${formatTimestamp(conn?.last_connected_at ?? null)}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          status={
                            isPhase2
                              ? 'not_configured'
                              : isConnected
                                ? 'connected'
                                : 'disconnected'
                          }
                        />
                        {!isPhase2 && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => saveCredentials(system.key)}
                              disabled={saving === system.key || allFieldsLocked}
                              title={allFieldsLocked ? 'Credentials are managed in Railway env' : undefined}
                            >
                              {saving === system.key ? (
                                <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="mr-1 h-4 w-4" />
                              )}
                              Save
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => testConnection(system.key)}
                              disabled={testing === system.key}
                            >
                              <RefreshCw
                                className={cn(
                                  'mr-1 h-4 w-4',
                                  testing === system.key && 'animate-spin'
                                )}
                              />
                              <span className="hidden sm:inline">Test Connection</span>
                              <span className="sm:hidden">Test</span>
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2">
                      {system.fields.map((field) => {
                        const fieldKey = `${system.key}.${field.name}`
                        const isPassword = field.type === 'password'
                        const isVisible = visiblePasswords.has(fieldKey)
                        const locked = isFieldLocked(conn, field.name)
                        const displayValue = locked
                          ? isPassword
                            ? '************'
                            : 'Configured in Railway env'
                          : formValues[system.key]?.[field.name] ?? ''

                        return (
                          <div key={field.name}>
                            <label className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                              <span>{field.label}</span>
                              {locked && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                                  <Lock className="h-3 w-3" />
                                  Locked
                                </span>
                              )}
                            </label>
                            <div className="relative">
                              <Input
                                type={isPassword && !isVisible ? 'password' : 'text'}
                                placeholder={locked ? 'Configured in Railway env' : field.placeholder}
                                disabled={isPhase2 || locked}
                                className={cn('pr-10', locked && 'font-medium text-muted-foreground')}
                                value={displayValue}
                                onChange={(e) =>
                                  updateField(system.key, field.name, e.target.value)
                                }
                              />
                              {isPassword && !isPhase2 && !locked && (
                                <button
                                  type="button"
                                  onClick={() => togglePasswordVisibility(fieldKey)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                  {isVisible ? (
                                    <EyeOff className="h-4 w-4" />
                                  ) : (
                                    <Eye className="h-4 w-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )
            })}

            {/* Danger Zone */}
            <Card className="border-medship-danger/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-medship-danger">
                  <AlertTriangle className="h-5 w-5" />
                  Danger Zone
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">
                  Reset all sync data. This will clear all sync events, reset automation
                  schedules, and remove cached inventory snapshots. This action cannot be undone.
                </p>
                <div className="flex items-center gap-3">
                  <Input
                    placeholder='Type "RESET" to confirm'
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    className="w-64"
                  />
                  <Button
                    variant="destructive"
                    disabled={resetConfirm !== 'RESET'}
                    onClick={() => {
                      toast.success('All sync data has been reset')
                      setResetConfirm('')
                    }}
                  >
                    Reset All Sync Data
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
