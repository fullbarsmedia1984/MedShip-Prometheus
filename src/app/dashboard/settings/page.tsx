'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConnectionIndicator } from '@/components/dashboard/ConnectionIndicator'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'not_configured'

interface SystemConnection {
  name: string
  displayName: string
  status: ConnectionStatus
  message?: string
  lastChecked: string
}

interface HealthResponse {
  status: string
  timestamp: string
  version: string
  connections: Record<
    string,
    {
      status: ConnectionStatus
      message?: string
      lastChecked: string
    }
  >
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState<SystemConnection[]>([])
  const [version, setVersion] = useState('')
  const [testing, setTesting] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/health')
      const data: HealthResponse = await response.json()

      const systems: SystemConnection[] = Object.entries(data.connections).map(
        ([name, info]) => ({
          name,
          displayName: name.charAt(0).toUpperCase() + name.slice(1),
          status: info.status,
          message: info.message,
          lastChecked: info.lastChecked,
        })
      )

      setConnections(systems)
      setVersion(data.version)
    } catch (error) {
      console.error('Failed to fetch health:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
  }, [fetchHealth])

  const testConnection = async (system: string) => {
    setTesting(system)
    try {
      await fetchHealth()
      toast.success(`${system} connection tested`)
    } catch (error) {
      toast.error(`Failed to test ${system} connection`)
    } finally {
      setTesting(null)
    }
  }

  const getConfigLink = (system: string): string | null => {
    switch (system) {
      case 'supabase':
        return 'https://supabase.com/dashboard'
      case 'salesforce':
        return 'https://login.salesforce.com'
      case 'quickbooks':
        return 'https://developer.intuit.com'
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col">
      <Header title="Settings" showRefresh onRefresh={fetchHealth} />

      <div className="space-y-6 p-6">
        {/* Connection Status */}
        <Card>
          <CardHeader>
            <CardTitle>Connection Status</CardTitle>
            <p className="text-sm text-gray-500">
              Status of all external system connections.
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <div className="text-gray-500">Loading...</div>
              </div>
            ) : (
              <div className="space-y-4">
                {connections.map((conn) => (
                  <div
                    key={conn.name}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-4">
                      <ConnectionIndicator status={conn.status} size="lg" />
                      <div>
                        <h3 className="font-medium">{conn.displayName}</h3>
                        {conn.message && (
                          <p className="text-sm text-gray-500">{conn.message}</p>
                        )}
                        <p className="text-xs text-gray-400">
                          Last checked:{' '}
                          {new Date(conn.lastChecked).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          conn.status === 'connected'
                            ? 'default'
                            : conn.status === 'not_configured'
                              ? 'secondary'
                              : 'destructive'
                        }
                      >
                        {conn.status.replace('_', ' ')}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testConnection(conn.name)}
                        disabled={testing === conn.name}
                      >
                        <RefreshCw
                          className={`mr-1 h-4 w-4 ${
                            testing === conn.name ? 'animate-spin' : ''
                          }`}
                        />
                        Test
                      </Button>
                      {getConfigLink(conn.name) && (
                        <a
                          href={getConfigLink(conn.name)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center justify-center rounded-md px-2 text-sm hover:bg-muted"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Environment Info */}
        <Card>
          <CardHeader>
            <CardTitle>Environment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Version</span>
                <span className="font-mono">{version || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Environment</span>
                <span className="font-mono">
                  {process.env.NODE_ENV || 'development'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">App URL</span>
                <span className="font-mono">
                  {process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Configuration Note */}
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              API credentials and connection settings are managed via environment
              variables. Update your <code className="rounded bg-gray-100 px-1">.env.local</code>{' '}
              file or Railway environment variables to configure connections.
            </p>
            <div className="mt-4 rounded bg-gray-50 p-4">
              <h4 className="mb-2 text-sm font-medium">Required Variables</h4>
              <ul className="space-y-1 text-xs text-gray-600">
                <li>
                  <code>NEXT_PUBLIC_SUPABASE_URL</code> - Supabase project URL
                </li>
                <li>
                  <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> - Supabase anon key
                </li>
                <li>
                  <code>SUPABASE_SERVICE_ROLE_KEY</code> - For background jobs
                </li>
                <li>
                  <code>SF_CLIENT_ID</code> - Salesforce Connected App ID
                </li>
                <li>
                  <code>FISHBOWL_API_URL</code> - Fishbowl server URL
                </li>
                <li>
                  <code>INNGEST_EVENT_KEY</code> - Inngest event key
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
