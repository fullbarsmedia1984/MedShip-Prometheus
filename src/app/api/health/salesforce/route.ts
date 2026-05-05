import { NextResponse } from 'next/server'
import { createSalesforceClient } from '@/lib/salesforce/client'
import { requireApiAuth } from '@/lib/auth'

export async function GET() {
  const auth = await requireApiAuth()
  if (!auth.authorized) return auth.response

  const client = createSalesforceClient()

  try {
    const result = await client.testConnection()

    return NextResponse.json(
      {
        connected: result.success,
        orgId: result.orgId,
        error: result.error,
        timestamp: new Date().toISOString(),
      },
      { status: result.success ? 200 : 503 }
    )
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  } finally {
    await client.disconnect()
  }
}
