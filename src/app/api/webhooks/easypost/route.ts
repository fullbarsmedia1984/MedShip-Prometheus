import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/utils/logger'
import type { EPWebhookEvent, EPTracker } from '@/lib/easypost/types'

/**
 * EasyPost tracking webhook receiver
 *
 * Receives tracking status updates from EasyPost when shipment
 * status changes (in_transit, delivered, etc.).
 *
 * TODO: Implement in Phase 4 Path B
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EPWebhookEvent

    logger.log('info', 'P4_SHIPMENT_TRACKING', 'Received EasyPost webhook', {
      eventId: body.id,
      description: body.description,
    })

    // TODO: Implement in Phase 4 - Verify webhook signature
    // const signature = request.headers.get('x-hmac-signature')
    // if (!verifySignature(signature, body)) {
    //   return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    // }

    // Handle tracker updates
    if (body.description === 'tracker.updated') {
      const tracker = body.result as EPTracker

      logger.log('info', 'P4_SHIPMENT_TRACKING', 'Tracker status update', {
        trackingCode: tracker.tracking_code,
        status: tracker.status,
        carrier: tracker.carrier,
      })

      // TODO: Implement in Phase 4
      // 1. Find the SF Opportunity by tracking number
      // 2. Update delivery status on SF record
      // 3. If delivered, trigger any post-delivery actions
    }

    return NextResponse.json({
      success: true,
      message: 'Webhook received',
    })
  } catch (error) {
    logger.log('error', 'P4_SHIPMENT_TRACKING', 'EasyPost webhook failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint for EasyPost webhook verification
 */
export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: 'easypost-webhook',
    timestamp: new Date().toISOString(),
  })
}
