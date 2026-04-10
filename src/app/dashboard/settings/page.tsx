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
  Save,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Zap,
  Leaf,
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

interface SystemConfig {
  key: string
  label: string
  icon: React.ElementType
  fields: { name: string; label: string; type: 'text' | 'password'; placeholder: string }[]
  phase2?: boolean
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  // Connection config state
  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [testing, setTesting] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({})
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set())
  const [resetConfirm, setResetConfirm] = useState('')

  // Data source state
  const [dataSourceMode, setDataSourceMode] = useState<'seed' | 'live'>('seed')
  const [pendingMode, setPendingMode] = useState<'live' | null>(null)
  const [syncState, setSyncState] = useState<SyncTableState[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncExpanded, setSyncExpanded] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/connections')
      if (!res.ok) throw new Error('Failed to fetch')
      const data: ConnectionConfig[] = await res.json()
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
        const data = await res.json()
        setDataSourceMode(data.mode ?? 'seed')
      }
    } catch {
      // Supabase may not be configured — default to seed
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

  useEffect(() => {
    fetchConnections()
    fetchDataSource()
    fetchSyncState()
  }, [fetchConnections, fetchDataSource, fetchSyncState])

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

  const formatTimestamp = (ts: string | null) => {
    if (!ts) return 'Never'
    return new Date(ts).toLocaleString()
  }

  // ---------------------------------------------------------------------------
  // Data source handlers
  // ---------------------------------------------------------------------------

  const handleModeToggle = async (mode: 'seed' | 'live') => {
    if (mode === dataSourceMode) return

    if (mode === 'live') {
      // Show inline confirmation
      setPendingMode('live')
      return
    }

    // Switching to seed — no confirmation needed
    await applyMode('seed')
  }

  const applyMode = async (mode: 'seed' | 'live') => {
    try {
      const res = await fetch('/api/settings/data-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (res.ok) {
        setDataSourceMode(mode)
        setPendingMode(null)
        toast.success(`Switched to ${mode === 'live' ? 'Live Data' : 'Seed Data'}`, {
          description: mode === 'live'
            ? 'Dashboard will now show live Salesforce data from the cache.'
            : 'Dashboard will now show demo data.',
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

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const totalRecordsCached = syncState.reduce((s, t) => s + (t.record_count ?? 0), 0)
  const lastFullSync = syncState
    .map((s) => s.last_full_sync_at)
    .filter(Boolean)
    .sort()
    .pop() ?? null
  const hasErrors = syncState.some((s) => s.last_error)
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
                      Choose whether the dashboard reads from demo data or live Salesforce
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
                      {/* Segmented control */}
                      <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-1">
                        <button
                          onClick={() => handleModeToggle('seed')}
                          className={cn(
                            'relative flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-all',
                            dataSourceMode === 'seed'
                              ? 'bg-amber-500/15 text-amber-600 shadow-sm'
                              : 'text-muted-foreground hover:text-card-foreground'
                          )}
                        >
                          <Leaf className="h-4 w-4" />
                          Seed Data
                        </button>
                        <button
                          onClick={() => handleModeToggle('live')}
                          className={cn(
                            'relative flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-all',
                            dataSourceMode === 'live'
                              ? 'bg-emerald-500/15 text-emerald-600 shadow-sm'
                              : 'text-muted-foreground hover:text-card-foreground'
                          )}
                        >
                          <Zap className="h-4 w-4" />
                          Live Data
                        </button>
                      </div>

                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        {isLive
                          ? 'Using live Salesforce data cached in Supabase. Data refreshes via scheduled syncs every 15 minutes.'
                          : 'Using demo data for testing and demonstrations. No Salesforce queries are made.'}
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
                          Live mode active but no data has been synced. Click <strong>Sync Now</strong> to pull from Salesforce.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right: Sync Status */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-card-foreground">Salesforce Sync Status</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Last sync: <strong className="text-card-foreground">{relativeTime(lastFullSync)}</strong></span>
                        <span className="text-border">|</span>
                        <span><strong className="text-card-foreground">{totalRecordsCached.toLocaleString()}</strong> records</span>
                      </div>
                    </div>

                    {/* Sync Now button */}
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
                      {syncing ? 'Syncing...' : 'Sync Now'}
                    </Button>

                    {/* Error warning */}
                    {hasErrors && !syncing && (
                      <div className="flex items-center gap-2 text-xs text-medship-danger">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>Some tables had errors during last sync</span>
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
              </CardContent>
            </Card>

            {/* ============================================================ */}
            {/* Connection Config Cards (existing)                           */}
            {/* ============================================================ */}
            {SYSTEM_CONFIGS.map((system) => {
              const conn = getConnectionForSystem(system.key)
              const isConnected = conn?.is_active ?? false
              const isPhase2 = system.phase2

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
                              disabled={saving === system.key}
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

                        return (
                          <div key={field.name}>
                            <label className="mb-1.5 block text-sm font-medium">
                              {field.label}
                            </label>
                            <div className="relative">
                              <Input
                                type={isPassword && !isVisible ? 'password' : 'text'}
                                placeholder={field.placeholder}
                                disabled={isPhase2}
                                className="pr-10"
                                value={formValues[system.key]?.[field.name] ?? ''}
                                onChange={(e) => updateField(system.key, field.name, e.target.value)}
                              />
                              {isPassword && !isPhase2 && (
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
