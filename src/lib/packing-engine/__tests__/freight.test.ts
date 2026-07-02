import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateRouting,
  buildPalletPlan,
  freightClassForDensity,
  PARCEL_LABEL,
  LTL_LABEL,
  COMPARE_LABEL,
} from '../freight'
import { DEFAULT_PACKING_RULES, type PackedBox, type PackTotals } from '../types'

const RULES = DEFAULT_PACKING_RULES

function packedBox(overrides: Partial<PackedBox> = {}): PackedBox {
  return {
    boxName: 'Box 18x16x16',
    isOwnCarton: false,
    outerLengthIn: 18.5,
    outerWidthIn: 16.5,
    outerHeightIn: 16.5,
    contents: [{ partNumber: 'A', description: 'A', quantity: 1 }],
    contentWeightLb: 20,
    actualWeightLb: 22,
    dimWeightLb: 37,
    billableWeightLb: 37,
    liquidsOnly: false,
    ...overrides,
  }
}

function totalsFor(boxes: PackedBox[]): PackTotals {
  return {
    boxCount: boxes.length,
    actualWeightLb: boxes.reduce((s, b) => s + b.actualWeightLb, 0),
    dimWeightLb: boxes.reduce((s, b) => s + b.dimWeightLb, 0),
    billableWeightLb: boxes.reduce((s, b) => s + b.billableWeightLb, 0),
  }
}

describe('routing decision', () => {
  it('routes small light shipments to parcel', () => {
    const boxes = [packedBox({ dimWeightLb: 30, billableWeightLb: 30 })]
    const decision = evaluateRouting(boxes, totalsFor(boxes), RULES)
    assert.equal(decision.mode, 'parcel')
    assert.equal(decision.label, PARCEL_LABEL)
    assert.equal(decision.blocked, false)
  })

  it('forces LTL when a single carton exceeds 150 lb (never the reverse)', () => {
    const boxes = [packedBox({ actualWeightLb: 151, billableWeightLb: 151 })]
    const decision = evaluateRouting(boxes, totalsFor(boxes), RULES)
    assert.equal(decision.mode, 'ltl')
    assert.equal(decision.label, LTL_LABEL)
  })

  it('does not force LTL at exactly the 150 lb boundary', () => {
    const boxes = [packedBox({ actualWeightLb: 150, billableWeightLb: 150 })]
    const decision = evaluateRouting(boxes, totalsFor(boxes), RULES)
    assert.equal(decision.mode, 'parcel')
  })

  it('forces LTL for own-carton pieces beyond parcel dims (108 in / 165 girth)', () => {
    const longPiece = [
      packedBox({
        boxName: 'Own carton — TUBE',
        isOwnCarton: true,
        outerLengthIn: 110,
        outerWidthIn: 6,
        outerHeightIn: 6,
        actualWeightLb: 30,
        dimWeightLb: 29,
        billableWeightLb: 30,
      }),
    ]
    assert.equal(evaluateRouting(longPiece, totalsFor(longPiece), RULES).mode, 'ltl')

    const girthPiece = [
      packedBox({
        boxName: 'Own carton — CRATE',
        isOwnCarton: true,
        outerLengthIn: 60,
        outerWidthIn: 30,
        outerHeightIn: 24,
        actualWeightLb: 100,
        dimWeightLb: 311,
        billableWeightLb: 311,
      }),
    ]
    // 60 + 2*(30+24) = 168 > 165
    assert.equal(evaluateRouting(girthPiece, totalsFor(girthPiece), RULES).mode, 'ltl')
  })

  it('recommends quoting both at the carton-count threshold (6+)', () => {
    const boxes = Array.from({ length: 6 }, () =>
      packedBox({ billableWeightLb: 37, actualWeightLb: 22 })
    )
    const decision = evaluateRouting(boxes, totalsFor(boxes), RULES)
    assert.equal(decision.mode, 'compare')
    assert.equal(decision.label, COMPARE_LABEL)
  })

  it('stays parcel just below the carton-count threshold', () => {
    const boxes = Array.from({ length: 5 }, () =>
      packedBox({ billableWeightLb: 37, actualWeightLb: 22, dimWeightLb: 37 })
    )
    assert.equal(evaluateRouting(boxes, totalsFor(boxes), RULES).mode, 'parcel')
  })

  it('recommends quoting both above 500 lb total billable weight', () => {
    const boxes = Array.from({ length: 4 }, () =>
      packedBox({ actualWeightLb: 130, billableWeightLb: 130, dimWeightLb: 37 })
    )
    // 520 lb total, 4 cartons
    const decision = evaluateRouting(boxes, totalsFor(boxes), RULES)
    assert.equal(decision.mode, 'compare')
    assert.ok(decision.reasons.some((r) => r.includes('billable weight')))
  })

  it('flags low-density shipments where dim weight dominates', () => {
    const boxes = [
      packedBox({ actualWeightLb: 12, dimWeightLb: 60, billableWeightLb: 60 }),
    ]
    const decision = evaluateRouting(boxes, totalsFor(boxes), RULES)
    assert.equal(decision.mode, 'compare')
    assert.ok(decision.reasons.some((r) => r.includes('dim weight')))
  })

  it('blocks quote generation for pieces over the 4,000 lb freight limit', () => {
    const boxes = [
      packedBox({ boxName: 'Own carton — MACHINE', actualWeightLb: 4200, billableWeightLb: 4200 }),
    ]
    const decision = evaluateRouting(boxes, totalsFor(boxes), RULES)
    assert.equal(decision.mode, 'manual_review')
    assert.equal(decision.blocked, true)
  })
})

