// =============================================================================
// Zeus Packaging Estimator — estimate confidence
// Confidence = share of shipment volume backed by verified dims. Items with
// only Fishbowl (advisory) or placeholder dims dilute confidence proportional
// to the volume they contribute.
// =============================================================================

import type { PackableItem } from './types'

export function computeConfidence(items: PackableItem[]): number {
  let totalVolume = 0
  let verifiedVolume = 0

  for (const item of items) {
    const volume = item.lengthIn * item.widthIn * item.heightIn * item.quantity
    totalVolume += volume
    if (item.dimsSource === 'verified') verifiedVolume += volume
  }

  if (totalVolume <= 0) return 0
  return Math.round((verifiedVolume / totalVolume) * 1000) / 1000
}
