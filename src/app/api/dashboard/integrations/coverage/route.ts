import { NextResponse } from 'next/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeSalesOrderCoverage, type SalesOrderCoverage } from '@/lib/fishbowl/sales-order-completeness'

function isMissingRelationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('42p01') || message.includes('could not find the table') || message.includes('does not exist')
}

/**
 * Lightweight P7 monitoring endpoint. The integrations page polls this every
 * 5s while a sales-order sync is running; it deliberately bypasses the cached
 * coverage rollup (and skips the full integrations dashboard payload) so the
 * poll reflects in-flight sync progress.
 */
export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const salesOrderCoverage = await computeSalesOrderCoverage(createAdminClient()).catch((error) => {
      if (isMissingRelationError(error)) return null as SalesOrderCoverage | null
      throw error
    })

    return NextResponse.json({ salesOrderCoverage })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
