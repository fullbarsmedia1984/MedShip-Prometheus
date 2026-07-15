import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  costLineIdentityKey,
  planCostLineSupersedes,
  planRollbackRestores,
} from '../publish-planner.mjs'

function line(overrides = {}) {
  return {
    id: 'line-1',
    created_at: '2026-07-01T00:00:00Z',
    internal_item_id: null,
    distributor_sku: 'SKU-1',
    manufacturer_part_number: null,
    model_number: null,
    gtin: null,
    udi: null,
    ndc: null,
    normalized_price_uom: 'EA',
    raw_price_uom: 'ea',
    tier: null,
    minimum_quantity: null,
    ...overrides,
  }
}

describe('costLineIdentityKey', () => {
  it('prefers internal_item_id over text identifiers', () => {
    const key = costLineIdentityKey(line({ internal_item_id: 'abc-123', distributor_sku: 'SKU-9' }))
    assert.match(key, /^internal_item_id:ABC-123\|/)
  })

  it('falls back through the identifier priority order', () => {
    const key = costLineIdentityKey(line({ distributor_sku: '', manufacturer_part_number: ' mpn-7 ' }))
    assert.match(key, /^manufacturer_part_number:MPN-7\|/)
  })

  it('normalizes case and whitespace so equivalent lines share a key', () => {
    const a = costLineIdentityKey(line({ distributor_sku: ' sku-1 ', normalized_price_uom: 'ea' }))
    const b = costLineIdentityKey(line({ distributor_sku: 'SKU-1', normalized_price_uom: 'EA' }))
    assert.equal(a, b)
  })

  it('separates identity by UOM, tier, and minimum quantity', () => {
    const base = costLineIdentityKey(line())
    assert.notEqual(costLineIdentityKey(line({ normalized_price_uom: 'CS' })), base)
    assert.notEqual(costLineIdentityKey(line({ tier: 'GOLD' })), base)
    assert.notEqual(costLineIdentityKey(line({ minimum_quantity: 10 })), base)
  })

  it('returns null when no item identifier is present', () => {
    assert.equal(costLineIdentityKey(line({ distributor_sku: null })), null)
  })
})

describe('planCostLineSupersedes', () => {
  it('links each pending line to matching active lines and collects superseded ids', () => {
    const pending = [line({ id: 'new-1', distributor_sku: 'SKU-1' }), line({ id: 'new-2', distributor_sku: 'SKU-2' })]
    const active = [line({ id: 'old-1', distributor_sku: 'SKU-1' }), line({ id: 'old-other', distributor_sku: 'SKU-9' })]

    const plan = planCostLineSupersedes(pending, active)
    assert.equal(plan.assignments.length, 1)
    assert.deepEqual(plan.assignments[0], {
      pendingLineId: 'new-1',
      supersedesCostLineId: 'old-1',
      supersededLineIds: ['old-1'],
    })
    assert.deepEqual(plan.supersededLineIds, ['old-1'])
    assert.deepEqual(plan.pendingWithoutIdentity, [])
  })

  it('supersedes every matching active duplicate but records the newest as the link target', () => {
    const pending = [line({ id: 'new-1' })]
    const active = [
      line({ id: 'old-early', created_at: '2026-01-01T00:00:00Z' }),
      line({ id: 'old-late', created_at: '2026-06-01T00:00:00Z' }),
    ]

    const plan = planCostLineSupersedes(pending, active)
    assert.equal(plan.assignments[0].supersedesCostLineId, 'old-late')
    assert.deepEqual([...plan.supersededLineIds].sort(), ['old-early', 'old-late'])
  })

  it('does not match lines with a different UOM', () => {
    const plan = planCostLineSupersedes(
      [line({ id: 'new-1', normalized_price_uom: 'CS' })],
      [line({ id: 'old-1', normalized_price_uom: 'EA' })]
    )
    assert.equal(plan.assignments.length, 0)
    assert.deepEqual(plan.supersededLineIds, [])
  })

  it('reports pending lines without identity instead of matching them', () => {
    const plan = planCostLineSupersedes(
      [line({ id: 'new-1', distributor_sku: null })],
      [line({ id: 'old-1', distributor_sku: null })]
    )
    assert.deepEqual(plan.pendingWithoutIdentity, ['new-1'])
    assert.equal(plan.assignments.length, 0)
  })

  it('flags duplicate identity keys within the pending set', () => {
    const plan = planCostLineSupersedes(
      [line({ id: 'new-1' }), line({ id: 'new-2' })],
      []
    )
    assert.equal(plan.duplicatePendingKeys.length, 1)
  })
})

describe('planRollbackRestores', () => {
  it('collects distinct non-null supersedes targets', () => {
    const restores = planRollbackRestores([
      { supersedes_cost_line_id: 'old-1' },
      { supersedes_cost_line_id: 'old-1' },
      { supersedes_cost_line_id: 'old-2' },
      { supersedes_cost_line_id: null },
      {},
    ])
    assert.deepEqual(restores.sort(), ['old-1', 'old-2'])
  })
})
