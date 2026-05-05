import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { testQuickBooksConnection } from '@/lib/quickbooks/client'

/**
 * GET /api/health/quickbooks
 * Authenticated QuickBooks connection diagnostic.
 */
export async function GET() {
  const auth = await requireApiAuth()
  if (!auth.authorized) return auth.response

  const timestamp = new Date().toISOString()

  try {
    if (!process.env.QB_CLIENT_ID || !process.env.QB_REALM_ID) {
      return NextResponse.json({
        connected: false,
        error: 'QuickBooks credentials are not configured',
        timestamp,
      })
    }

    const result = await testQuickBooksConnection()

    return NextResponse.json({
      connected: result.success,
      error: result.error,
      timestamp,
    })
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp,
    })
  }
}
