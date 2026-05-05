import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/utils/logger'
import type { EPWebhookEvent, EPTracker } from '@/lib/easypost/types'
import { verifySharedSecretHeader } from '@/lib/webhooks/verification'

/**
 * EasyPost tracking webhook receiver
 *
 * Receives tracking status updates from EasyPost when shipment
 * status changes (in_transit, delivered, etc.).
 *
 * TODO(webhook): Replace this shared-secret gate with EasyPost's final
 * webhook signing contract when Phase 4 is enabled.
 */
export async function POST(request: NextRequest) {
  try {
    const webhookSecret = process.env.EASYPOST_WEBHOOK_SECRET
    if (!webhookSecret) {
      return NextResponse.json(
        { error: 'EasyPost webhook is not configured' },
        { status: 503 }
      )
    }

    if (!verifySharedSecretHeader(request, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 })
    }

    const body = (await request.json()) as EPWebhookEvent

    logger.log('info', 'P4_SHIPMENT_TRACKING', 'Received EasyPost webhook', {
      eventId: body.id,
      description: body.description,
    })

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
