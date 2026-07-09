// =============================================================================
// Zeus Packaging Estimator — estimate confidence
// Confidence = share of shipment volume backed by trusted dims. Verified
// (human-confirmed) dims count in full; catalog dims (vendor-published,
// auto-matched) count at a discount; Fishbowl (advisory) and placeholder dims
// dilute confidence proportional to the volume they contribute.
// =============================================================================

import type { PackableItem } from './types'

/** Vendor catalog dims are trusted but not physically confirmed. */
const CATALOG_CONFIDENCE_WEIGHT = 0.8

export function computeConfidence(items: PackableItem[]): number {
  let totalVolume = 0
  let verifiedVolume = 0

  for (const item of items) {
    const volume = item.lengthIn * item.widthIn * item.heightIn * item.quantity
    totalVolume += volume
    if (item.dimsSource === 'verified') verifiedVolume += volume
    else if (item.dimsSource === 'catalog') verifiedVolume += volume * CATALOG_CONFIDENCE_WEIGHT
  }

  if (totalVolume <= 0) return 0
  return Math.round((verifiedVolume / totalVolume) * 1000) / 1000
}
