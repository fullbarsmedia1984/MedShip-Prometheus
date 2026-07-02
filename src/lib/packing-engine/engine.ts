// =============================================================================
// Zeus Packaging Estimator — deterministic packing engine
// First-Fit Decreasing 3D bin packing with layer-based placement.
// Pure module: no I/O, no randomness, no clock. Same input + same
// ENGINE_VERSION => identical output.
// =============================================================================

import type {
  BoxSpec,
  ItemAttributes,
  PackableItem,
  PackedBox,
  PackingRules,
  PackResult,
  PackWarning,
} from './types'
import { evaluateRouting, buildPalletPlan } from './freight'

export const ENGINE_VERSION = 'zeus-pack-1.0.0'

// -----------------------------------------------------------------------------
// Internal placement model
// -----------------------------------------------------------------------------

interface Unit {
  partNumber: string
  description: string
  lengthIn: number
  widthIn: number
  heightIn: number
  weightLb: number
  attributes: ItemAttributes
}

interface Orientation {
  l: number
  w: number
  h: number
}

interface Row {
  xUsed: number
  depth: number
}

interface Layer {
  rows: Row[]
  yUsed: number
  height: number
}

interface OpenBox {
  spec: BoxSpec
  layers: Layer[]
  /** Once a non-stackable unit sits in the top layer, no layer may be added above it. */
  stackLocked: boolean
  contentWeightLb: number
  usedEffectiveVolume: number
  skuCounts: Map<string, number>
  units: Unit[]
  liquidsOnly: boolean
}

function unitVolume(u: Unit): number {
  return u.lengthIn * u.widthIn * u.heightIn
}

function innerVolume(spec: BoxSpec): number {
  return spec.innerLengthIn * spec.innerWidthIn * spec.innerHeightIn
}

/**
 * Candidate orientations for a unit, deterministically ordered flattest-first
 * (minimal height, then longest footprint). Orientation-locked units keep
 * their height axis fixed.
 */
