import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const { expandSalesOrderItems } = await import(
  new URL('../sales-order-items.ts', import.meta.url).href
)

describe('Fishbowl kit components', () => {
  it('flattens Fishbowl kitItems while preserving parent lineage', () => {
    const expanded = expandSalesOrderItems([
      {
        id: 100,
        lineNumber: 1,
        type: { name: 'Kit' },
        product: { name: 'MASTER-KIT', description: 'Kit master' },
        quantity: 20,
        kitItems: [
          {
            id: 101,
            lineNumber: 2,
            type: { name: 'Sale' },
            product: { name: 'COMPONENT-A', description: 'Component A' },
            quantity: 40,
          },
        ],
      },
    ])

    assert.equal(expanded.length, 2)
    assert.equal((expanded[0].product as { name: string }).name, 'MASTER-KIT')
    assert.equal((expanded[1].product as { name: string }).name, 'COMPONENT-A')
    assert.equal(expanded[1].lineNumber, 2)
    assert.equal(expanded[1]._kitParentLineId, 100)
    assert.equal(expanded[1]._kitParentLineNumber, 1)
  })
})
