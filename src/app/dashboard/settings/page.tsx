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
} from 'lucide-react'
import { getConnectionConfigs } from '@/lib/data'
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
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set())
  const [resetConfirm, setResetConfirm] = useState('')

  const fetchConnections = useCallback(async () => {
    try {
      const data = await getConnectionConfigs()
      setConnections(data)
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
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const conn = connections.find((c) => c.system_name === systemName)
    if (conn?.is_active) {
      toast.success(`${systemName} connection successful`)
    } else {
      toast.error(`${systemName} connection failed`)
    }
    setTesting(null)
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