function orientationsFor(u: Unit): Orientation[] {
  const { lengthIn: l, widthIn: w, heightIn: h } = u
  const all: Orientation[] = u.attributes.orientation_lock
    ? [
        { l, w, h },
        { l: w, w: l, h },
      ]
    : [
        { l, w, h },
        { l: w, w: l, h },
        { l, w: h, h: w },
        { l: h, w: l, h: w },
        { l: w, w: h, h: l },
        { l: h, w, h: l },
      ]

  const seen = new Set<string>()
  const unique = all.filter((o) => {
    const key = `${o.l}x${o.w}x${o.h}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  unique.sort((a, b) => a.h - b.h || b.l - a.l || b.w - a.w)
  return unique
}

function usedHeight(box: OpenBox): number {
  return box.layers.reduce((sum, layer) => sum + layer.height, 0)
}

/** Shelf-pack a footprint into a layer's 2D free space. Mutates on success. */
function placeFootprintInLayer(
  layer: Layer,
  innerL: number,
  innerW: number,
  l: number,
  w: number
): boolean {
  for (const row of layer.rows) {
    if (w <= row.depth && row.xUsed + l <= innerL) {
      row.xUsed += l
      return true
    }
  }
  if (layer.yUsed + w <= innerW) {
    layer.rows.push({ xUsed: l, depth: w })
    layer.yUsed += w
    return true
  }
  return false
}

/**
 * Effective volume a unit consumes in a box: nestable units beyond the first
 * of the same SKU consume volume × nesting_factor.
 */
function effectiveVolume(box: OpenBox, u: Unit): number {
  const vol = unitVolume(u)
  const priorSameSku = box.skuCounts.get(u.partNumber) ?? 0
  if (u.attributes.nestable && priorSameSku > 0) {
    return vol * clamp01(u.attributes.nesting_factor)
  }
  return vol
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  return n > 1 ? 1 : n
}

/**
 * Attempt to place a unit into an open box. Enforces weight cap, fill-factor
 * volume cap, geometric layer fit, and stacking constraints. Mutates the box
 * on success.
 */
function tryPlace(box: OpenBox, u: Unit, rules: PackingRules): boolean {
  const weightCap = Math.min(box.spec.maxContentWeightLb, rules.max_box_weight_lb)
  if (box.contentWeightLb + u.weightLb > weightCap) return false

  const effVol = effectiveVolume(box, u)
  const volumeCap = innerVolume(box.spec) * rules.fill_factor
  if (box.usedEffectiveVolume + effVol > volumeCap) return false

  // Nested same-SKU units sit inside the footprint of the unit below them:
  // no new floor space needed, only the volume accounted above.
  const priorSameSku = box.skuCounts.get(u.partNumber) ?? 0
  if (u.attributes.nestable && priorSameSku > 0) {
    commitPlacement(box, u, effVol)
    return true
  }

  const { innerLengthIn: innerL, innerWidthIn: innerW, innerHeightIn: innerH } = box.spec
  const heightUsed = usedHeight(box)
  const topIndex = box.layers.length - 1

  for (const o of orientationsFor(u)) {
    if (o.l > innerL || o.w > innerW || o.h > innerH) continue

    // Non-stackable units must end up with nothing above them: top layer only.
    const layerCandidates = u.attributes.stackable
      ? box.layers.map((_, i) => i)
      : topIndex >= 0
        ? [topIndex]
        : []

    for (const i of layerCandidates) {
      const layer = box.layers[i]
      const isTop = i === topIndex
      const fitsHeight = isTop
        ? heightUsed - layer.height + Math.max(layer.height, o.h) <= innerH
        : o.h <= layer.height
      if (!fitsHeight) continue
      if (placeFootprintInLayer(layer, innerL, innerW, o.l, o.w)) {
        if (isTop && o.h > layer.height) layer.height = o.h
        commitPlacement(box, u, effVol)
        return true
      }
    }

    // New layer on top (blocked once a non-stackable unit occupies the top).
    if (!box.stackLocked && heightUsed + o.h <= innerH) {
      box.layers.push({
        rows: [{ xUsed: o.l, depth: o.w }],
        yUsed: o.w,
        height: o.h,
      })
      commitPlacement(box, u, effVol)
      return true
    }
  }

  return false
}

function commitPlacement(box: OpenBox, u: Unit, effVol: number): void {
  box.contentWeightLb += u.weightLb
  box.usedEffectiveVolume += effVol
  box.skuCounts.set(u.partNumber, (box.skuCounts.get(u.partNumber) ?? 0) + 1)
  box.units.push(u)
  if (!u.attributes.stackable) box.stackLocked = true
}

/** Can this unit ever fit in this box spec (geometry + weight), when empty? */
function unitFitsSpec(u: Unit, spec: BoxSpec, rules: PackingRules): boolean {
  if (u.weightLb > Math.min(spec.maxContentWeightLb, rules.max_box_weight_lb)) return false
  if (unitVolume(u) > innerVolume(spec) * rules.fill_factor) return false
  return orientationsFor(u).some(
    (o) =>
      o.l <= spec.innerLengthIn &&
      o.w <= spec.innerWidthIn &&
      o.h <= spec.innerHeightIn
  )
}

function newOpenBox(spec: BoxSpec, liquidsOnly: boolean): OpenBox {
  return {
    spec,
    layers: [],
    stackLocked: false,
    contentWeightLb: 0,
    usedEffectiveVolume: 0,
    skuCounts: new Map(),
    units: [],
    liquidsOnly,
  }
}

/** Re-simulate a box's units into a candidate spec (same order). */
function repackFits(units: Unit[], spec: BoxSpec, rules: PackingRules): boolean {
  const trial = newOpenBox(spec, false)
  return units.every((u) => tryPlace(trial, u, rules))
}

// -----------------------------------------------------------------------------
// FFD pack of one segregation group
// -----------------------------------------------------------------------------

interface GroupPackOutcome {
  boxes: OpenBox[]
  oversize: Unit[]
}

function packGroup(
  units: Unit[],
  specs: BoxSpec[],
  rules: PackingRules,
  liquidsOnly: boolean
): GroupPackOutcome {
  // First-Fit Decreasing: largest volume first; full tiebreak for determinism.
  const sorted = [...units].sort(
    (a, b) =>
      unitVolume(b) - unitVolume(a) ||
      b.weightLb - a.weightLb ||
      a.partNumber.localeCompare(b.partNumber)
  )

  const openBoxes: OpenBox[] = []
  const oversize: Unit[] = []

  for (const unit of sorted) {
    if (openBoxes.some((box) => tryPlace(box, unit, rules))) continue

    // Open the smallest spec that can hold this unit on its own.
    const spec = specs.find((s) => unitFitsSpec(unit, s, rules))
    if (!spec) {
      oversize.push(unit)
      continue
    }
    const box = newOpenBox(spec, liquidsOnly)
    tryPlace(box, unit, rules)
    openBoxes.push(box)
  }

  // Shrink pass: downsize each box to the smallest spec its contents repack into.
  for (const box of openBoxes) {
    for (const spec of specs) {
      if (spec.id === box.spec.id) break
      if (innerVolume(spec) >= innerVolume(box.spec)) continue
      if (repackFits(box.units, spec, rules)) {
        box.spec = spec
        break
      }
    }
  }

  return { boxes: openBoxes, oversize }
}

// -----------------------------------------------------------------------------
// Output shaping
// -----------------------------------------------------------------------------

function ceilTo(n: number): number {
  // Guard float noise (e.g. 20.000000000004 should not round to 21).
  return Math.ceil(Math.round(n * 1e6) / 1e6)
}

function dimWeight(l: number, w: number, h: number, divisor: number): number {
  return ceilTo((l * w * h) / divisor)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function summarizeContents(units: Unit[]) {
  const byPart = new Map<string, { partNumber: string; description: string; quantity: number }>()
  for (const u of units) {
    const entry = byPart.get(u.partNumber)
    if (entry) entry.quantity += 1
    else byPart.set(u.partNumber, { partNumber: u.partNumber, description: u.description, quantity: 1 })
  }
  return [...byPart.values()].sort((a, b) => a.partNumber.localeCompare(b.partNumber))
}

function toPackedBox(
  name: string,
  isOwnCarton: boolean,
  outerL: number,
  outerW: number,
  outerH: number,
  tareLb: number,
  units: Unit[],
  rules: PackingRules,
  liquidsOnly: boolean
): PackedBox {
  const contentWeight = units.reduce((sum, u) => sum + u.weightLb, 0)
  const actual = contentWeight + tareLb
  const dim = dimWeight(outerL, outerW, outerH, rules.dim_divisor)
  return {
    boxName: name,
    isOwnCarton,
    outerLengthIn: outerL,
    outerWidthIn: outerW,
    outerHeightIn: outerH,
    contents: summarizeContents(units),
    contentWeightLb: round2(contentWeight),
    actualWeightLb: round2(actual),
    dimWeightLb: dim,
    billableWeightLb: Math.max(ceilTo(actual), dim),
    liquidsOnly,
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Pack SO line items into standard boxes and produce the full shipment plan:
 * boxes, weights, routing recommendation, and pallet plan when freight.
 */
export function packItems(
  items: PackableItem[],
  boxSpecs: BoxSpec[],
  rules: PackingRules
): PackResult {
  const warnings: PackWarning[] = []

  // Deterministic spec order: smallest cube first (drives "smallest box that fits").
  const specs = [...boxSpecs].sort(
    (a, b) => innerVolume(a) - innerVolume(b) || a.name.localeCompare(b.name)
  )

  // Expand line items into individual units.
  const ownCartonItems: PackableItem[] = []
  const looseUnits: Unit[] = []
  for (const item of items) {
    if (item.attributes.hazmat) {
      warnings.push({
        code: 'HAZMAT_PRESENT',
        message: `${item.partNumber} is flagged hazmat — escalate for compliance review before quoting.`,
        partNumber: item.partNumber,
      })
    }
    if (item.shipsInOwnCarton) {
      ownCartonItems.push(item)
      continue
    }
    for (let i = 0; i < item.quantity; i++) {
      looseUnits.push({
        partNumber: item.partNumber,
        description: item.description,
        lengthIn: item.lengthIn,
        widthIn: item.widthIn,
        heightIn: item.heightIn,
        weightLb: item.weightLb,
        attributes: item.attributes,
      })
    }
  }

  if (specs.length === 0 && looseUnits.length > 0) {
    warnings.push({
      code: 'NO_ACTIVE_BOXES',
      message: 'No active standard boxes are configured — only own-carton items can be estimated.',
    })
  }

  // Segregate liquids from dry goods when the rules require it.
  const liquidUnits = rules.segregate_liquids
    ? looseUnits.filter((u) => u.attributes.liquid)
    : []
  const dryUnits = rules.segregate_liquids
    ? looseUnits.filter((u) => !u.attributes.liquid)
    : looseUnits

  const dryOutcome = packGroup(dryUnits, specs, rules, false)
  const liquidOutcome = packGroup(liquidUnits, specs, rules, true)

  const boxes: PackedBox[] = []

  for (const open of [...dryOutcome.boxes, ...liquidOutcome.boxes]) {
    boxes.push(
      toPackedBox(
        open.spec.name,
        false,
        open.spec.outerLengthIn,
        open.spec.outerWidthIn,
        open.spec.outerHeightIn,
        open.spec.boxWeightLb,
        open.units,
        rules,
        open.liquidsOnly
      )
    )
  }

  // Own-carton items: each unit ships as-is in its own carton.
  for (const item of ownCartonItems) {
    for (let i = 0; i < item.quantity; i++) {
      boxes.push(
        toPackedBox(
          `Own carton — ${item.partNumber}`,
          true,
          item.lengthIn,
          item.widthIn,
          item.heightIn,
          0,
          [
            {
              partNumber: item.partNumber,
              description: item.description,
              lengthIn: item.lengthIn,
              widthIn: item.widthIn,
              heightIn: item.heightIn,
              weightLb: item.weightLb,
              attributes: item.attributes,
            },
          ],
          rules,
          item.attributes.liquid
        )
      )
    }
  }

  // Units that fit no standard box ship as-is; freight rules catch the rest.
  for (const unit of [...dryOutcome.oversize, ...liquidOutcome.oversize]) {
    const tooHeavy = unit.weightLb > rules.max_box_weight_lb
    warnings.push({
      code: tooHeavy ? 'ITEM_OVERWEIGHT' : 'ITEM_TOO_LARGE',
      message: tooHeavy
        ? `${unit.partNumber} (${round2(unit.weightLb)} lb) exceeds the ${rules.max_box_weight_lb} lb box weight cap — shipping as its own piece.`
        : `${unit.partNumber} (${unit.lengthIn}×${unit.widthIn}×${unit.heightIn} in) does not fit any standard box — shipping as its own piece.`,
      partNumber: unit.partNumber,
    })
    boxes.push(
      toPackedBox(
        `Oversize — ${unit.partNumber}`,
        true,
        unit.lengthIn,
        unit.widthIn,
        unit.heightIn,
        0,
        [unit],
        rules,
        unit.attributes.liquid
      )
    )
  }

  // Stable output order: standard boxes by name then weight, own-carton last.
  boxes.sort(
    (a, b) =>
      Number(a.isOwnCarton) - Number(b.isOwnCarton) ||
      a.boxName.localeCompare(b.boxName) ||
      b.actualWeightLb - a.actualWeightLb
  )

  const totals = {
    boxCount: boxes.length,
    actualWeightLb: round2(boxes.reduce((s, b) => s + b.actualWeightLb, 0)),
    dimWeightLb: boxes.reduce((s, b) => s + b.dimWeightLb, 0),
    billableWeightLb: boxes.reduce((s, b) => s + b.billableWeightLb, 0),
  }

  const routing = evaluateRouting(boxes, totals, rules)

  for (const box of boxes) {
    if (box.actualWeightLb > rules.pallet.max_piece_weight_lb) {
      warnings.push({
        code: 'PIECE_OVER_FREIGHT_MAX',
        message: `${box.boxName} (${box.actualWeightLb} lb) exceeds the ${rules.pallet.max_piece_weight_lb} lb single-piece freight limit — manual freight desk review required.`,
      })
    }
  }

  const palletPlan =
    routing.mode === 'ltl' || routing.mode === 'compare'
      ? buildPalletPlan(boxes, rules)
      : null

  return {
    engineVersion: ENGINE_VERSION,
    boxes,
    totals,
    routing,
    palletPlan,
    warnings,
  }
}
