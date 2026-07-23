import { NextResponse } from 'next/server'

import {
  ADMIN_API_AUTH_OPTIONS,
  STAFF_API_AUTH_OPTIONS,
  requireApiAuth,
} from '@/lib/auth'
import { inngest } from '@/inngest/client'
import { getReceivingData } from '@/lib/warehouse-board/receiving-data'

// POST /api/sync/receipts — start the audited P14 receipt-event sync.
export async function POST() {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    await inngest.send({
      name: 'fishbowl/receipts.sync',
      data: { triggeredAt: new Date().toISOString() },
    })
    return NextResponse.json({
      triggered: true,
      message: 'Receipt-event sync started',
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET /api/sync/receipts — safe reconciliation/freshness summary.
export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const data = await getReceivingData()
    return NextResponse.json({
      chicagoDate: data.chicagoDate,
      source: data.source,
      sourceLabel: data.sourceLabel,
      syncStatus: data.syncStatus,
      syncAgeMinutes: data.syncAgeMinutes,
      totals: data.totals,
      purchaseOrders: data.orders.map((order) => ({
        poNumber: order.poNumber,
        vendorName: order.vendorName,
        linesReceivedToday: order.linesReceivedToday,
        totalPoLines: order.totalPoLines,
        deliveriesToday: order.deliveriesToday,
        quantityReceivedToday: data.isBeta
          ? null
          : order.quantityReceivedToday,
        crossDockCandidateParts: order.crossDockCandidates.length,
      })),
      error: data.error,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
