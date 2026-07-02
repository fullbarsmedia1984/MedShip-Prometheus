import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { packItems, ENGINE_VERSION } from '../engine'
import { computeConfidence } from '../confidence'
import {
  DEFAULT_PACKING_RULES,
  normalizeAttributes,
  type BoxSpec,
  type ItemAttributes,
  type PackableItem,
} from '../types'

// Standard boxes mirroring the migration seed (Steven's 7 sizes, 50 lb cap).
const BOXES: BoxSpec[] = [
  box('Box 30x24x20', 30, 24, 20, 3.9),
  box('Box 30x17x17', 30, 17, 17, 2.9),
  box('Box 18x16x16', 18, 16, 16, 1.9),
  box('Box 16x13x13', 16, 13, 13, 1.4),
  box('Box 20x14x6', 20, 14, 6, 1.1),
  box('Box 18x12x5', 18, 12, 5, 0.9),
  box('Box 12x10x8', 12, 10, 8, 0.7),
]

function box(name: string, l: number, w: number, h: number, tare: number): BoxSpec {
  return {
    id: name,
    name,
    innerLengthIn: l,
    innerWidthIn: w,
    innerHeightIn: h,
    outerLengthIn: l + 0.5,
    outerWidthIn: w + 0.5,
    outerHeightIn: h + 0.5,
    boxWeightLb: tare,
    maxContentWeightLb: 50,
  }
}

function item(
  partNumber: string,
  quantity: number,
  l: number,
  w: number,
  h: number,
  weight: number,
  attrs: Partial<ItemAttributes> = {},
  extra: Partial<PackableItem> = {}
): PackableItem {
  return {
    partNumber,
    description: partNumber,
    quantity,
    lengthIn: l,
    widthIn: w,
    heightIn: h,
    weightLb: weight,
    shipsInOwnCarton: false,
    dimsSource: 'verified',
    // Tests default to easy-to-pack attributes; constraints are opted into.
    attributes: normalizeAttributes({
      fragile: false,
      stackable: true,
      orientation_lock: false,
      ...attrs,
    }),
    ...extra,
  }
}

const RULES = DEFAULT_PACKING_RULES

describe('packing engine — basics', () => {
  it('packs a small order into a single smallest-fit box', () => {
    const result = packItems([item('PART-A', 4, 5, 4, 3, 1)], BOXES, RULES)
    assert.equal(result.boxes.length, 1)
    assert.equal(result.boxes[0].boxName, 'Box 12x10x8')
    assert.equal(result.boxes[0].contents[0].quantity, 4)
    assert.equal(result.routing.mode, 'parcel')
    assert.equal(result.palletPlan, null)
  })

  it('is deterministic: same input produces identical output', () => {
    const items = [
      item('PART-A', 7, 10, 8, 6, 4),
      item('PART-B', 3, 14, 11, 9, 12, { liquid: true }),
      item('PART-C', 5, 4, 4, 4, 2, { stackable: false }),
    ]
    const a = packItems(items, BOXES, RULES)
    const b = packItems(items, BOXES, RULES)
    assert.deepEqual(a, b)
    assert.equal(a.engineVersion, ENGINE_VERSION)
  })

  it('reports an empty result cleanly', () => {
    const result = packItems([], BOXES, RULES)
    assert.equal(result.boxes.length, 0)
    assert.equal(result.totals.billableWeightLb, 0)
  })
})

describe('packing engine — own-carton isolation', () => {
  it('gives each own-carton unit its own box with its own dims', () => {
    const result = packItems(
      [
        item('CART-1', 2, 24, 20, 14, 22, {}, { shipsInOwnCarton: true }),
        item('PART-A', 2, 6, 5, 4, 2),
      ],
      BOXES,
      RULES
    )
    const ownCartons = result.boxes.filter((b) => b.isOwnCarton)
    assert.equal(ownCartons.length, 2)
    for (const carton of ownCartons) {
      assert.equal(carton.outerLengthIn, 24)
      assert.equal(carton.actualWeightLb, 22)
      assert.equal(carton.contents.length, 1)
      assert.equal(carton.contents[0].partNumber, 'CART-1')
    }
    // The loose items never share a box with own-carton items.
    const standard = result.boxes.filter((b) => !b.isOwnCarton)
    assert.equal(standard.length, 1)
    assert.equal(standard[0].contents[0].partNumber, 'PART-A')
  })
})

describe('packing engine — liquid segregation', () => {
  it('never packs liquids with dry goods when segregation is on', () => {
    const result = packItems(
      [
        item('DRY-1', 3, 6, 5, 4, 2),
        item('LIQ-1', 3, 6, 5, 4, 3, { liquid: true }),
      ],
      BOXES,
      RULES
    )
    for (const packed of result.boxes) {
      const parts = packed.contents.map((c) => c.partNumber)
      const hasLiquid = parts.includes('LIQ-1')
      const hasDry = parts.includes('DRY-1')
      assert.ok(!(hasLiquid && hasDry), `box ${packed.boxName} mixes liquids and dry goods`)
      assert.equal(packed.liquidsOnly, hasLiquid)
    }
  })

  it('mixes freely when segregation is off', () => {
    const rules = { ...RULES, segregate_liquids: false }
    const result = packItems(
      [item('DRY-1', 2, 6, 5, 4, 2), item('LIQ-1', 2, 6, 5, 4, 3, { liquid: true })],
      BOXES,
      rules
    )
    assert.equal(result.boxes.length, 1)
  })
})

