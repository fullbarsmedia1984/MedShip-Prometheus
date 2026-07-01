import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const { selectIncrementalSalesOrderPages } = await import(
  new URL('../sales-order-page-bands.ts', import.meta.url).href
)

describe('selectIncrementalSalesOrderPages', () => {
  it('selects first and last page bands for large Fishbowl result sets', () => {
    assert.deepEqual(
      selectIncrementalSalesOrderPages(652, 5),
      [1, 2, 3, 4, 5, 648, 649, 650, 651, 652]
    )
  })

  it('does not duplicate pages when the page bands overlap', () => {
    assert.deepEqual(
      selectIncrementalSalesOrderPages(7, 5),
      [1, 2, 3, 4, 5, 6, 7]
    )
  })

  it('clamps invalid and low page counts to one page per edge', () => {
    assert.deepEqual(selectIncrementalSalesOrderPages(12, 0), [1, 12])
    assert.deepEqual(selectIncrementalSalesOrderPages(12, Number.NaN), [1, 12])
  })

  it('includes new tail pages when Fishbowl total pages increases', () => {
    assert.deepEqual(
      selectIncrementalSalesOrderPages(655, 5),
      [1, 2, 3, 4, 5, 651, 652, 653, 654, 655]
    )
  })
})
