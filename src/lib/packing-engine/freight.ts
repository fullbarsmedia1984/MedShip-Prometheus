// =============================================================================
// Zeus Packaging Estimator — freight decision layer
// Parcel-vs-LTL routing per the business rules (Steven, 2026-07):
//   1. single carton > 150 lb            -> LTL (forced, FedEx hard ceiling)
//   2. carton exceeds parcel max dims    -> LTL (forced)
//   3. total weight or carton count high -> LTL likely cheaper, quote both
//   4. dim weight dominates and is large -> flag for LTL comparison
//   5. otherwise                         -> parcel (FedEx Ground)
// Any piece over the freight max (4,000 lb) blocks the quote for a manual
// freight desk review instead of emitting a bad number.
// =============================================================================

import type {
  PackedBox,
  PackedPallet,
  PackingRules,
  PackTotals,
  PalletPlan,
  RoutingDecision,
} from './types'

export const PARCEL_LABEL = 'FedEx Ground'
export const LTL_LABEL = 'TForce / FedEx Freight (LTL)'
export const COMPARE_LABEL = 'Compare: FedEx Ground vs TForce / FedEx Freight (LTL)'
export const MANUAL_REVIEW_LABEL = 'Manual freight desk review required'

/**
 * Standard NMFC density-based freight class lookup (18-tier scale).
 * Density in lb/ft³ maps to class 50 (dense) through 500 (very light).
 */
const DENSITY_CLASS_TABLE: Array<{ minDensityPcf: number; freightClass: number }> = [
  { minDensityPcf: 50, freightClass: 50 },
  { minDensityPcf: 35, freightClass: 55 },
  { minDensityPcf: 30, freightClass: 60 },
  { minDensityPcf: 22.5, freightClass: 65 },
  { minDensityPcf: 15, freightClass: 70 },
  { minDensityPcf: 13.5, freightClass: 77.5 },
  { minDensityPcf: 12, freightClass: 85 },
  { minDensityPcf: 10.5, freightClass: 92.5 },
  { minDensityPcf: 9, freightClass: 100 },
  { minDensityPcf: 8, freightClass: 110 },
  { minDensityPcf: 7, freightClass: 125 },
  { minDensityPcf: 6, freightClass: 150 },
  { minDensityPcf: 5, freightClass: 175 },
  { minDensityPcf: 4, freightClass: 200 },
  { minDensityPcf: 3, freightClass: 250 },
  { minDensityPcf: 2, freightClass: 300 },
  { minDensityPcf: 1, freightClass: 400 },
  { minDensityPcf: 0, freightClass: 500 },
]

export function freightClassForDensity(densityPcf: number): number {
  const tier = DENSITY_CLASS_TABLE.find((t) => densityPcf >= t.minDensityPcf)
  return tier?.freightClass ?? 500
}

/** Length + girth per parcel carrier rules: longest side + 2×(width + height). */
function lengthPlusGirth(box: PackedBox): number {
  const dims = [box.outerLengthIn, box.outerWidthIn, box.outerHeightIn].sort((a, b) => b - a)
  return dims[0] + 2 * (dims[1] + dims[2])
}

function longestSide(box: PackedBox): number {
  return Math.max(box.outerLengthIn, box.outerWidthIn, box.outerHeightIn)
}

