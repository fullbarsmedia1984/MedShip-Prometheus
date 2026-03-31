import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest'
import { logger } from '@/lib/utils/logger'

/**
 * Salesforce Platform Event receiver
 *
 * Receives webhook notifications from Salesforce when Opportunities are closed-won.
 * Triggers the P1 automation (Opportunity → Fishbowl Sales Order).
 *
 * Expected payload format (from SF Platform Event):
 * {
 *   "replayId": 12345,
 *   "payload": {
 *     "OpportunityId__c": "006xxxxx",
 *     "AccountId__c": "001xxxxx",
 *     "Amount__c": 1500.00,
 *     "CloseDate__c": "2024-01-15",
 *     "CreatedDate": "2024-01-15T10:30:00.000Z"
 *   }
 * }
 *
 * TODO: Implement webhook signature verification in Phase 1
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    logger.log('info', 'P1_OPP_TO_SO', 'Received Salesforce webhook', {
      replayId: body.replayId,
    })

    // TODO: Implement in Phase 1 - Verify webhook signature
    // const signature = request.headers.get('x-salesforce-signature')
    // if (!verifySignature(signature, body)) {
    //   return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    // }

    // Extract payload from Platform Event format
    const payload = body.payload || body

    const opportunityId = payload.OpportunityId__c || payload.opportunityId
    const accountId = payload.AccountId__c || payload.accountId
    const amount = payload.Amount__c || payload.amount
    const closeDate = payload.CloseDate__c || payload.closeDate

    if (!opportunityId) {
      return NextResponse.json(
        { error: 'Missing OpportunityId' },
        { status: 400 }
      )
    }

    // Trigger the Inngest function
    await inngest.send({
      name: 'salesforce/opportunity.closed',
      data: {
        opportunityId,
        accountId,
        amount,
        closeDate,
      },
    })

    logger.log('info', 'P1_OPP_TO_SO', 'Triggered opportunity sync', {
      opportunityId,
    })

    return NextResponse.json({
      success: true,
      message: 'Webhook received and processing started',
      opportunityId,
    })
  } catch (error) {
    logger.log('error', 'P1_OPP_TO_SO', 'Webhook processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint for Salesforce webhook verification
 * Salesforce may ping this endpoint to verify it's active
 */
export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: 'salesforce-webhook',
    timestamp: new Date().toISOString(),
  })
}