describe('pallet plan', () => {
  it('splits pallets at the weight limit', () => {
    // 20 boxes × 100 lb = 2000 lb content; max content per pallet = 1455 lb.
    const boxes = Array.from({ length: 20 }, (_, i) =>
      packedBox({
        boxName: `Box ${i}`,
        actualWeightLb: 100,
        billableWeightLb: 100,
        outerLengthIn: 18.5,
        outerWidthIn: 16.5,
        outerHeightIn: 16.5,
      })
    )
    const plan = buildPalletPlan(boxes, RULES)
    assert.equal(plan.palletCount, 2)
    for (const pallet of plan.pallets) {
      assert.ok(pallet.weightLb <= RULES.pallet.max_weight_lb)
      assert.ok(pallet.heightIn <= RULES.pallet.max_height_in)
    }
    assert.equal(plan.totalWeightLb, 2000 + 2 * RULES.pallet.deck_weight_lb)
  })

  it('splits pallets at the height/volume limit', () => {
    // Light but bulky: 30 large boxes exceed one pallet cube.
    const boxes = Array.from({ length: 30 }, (_, i) =>
      packedBox({
        boxName: `Bulk ${i}`,
        actualWeightLb: 10,
        billableWeightLb: 30,
        outerLengthIn: 30.5,
        outerWidthIn: 24.5,
        outerHeightIn: 20.5,
      })
    )
    const plan = buildPalletPlan(boxes, RULES)
    assert.ok(plan.palletCount >= 4, `expected >=4 pallets, got ${plan.palletCount}`)
  })

  it('computes density over pallet cube and maps to a freight class', () => {
    const boxes = Array.from({ length: 8 }, (_, i) =>
      packedBox({ boxName: `B${i}`, actualWeightLb: 60, billableWeightLb: 60 })
    )
    const plan = buildPalletPlan(boxes, RULES)
    assert.ok(plan.densityPcf > 0)
    assert.equal(plan.freightClass, freightClassForDensity(plan.densityPcf))
  })
})

describe('density → NMFC class table', () => {
  it('maps boundary densities to standard classes', () => {
    assert.equal(freightClassForDensity(55), 50)
    assert.equal(freightClassForDensity(50), 50)
    assert.equal(freightClassForDensity(49.9), 55)
    assert.equal(freightClassForDensity(35), 55)
    assert.equal(freightClassForDensity(30), 60)
    assert.equal(freightClassForDensity(22.5), 65)
    assert.equal(freightClassForDensity(15), 70)
    assert.equal(freightClassForDensity(13.5), 77.5)
    assert.equal(freightClassForDensity(12), 85)
    assert.equal(freightClassForDensity(10.5), 92.5)
    assert.equal(freightClassForDensity(9), 100)
    assert.equal(freightClassForDensity(8), 110)
    assert.equal(freightClassForDensity(7), 125)
    assert.equal(freightClassForDensity(6), 150)
    assert.equal(freightClassForDensity(5), 175)
    assert.equal(freightClassForDensity(4), 200)
    assert.equal(freightClassForDensity(3), 250)
    assert.equal(freightClassForDensity(2), 300)
    assert.equal(freightClassForDensity(1), 400)
    assert.equal(freightClassForDensity(0.5), 500)
  })
})
