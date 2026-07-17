import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  chicagoMidnightUtc,
  chicagoNextMidnightUtc,
} from '../../incentive/dates.ts'
import { isKitOrderNumber } from '../../kits/order-number.ts'
import {
  buildReceivingOrders,
  countsAsReceived,
  type OpenDemandFact,
  type ReceiptFact,
} from '../receiving-rules.ts'

function receipt(overrides: Partial<ReceiptFact> = {}): ReceiptFact {
  return {
    receiptItemId: 1,
    receiptId: 10,
    poNumber: '28512',
    vendorName: 'Medline',
    poLineId: 100,
    partNumber: 'PART-1',
    quantity: 2,
    receivedAt: '2026-07-15T15:00:00.000Z',
    receiptStatus: 'Received',
    receiptItemStatus: 'Received',
    ...overrides,
  }
}

describe('kit order classification', () => {
  it('accepts only an exact, case-insensitive -KIT suffix', () => {
    assert.equal(isKitOrderNumber('123-KIT'), true)
    assert.equal(isKitOrderNumber('123-kit'), true)
    assert.equal(isKitOrderNumber(' 123-KIT '), true)
    assert.equal(isKitOrderNumber('123-KIT-REMAKE'), false)
    assert.equal(isKitOrderNumber('KIT-123'), false)
  })
})

describe('Chicago receiving day boundaries', () => {
  it('uses CDT midnight during summer', () => {
    assert.equal(
      chicagoMidnightUtc('2026-07-15').toISOString(),
      '2026-07-15T05:00:00.000Z'
    )
    assert.equal(
      chicagoNextMidnightUtc('2026-07-15').toISOString(),
      '2026-07-16T05:00:00.000Z'
    )
  })

  it('handles the DST fall-back day with a 25-hour window', () => {
    const start = chicagoMidnightUtc('2026-11-01')
    const end = chicagoNextMidnightUtc('2026-11-01')
    assert.equal((end.getTime() - start.getTime()) / 3_600_000, 25)
  })
})

describe('receiving aggregation', () => {
  it('counts a PO line once even when it arrives in two deliveries', () => {
    const facts = [
      receipt(),
      receipt({
        receiptItemId: 2,
        receiptId: 11,
        quantity: 3,
        receivedAt: '2026-07-15T17:00:00.000Z',
      }),
      receipt({
        receiptItemId: 3,
        receiptId: 11,
        poLineId: 101,
        partNumber: 'PART-2',
        quantity: 1,
      }),
    ]
    const orders = buildReceivingOrders({
      facts,
      totalLinesByPo: new Map([['28512', 8]]),
      demandByPart: new Map(),
      includeCrossDock: false,
    })

    assert.equal(orders.length, 1)
    assert.equal(orders[0].linesReceivedToday, 2)
    assert.equal(orders[0].totalPoLines, 8)
    assert.equal(orders[0].deliveriesToday, 2)
    assert.equal(orders[0].quantityReceivedToday, 6)
    assert.equal(orders[0].lastReceivedAt, '2026-07-15T17:00:00.000Z')
  })

  it('retains but excludes voids and non-positive corrections from counts', () => {
    assert.equal(countsAsReceived(receipt({ receiptStatus: 'Voided' })), false)
    assert.equal(countsAsReceived(receipt({ quantity: -2 })), false)
    assert.deepEqual(
      buildReceivingOrders({
        facts: [
          receipt({ receiptStatus: 'Voided' }),
          receipt({ receiptItemId: 2, quantity: -2 }),
        ],
        totalLinesByPo: new Map(),
        demandByPart: new Map(),
        includeCrossDock: true,
      }),
      []
    )
  })

  it('reports all matching demand without allocating received quantity', () => {
    const demand: OpenDemandFact[] = [
      {
        soNumber: 'SO-200',
        kind: 'sales',
        remaining: 4,
        priorityDate: '2026-07-20',
      },
      {
        soNumber: 'SO-100-KIT',
        kind: 'kit',
        remaining: 4,
        priorityDate: '2026-07-17',
      },
    ]
    const [order] = buildReceivingOrders({
      facts: [receipt({ quantity: 5 })],
      totalLinesByPo: new Map([['28512', 8]]),
      demandByPart: new Map([['PART-1', demand]]),
      includeCrossDock: true,
    })

    assert.equal(order.crossDockCandidates.length, 1)
    assert.equal(order.crossDockCandidates[0].quantityReceivedToday, 5)
    assert.deepEqual(
      order.crossDockCandidates[0].demand.map((row) => row.soNumber),
      ['SO-100-KIT', 'SO-200']
    )
    assert.equal(order.crossDockOrderCount, 2)
  })
})