export function evaluateRouting(
  boxes: PackedBox[],
  totals: PackTotals,
  rules: PackingRules
): RoutingDecision {
  if (boxes.length === 0) {
    return { mode: 'parcel', label: PARCEL_LABEL, reasons: ['Nothing to ship.'], blocked: false }
  }

  // Hard stop: pieces beyond what LTL carriers accept.
  const overFreightMax = boxes.filter(
    (b) => b.actualWeightLb > rules.pallet.max_piece_weight_lb
  )
  if (overFreightMax.length > 0) {
    return {
      mode: 'manual_review',
      label: MANUAL_REVIEW_LABEL,
      reasons: overFreightMax.map(
        (b) =>
          `${b.boxName} weighs ${b.actualWeightLb} lb — over the ${rules.pallet.max_piece_weight_lb} lb single-piece freight limit.`
      ),
      blocked: true,
    }
  }

  const forcedLtlReasons: string[] = []

  for (const box of boxes) {
    if (box.actualWeightLb > rules.parcel_max.single_package_weight_lb) {
      forcedLtlReasons.push(
        `${box.boxName} weighs ${box.actualWeightLb} lb — over the ${rules.parcel_max.single_package_weight_lb} lb parcel ceiling.`
      )
    }
    if (longestSide(box) > rules.parcel_max.max_length_in) {
      forcedLtlReasons.push(
        `${box.boxName} longest side ${longestSide(box)} in exceeds the ${rules.parcel_max.max_length_in} in parcel limit.`
      )
    } else if (lengthPlusGirth(box) > rules.parcel_max.max_length_plus_girth_in) {
      forcedLtlReasons.push(
        `${box.boxName} length+girth ${Math.round(lengthPlusGirth(box))} in exceeds the ${rules.parcel_max.max_length_plus_girth_in} in parcel limit.`
      )
    }
  }

  if (forcedLtlReasons.length > 0) {
    return { mode: 'ltl', label: LTL_LABEL, reasons: forcedLtlReasons, blocked: false }
  }

  const compareReasons: string[] = []

  if (totals.billableWeightLb > rules.ltl_triggers.total_billable_weight_lb) {
    compareReasons.push(
      `Total billable weight ${totals.billableWeightLb} lb exceeds ${rules.ltl_triggers.total_billable_weight_lb} lb — LTL is likely cheaper.`
    )
  }
  if (totals.boxCount >= rules.ltl_triggers.carton_count) {
    compareReasons.push(
      `${totals.boxCount} cartons to one destination (threshold ${rules.ltl_triggers.carton_count}) — LTL usually beats parcel at this count.`
    )
  }

  // Density check: bulky/low-density shipments where dim weight dominates.
  for (const box of boxes) {
    if (
      box.dimWeightLb > box.actualWeightLb &&
      box.dimWeightLb > rules.ltl_triggers.dim_weight_flag_threshold_lb
    ) {
      compareReasons.push(
        `${box.boxName} bills at dim weight ${box.dimWeightLb} lb vs ${box.actualWeightLb} lb actual — low density penalizes parcel pricing.`
      )
    }
  }

  if (compareReasons.length > 0) {
    return { mode: 'compare', label: COMPARE_LABEL, reasons: compareReasons, blocked: false }
  }

  return {
    mode: 'parcel',
    label: PARCEL_LABEL,
    reasons: [
      `${totals.boxCount} carton${totals.boxCount === 1 ? '' : 's'}, ${totals.billableWeightLb} lb billable — within parcel thresholds.`,
    ],
    blocked: false,
  }
}

// -----------------------------------------------------------------------------
// Pallet plan
// -----------------------------------------------------------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

interface OpenPallet {
  boxes: PackedBox[]
  contentWeightLb: number
  usedVolumeIn3: number
}

/**
 * Greedy stack of packed boxes onto standard pallets. Volume-based stacking
 * with a fill factor; height is estimated from stacked volume over the deck
 * footprint. Deterministic: boxes are processed largest-first.
 */
export function buildPalletPlan(boxes: PackedBox[], rules: PackingRules): PalletPlan {
  const p = rules.pallet
  const deckArea = p.length_in * p.width_in
  const usableHeightIn = p.max_height_in - p.deck_height_in
  const capacityIn3 = deckArea * usableHeightIn * p.stack_fill_factor
  const maxContentWeight = p.max_weight_lb - p.deck_weight_lb

  const sorted = [...boxes].sort(
    (a, b) =>
      b.outerLengthIn * b.outerWidthIn * b.outerHeightIn -
        a.outerLengthIn * a.outerWidthIn * a.outerHeightIn ||
      b.actualWeightLb - a.actualWeightLb ||
      a.boxName.localeCompare(b.boxName)
  )

  const pallets: OpenPallet[] = []

  for (const box of sorted) {
    const vol = box.outerLengthIn * box.outerWidthIn * box.outerHeightIn
    let placed = pallets.find(
      (pallet) =>
        pallet.contentWeightLb + box.actualWeightLb <= maxContentWeight &&
        pallet.usedVolumeIn3 + vol <= capacityIn3
    )
    if (!placed) {
      placed = { boxes: [], contentWeightLb: 0, usedVolumeIn3: 0 }
      pallets.push(placed)
    }
    placed.boxes.push(box)
    placed.contentWeightLb += box.actualWeightLb
    placed.usedVolumeIn3 += vol
  }

  const packedPallets: PackedPallet[] = pallets.map((pallet) => {
    const stackHeight = pallet.usedVolumeIn3 / (deckArea * p.stack_fill_factor)
    return {
      boxNames: pallet.boxes.map((b) => b.boxName),
      boxCount: pallet.boxes.length,
      lengthIn: p.length_in,
      widthIn: p.width_in,
      heightIn: round1(Math.min(p.deck_height_in + stackHeight, p.max_height_in)),
      weightLb: round2(p.deck_weight_lb + pallet.contentWeightLb),
    }
  })

  const totalWeightLb = round2(packedPallets.reduce((s, x) => s + x.weightLb, 0))
  const totalCubeFt3 = packedPallets.reduce(
    (s, x) => s + (x.lengthIn * x.widthIn * x.heightIn) / 1728,
    0
  )
  const densityPcf = totalCubeFt3 > 0 ? round2(totalWeightLb / totalCubeFt3) : 0

  return {
    pallets: packedPallets,
    palletCount: packedPallets.length,
    totalWeightLb,
    densityPcf,
    freightClass: freightClassForDensity(densityPcf),
  }
}
