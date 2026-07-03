import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { logSyncEvent, updateSyncEvent } from '@/lib/utils/logger'

type Automation =
  | 'P1_OPP_TO_SO'
  | 'P2_INVENTORY_SYNC'
  | 'P3_QB_INVOICE_SYNC'
  | 'P4_SHIPMENT_TRACKING'
  | 'P5_QUOTE_PDF'
  | 'P6_LOW_STOCK_CHECK'
  | 'P7_FB_SO_SYNC'
  | 'P8_INCENTIVE_RECOMPUTE'

/**
 * Manual sync trigger endpoint
 *
 * Allows dashboard users to manually trigger sync jobs.
 *
 * POST /api/sync/trigger
 * {
 *   "automation": "P2_INVENTORY_SYNC",
 *   "params": { "fullSync": true }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = await request.json()
    const { automation, params = {} } = body as {
      automation: Automation
      params?: Record<string, unknown>
    }

    if (!automation) {
      return NextResponse.json(
        { error: 'Missing automation parameter' },
        { status: 400 }
      )
    }

    // Map automation to Inngest event
    const eventMap: Record<Automation, { name: string; data: Record<string, unknown> }> = {
      P1_OPP_TO_SO: {
        name: 'salesforce/opportunity.closed',
        data: {
          opportunityId: params.opportunityId,
          accountId: params.accountId,
          amount: params.amount,
          closeDate: params.closeDate,
        },
      },
      P2_INVENTORY_SYNC: {
        name: 'fishbowl/inventory.sync',
        data: { fullSync: params.fullSync ?? false },
      },
      P3_QB_INVOICE_SYNC: {
        name: 'quickbooks/invoice.sync',
        data: { sinceDate: params.sinceDate },
      },
      P4_SHIPMENT_TRACKING: {
        name: 'fishbowl/shipment.sync',
        data: { dayRange: params.dayRange ?? 7 },
      },
      P5_QUOTE_PDF: {
        name: 'salesforce/quote.generate',
        data: {
          quoteId: params.quoteId,
          opportunityId: params.opportunityId,
        },
      },
      P6_LOW_STOCK_CHECK: {
        name: 'inventory/low-stock.check',
        data: { triggeredBy: 'manual' },
      },
      P7_FB_SO_SYNC: {
        name: 'fishbowl/sales-orders.sync',
        data: {
          fullSync: params.fullSync ?? true,
          action: params.action ?? (params.fullSync === false ? 'incremental' : 'backfill.start'),
          triggeredBy: 'manual',
        },
      },
      P8_INCENTIVE_RECOMPUTE: {
        name: 'incentive/recompute',
        data: { triggeredBy: 'manual' },
      },
    }

    const eventConfig = eventMap[automation]

    if (!eventConfig) {
      return NextResponse.json(
        { error: `Unknown automation: ${automation}` },
        { status: 400 }
      )
    }

    // Validate required params for certain automations
    if (automation === 'P1_OPP_TO_SO' && !params.opportunityId) {
      return NextResponse.json(
        { error: 'P1 requires opportunityId parameter' },
        { status: 400 }
      )
    }

    if (automation === 'P5_QUOTE_PDF' && !params.quoteId) {
      return NextResponse.json(
        { error: 'P5 requires quoteId parameter' },
        { status: 400 }
      )
    }

    const triggerPayload = {
      eventName: eventConfig.name,
      eventData: eventConfig.data,
      params,
      requestedBy: auth.user?.email ?? (auth.isDevBypass ? 'local-dev-bypass' : 'unknown'),
      requestedByUserId: auth.user?.id ?? null,
    }

    const auditEventId = await logSyncEvent({
      automation,
      sourceSystem: 'prometheus',
      targetSystem: 'inngest',
      status: 'pending',
      payload: triggerPayload,
    })

    let ids: string[]

    try {
      // Send event to Inngest after the request is auditable in sync_events.
      const sendResult = await inngest.send({
        name: eventConfig.name,
        data: eventConfig.data,
      })
      ids = sendResult.ids
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Unknown Inngest send error'
      await updateSyncEvent(auditEventId, {
        status: 'failed',
        errorMessage: message,
        response: {
          eventName: eventConfig.name,
          automation,
        },
      })
      throw sendError
    }

    await updateSyncEvent(auditEventId, {
      response: {
        eventName: eventConfig.name,
        eventId: ids[0],
        automation,
      },
      targetRecordId: ids[0],
    })

    return NextResponse.json({
      success: true,
      message: `${automation} triggered successfully`,
      eventId: ids[0],
      auditEventId,
      automation,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
