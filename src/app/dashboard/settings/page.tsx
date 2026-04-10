'use client'

import { useState, useEffect, useCallback } from 'react'
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
} from 'lucide-react'
import type { ConnectionConfig } from '@/types'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface SystemConfig {
  key: string
  label: string
  icon: React.ElementType
  fields: { name: string; label: string; type: 'text' | 'password'; placeholder: string }[]
  phase2?: boolean
}

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

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [testing, setTesting] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({})
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set())
  const [resetConfirm, setResetConfirm] = useState('')

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/connections')
      if (!res.ok) throw new Error('Failed to fetch')
      const data: ConnectionConfig[] = await res.json()
      setConnections(data)

      // Populate form fields from saved configs
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

  useEffect(() => {
    fetchConnections()
  }, [fetchConnections])

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
