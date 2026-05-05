import { NextResponse } from 'next/server'

type HealthResponse = {
  status: 'ok'
  timestamp: string
  version: string
  service: string
}

/**
 * Public liveness check for Railway and uptime probes.
 * Keep detailed external diagnostics behind authenticated endpoints.
 */
export async function GET(): Promise<NextResponse<HealthResponse>> {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      service: 'medship-prometheus',
    },
    { status: 200 }
  )
}
