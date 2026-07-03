import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildProductDimsQuery, toAdvisoryDims } from '../product-dims'

describe('buildProductDimsQuery', () => {
  it('builds a batched IN query from numeric ids, deduped', () => {
    const sql = buildProductDimsQuery([12784, '9921', 12784])
    assert.ok(sql?.includes('WHERE p.id IN (12784,9921)'))
    assert.ok(sql?.includes('FROM product p'))
  })

  it('rejects non-numeric ids and returns null when nothing remains', () => {
    assert.equal(buildProductDimsQuery([]), null)
    assert.equal(buildProductDimsQuery(['1; DROP TABLE product', 'abc', -5]), null)
    // Injection-shaped input never reaches the SQL string.
    const sql = buildProductDimsQuery(['1 OR 1=1', 42])
    assert.equal(sql?.includes('OR'), false)
    assert.ok(sql?.includes('(42)'))
  })
})

describe('toAdvisoryDims', () => {
  it('passes through inch/pound values and rounds to 3 places', () => {
    const dims = toAdvisoryDims({
      id: 1,
      len: '7.000000000',
      width: 6.75,
      height: 2.75,
      weight: '2.400000000',
      sizeUom: 'in',
      weightUom: 'lbs',
    })
    assert.deepEqual(dims, { lengthIn: 7, widthIn: 6.75, heightIn: 2.75, weightLb: 2.4 })
  })

  it('treats Fishbowl zero placeholders (0E-9) as missing', () => {
    const dims = toAdvisoryDims({ id: 1, len: '0E-9', width: 0, height: null, weight: '0.6' })
    assert.deepEqual(dims, { lengthIn: null, widthIn: null, heightIn: null, weightLb: 0.6 })
  })

  it('converts ft/cm sizes and kg/oz weights to in/lb', () => {
    const feet = toAdvisoryDims({ id: 1, len: 2, width: 1, height: 0.5, weight: 1, sizeUom: 'ft', weightUom: 'kg' })
    assert.deepEqual(feet, { lengthIn: 24, widthIn: 12, heightIn: 6, weightLb: 2.205 })

    const metric = toAdvisoryDims({ id: 1, len: 25.4, width: 50.8, height: 2.54, weight: 8, sizeUom: 'mm', weightUom: 'oz' })
    assert.deepEqual(metric, { lengthIn: 1, widthIn: 2, heightIn: 0.1, weightLb: 0.5 })
  })

  it('nulls values with unknown units instead of guessing', () => {
    const dims = toAdvisoryDims({ id: 1, len: 5, width: 5, height: 5, weight: 5, sizeUom: 'furlong', weightUom: 'stone' })
    assert.deepEqual(dims, { lengthIn: null, widthIn: null, heightIn: null, weightLb: null })
  })

  it('assumes in/lb when the unit is absent (matches Fishbowl defaults)', () => {
    const dims = toAdvisoryDims({ id: 1, len: 5, width: 4, height: 3, weight: 2 })
    assert.deepEqual(dims, { lengthIn: 5, widthIn: 4, heightIn: 3, weightLb: 2 })
  })
})
