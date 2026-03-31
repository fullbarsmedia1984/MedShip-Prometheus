import { NextResponse } from 'next/server'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { testFishbowlConnection } from '@/lib/fishbowl/client'
import { testQuickBooksConnection } from '@/lib/quickbooks/client'
import { createAdminClient } from '@/lib/supabase/admin'

interface ConnectionStatus {
  status: 'connected' | 'disconnected' | 'error' | 'not_configured'
  message?: string
  lastChecked: string
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  version: string
  connections: {
    supabase: ConnectionStatus
    salesforce: ConnectionStatus
    fishbowl: ConnectionStatus
    quickbooks: ConnectionStatus
  }
}

/**
 * Health check endpoint for Railway deployment
 * Returns status of all external connections
 */
export async function GET(): Promise<NextResponse<HealthResponse>> {
  const timestamp = new Date().toISOString()
  const version = process.env.npm_package_version || '0.1.0'

  const connections: HealthResponse['connections'] = {
    supabase: { status: 'disconnected', lastChecked: timestamp },
    salesforce: { status: 'disconnected', lastChecked: timestamp },
    fishbowl: { status: 'disconnected', lastChecked: timestamp },
    quickbooks: { status: 'not_configured', lastChecked: timestamp },
  }

  // Check Supabase
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('sync_schedules').select('id').limit(1)

    if (error) {
      connections.supabase = {
        status: 'error',
        message: error.message,
        lastChecked: timestamp,
      }
    } else {
      connections.supabase = {
        status: 'connected',
        lastChecked: timestamp,
      }
    }
  } catch (error) {
    connections.supabase = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: timestamp,
    }
  }

  // Check Salesforce
  try {
    if (process.env.SF_USERNAME) {
      const sfClient = createSalesforceClient()
      const sfResult = await sfClient.testConnection()
      await sfClient.disconnect()
      connections.salesforce = {
        status: sfResult.success ? 'connected' : 'error',
        message: sfResult.error,
        lastChecked: timestamp,
      }
    } else {
      connections.salesforce = {
        status: 'not_configured',
        message: 'Salesforce credentials not configured',
        lastChecked: timestamp,
      }
    }
  } catch (error) {
    connections.salesforce = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: timestamp,
    }
  }

  // Check Fishbowl
  try {
    if (process.env.FISHBOWL_API_URL) {
      const fbResult = await testFishbowlConnection()
      connections.fishbowl = {
        status: fbResult.success ? 'connected' : 'error',
        message: fbResult.error,
        lastChecked: timestamp,
      }
    } else {
      connections.fishbowl = {
        status: 'not_configured',
        message: 'Fishbowl API URL not configured',
        lastChecked: timestamp,
      }
    }
  } catch (error) {
    connections.fishbowl = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: timestamp,
    }
  }

  // Check QuickBooks (optional - P3)
  try {
    if (process.env.QB_CLIENT_ID && process.env.QB_REALM_ID) {
      const qbResult = await testQuickBooksConnection()
      connections.quickbooks = {
        status: qbResult.success ? 'connected' : 'error',
        message: qbResult.error,
        lastChecked: timestamp,
      }
    } else {
      connections.quickbooks = {
        status: 'not_configured',
        message: 'QuickBooks credentials not configured (optional P3)',
        lastChecked: timestamp,
      }
    }
  } catch (error) {
    connections.quickbooks = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: timestamp,
    }
  }

  // Determine overall health status (informational only — never causes non-200)
  const connectionStatuses = Object.values(connections)
  const hasError = connectionStatuses.some((c) => c.status === 'error')
  const hasDisconnected = connectionStatuses.some(
    (c) => c.status === 'disconnected'
  )

  let status: HealthResponse['status'] = 'healthy'
  if (hasError || hasDisconnected) {
    status = 'degraded'
  }

  const response: HealthResponse = {
    status,
    timestamp,
    version,
    connections,
  }

  // Always return 200 — external service status is informational only.
  // Railway uses this endpoint for deploy health checks.
  return NextResponse.json(response, { status: 200 })
}
