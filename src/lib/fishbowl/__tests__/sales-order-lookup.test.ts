import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FishbowlClient } from '../client'
import {
  findSalesOrderByNumberTailScan,
  getSalesOrderByNumber,
  salesOrderMatchesNumber,
  soNumberCandidates,
} from '../sales-orders'

// Simulates the observed production behavior: Fishbowl ignores the ?number=
// filter and always returns the unfiltered, oldest-first SO list.
function fakeClient(allOrders: Array<{ id: number; number: string }>): FishbowlClient {
  return {
    request: async (_method: string, path: string) => {
      const url = new URL(`http://x${path}`)
      const pageNumber = Number(url.searchParams.get('pageNumber') ?? 1)
      const pageSize = Number(url.searchParams.get('pageSize') ?? 100)
      const start = (pageNumber - 1) * pageSize
      return {
        totalCount: allOrders.length,
        totalPages: Math.ceil(allOrders.length / pageSize),
        pageNumber,
        pageSize,
        results: allOrders.slice(start, start + pageSize),
      }
    },
  } as unknown as FishbowlClient
}

const ORDERS = Array.from({ length: 250 }, (_, i) => ({
  id: i + 1,
  number: i === 0 ? '071514KC' : `S${138561 + i}`,
}))
// Newest order sits at the tail, mirroring production ordering.
ORDERS[ORDERS.length - 1] = { id: 250, number: 'S138810' }

describe('soNumberCandidates', () => {
  it('tries the literal input first, then the S/SO-prefix-stripped form', () => {
    // Production case: rep types S138810 but Fishbowl stores 138810.
    assert.deepEqual(soNumberCandidates('S138810'), ['S138810', '138810'])
    assert.deepEqual(soNumberCandidates('so-138810'), ['so-138810', '138810'])
    assert.deepEqual(soNumberCandidates('SO 138810'), ['SO 138810', '138810'])
    assert.deepEqual(soNumberCandidates(' 138810 '), ['138810'])
  })

  it('does not strip letters from real alphanumeric SO numbers', () => {
    assert.deepEqual(soNumberCandidates('071514KC'), ['071514KC'])
    assert.deepEqual(soNumberCandidates('S138810X'), ['S138810X'])
    assert.deepEqual(soNumberCandidates(''), [])
  })
})

describe('salesOrderMatchesNumber', () => {
  it('matches exactly, case-insensitively, across field aliases', () => {
    assert.equal(salesOrderMatchesNumber({ number: 'S138810' }, 's138810'), true)
    assert.equal(salesOrderMatchesNumber({ num: 'S138810' }, 'S138810 '), true)
    assert.equal(salesOrderMatchesNumber({ number: 'S1388' }, 'S138810'), false)
    assert.equal(salesOrderMatchesNumber({ number: '071514KC' }, 'S138810'), false)
    assert.equal(salesOrderMatchesNumber({}, 'S138810'), false)
  })
})

describe('getSalesOrderByNumber (broken server-side filter)', () => {
  it('never returns a positional first result that does not match', async () => {
    // Production bug regression: entering S138810 must NOT return 071514KC.
    const result = await getSalesOrderByNumber(fakeClient(ORDERS), 'S138810')
    assert.equal(result, null) // match is on page 3; page 1 has no match
  })

  it('returns an exact match when it happens to be on the first page', async () => {
    const result = await getSalesOrderByNumber(fakeClient(ORDERS), 'S138570')
    assert.equal(result?.number, 'S138570')
  })
})

describe('findSalesOrderByNumberTailScan', () => {
  it('finds a just-created order on the last page', async () => {
    const result = await findSalesOrderByNumberTailScan(fakeClient(ORDERS), 'S138810')
    assert.equal(result?.number, 'S138810')
    assert.equal(result?.id, 250)
  })

  it('finds orders within the scan window and misses ones beyond it', async () => {
    // 250 orders, pageSize 100 => pages 1..3; maxPages 2 scans pages 3 and 2.
    const inWindow = await findSalesOrderByNumberTailScan(
      fakeClient(ORDERS),
      'S138661', // index 100 → page 2
      { maxPages: 2 }
    )
    assert.equal(inWindow?.number, 'S138661')

    const beyondWindow = await findSalesOrderByNumberTailScan(
      fakeClient(ORDERS),
      '071514KC', // page 1 — outside a 2-page tail window
      { maxPages: 2 }
    )
    assert.equal(beyondWindow, null)
  })

  it('returns null for a nonexistent SO instead of a wrong order', async () => {
    const result = await findSalesOrderByNumberTailScan(fakeClient(ORDERS), 'ZZZ_NO_SUCH_SO')
    assert.equal(result, null)
  })

  it('handles an empty order list', async () => {
    const result = await findSalesOrderByNumberTailScan(fakeClient([]), 'S138810')
    assert.equal(result, null)
  })
})