describe('packing engine — stacking constraint', () => {
  it('does not open a new layer above a non-stackable item', () => {
    // Two units that each fill a 12x10 footprint; stackable ones share a box
    // (two 3-in layers in the 8-in-tall box), non-stackable ones cannot.
    const stackable = packItems([item('STK', 2, 12, 10, 3, 5)], BOXES, RULES)
    assert.equal(stackable.boxes.length, 1)

    const nonStackable = packItems(
      [item('NOSTK', 2, 12, 10, 3, 5, { stackable: false })],
      BOXES,
      RULES
    )
    assert.equal(nonStackable.boxes.length, 2)
  })

  it('still allows side-by-side placement of non-stackable items', () => {
    // Half-footprint items sit beside each other in one layer.
    const result = packItems(
      [item('NOSTK', 2, 12, 5, 4, 5, { stackable: false })],
      BOXES,
      RULES
    )
    assert.equal(result.boxes.length, 1)
  })
})

describe('packing engine — weight cap', () => {
  it('splits boxes at the 50 lb content cap', () => {
    // 8 × 10 lb = 80 lb: must split into two boxes even though volume fits.
    const result = packItems([item('HEAVY', 8, 6, 6, 6, 10)], BOXES, RULES)
    assert.ok(result.boxes.length >= 2)
    for (const packed of result.boxes) {
      assert.ok(packed.contentWeightLb <= 50, `${packed.boxName} over cap`)
    }
  })

  it('respects a per-box cap lower than the global cap', () => {
    const smallCapBox: BoxSpec = { ...BOXES[6], maxContentWeightLb: 10 }
    const result = packItems([item('X', 2, 6, 6, 6, 8)], [smallCapBox], RULES)
    assert.equal(result.boxes.length, 2)
  })
})

describe('packing engine — orientation lock', () => {
  it('cannot lay a locked item on its side to fit', () => {
    // 9x7x9 upright is too tall for the 12x10x8 box; unlocked it fits laid down.
    const locked = packItems(
      [item('LOCK', 1, 9, 7, 9, 5, { orientation_lock: true })],
      [BOXES[6]],
      RULES
    )
    assert.equal(locked.boxes[0].boxName, 'Oversize — LOCK')

    const unlocked = packItems([item('LOCK', 1, 9, 7, 9, 5)], [BOXES[6]], RULES)
    assert.equal(unlocked.boxes[0].boxName, 'Box 12x10x8')
  })
})

describe('packing engine — nesting', () => {
  it('fits more nested units than rigid units in the same box', () => {
    // Rigid 8x8x10 units need a box each; nested at factor 0.2 they share.
    const rigid = packItems([item('CUP', 12, 8, 8, 10, 1)], [BOXES[6]], RULES)
    const nested = packItems(
      [item('CUP', 12, 8, 8, 10, 1, { nestable: true, nesting_factor: 0.2 })],
      [BOXES[6]],
      RULES
    )
    assert.equal(rigid.boxes.length, 12)
    // 640 in³ first + 128 in³ nested vs 816 in³ usable: 2 per box.
    assert.equal(nested.boxes.length, 6)
  })
})

describe('packing engine — dim weight', () => {
  it('computes ceil(L*W*H/139) on outer dims and bills the max', () => {
    const result = packItems([item('A', 1, 5, 4, 3, 1)], BOXES, RULES)
    const packed = result.boxes[0]
    // Box 12x10x8 outer: 12.5 x 10.5 x 8.5 = 1115.625 / 139 = 8.026 -> 9
    assert.equal(packed.dimWeightLb, 9)
    assert.equal(packed.actualWeightLb, 1.7)
    assert.equal(packed.billableWeightLb, 9)
  })

  it('bills actual weight when it exceeds dim weight', () => {
    const result = packItems([item('DENSE', 1, 5, 4, 3, 40)], BOXES, RULES)
    const packed = result.boxes[0]
    assert.equal(packed.billableWeightLb, Math.ceil(packed.actualWeightLb))
    assert.ok(packed.billableWeightLb > packed.dimWeightLb)
  })
})

describe('packing engine — oversize and overweight items', () => {
  it('ships an item too large for any box as its own piece with a warning', () => {
    const result = packItems([item('BIG', 1, 40, 30, 25, 45)], BOXES, RULES)
    assert.equal(result.boxes[0].boxName, 'Oversize — BIG')
    assert.ok(result.warnings.some((w) => w.code === 'ITEM_TOO_LARGE'))
  })

  it('ships an over-cap-weight item as its own piece with a warning', () => {
    const result = packItems([item('ANVIL', 1, 8, 8, 8, 80)], BOXES, RULES)
    assert.equal(result.boxes[0].boxName, 'Oversize — ANVIL')
    assert.ok(result.warnings.some((w) => w.code === 'ITEM_OVERWEIGHT'))
  })

  it('flags hazmat for escalation without changing the pack', () => {
    const result = packItems([item('HAZ', 1, 5, 4, 3, 2, { hazmat: true })], BOXES, RULES)
    assert.ok(result.warnings.some((w) => w.code === 'HAZMAT_PRESENT'))
    assert.equal(result.boxes.length, 1)
  })
})

describe('confidence score', () => {
  it('weights confidence by verified volume share', () => {
    const items = [
      item('V', 1, 10, 10, 10, 5), // 1000 in³ verified
      item('F', 1, 10, 10, 30, 5, {}, { dimsSource: 'fishbowl' }), // 3000 in³ advisory
    ]
    assert.equal(computeConfidence(items), 0.25)
  })

  it('returns 0 for empty input and 1 for fully verified', () => {
    assert.equal(computeConfidence([]), 0)
    assert.equal(computeConfidence([item('V', 2, 5, 5, 5, 1)]), 1)
  })
})
