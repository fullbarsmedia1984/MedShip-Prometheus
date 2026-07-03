import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const { selectIncrementalSalesOrderPages } = await import(
  new URL('../sales-order-page-bands.ts', import.meta.url).href
)
const { selectRotatingSalesOrderPages } = await import(
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

describe('selectRotatingSalesOrderPages', () => {
  it('selects a contiguous rotating window from the cursor', () => {
    assert.deepEqual(
      selectRotatingSalesOrderPages(652, 10, 301),
      {
        pageNumbers: [301, 302, 303, 304, 305, 306, 307, 308, 309, 310],
        nextStartPage: 311,
      }
    )
  })

  it('wraps at the end of Fishbowl pagination', () => {
    assert.deepEqual(
      selectRotatingSalesOrderPages(652, 10, 648),
      {
        pageNumbers: [648, 649, 650, 651, 652, 1, 2, 3, 4, 5],
        nextStartPage: 6,
      }
    )
  })

  it('clamps invalid cursors and page counts', () => {
    assert.deepEqual(
      selectRotatingSalesOrderPages(3, 0, Number.NaN),
      {
        pageNumbers: [1],
        nextStartPage: 2,
      }
    )
  })
})
