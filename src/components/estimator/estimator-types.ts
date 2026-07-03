// Client-side type aliases + helpers shared by the estimator components.

import type { PackResult } from '@/lib/packing-engine'
import type { EstimateRecord, ResolvedLineItem, SalesOrderSummary } from '@/lib/estimator/types'

export type { EstimateRecord, ResolvedLineItem, SalesOrderSummary, PackResult }

export function confidenceTone(confidence: number, threshold: number) {
  if (confidence >= threshold) return 'high' as const
  if (confidence >= threshold * 0.6) return 'medium' as const
  return 'low' as const
}

export function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatDims(l: number, w: number, h: number): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  return `${fmt(l)}×${fmt(w)}×${fmt(h)} in`
}

/** Plain-text block formatted for pasting into carrier portals. */
export function buildPortalText(record: {
  soNumber: string
  packPlan: PackResult
  confidenceScore: number
}): string {
  const { packPlan: plan, soNumber } = record
  const lines: string[] = []
  lines.push(`SO ${soNumber} — Packaging Estimate (${plan.engineVersion})`)
  lines.push(`Confidence: ${formatPct(record.confidenceScore)} of volume verified`)
  lines.push('-'.repeat(46))

  const grouped = new Map<string, { count: number; box: PackResult['boxes'][number] }>()
  for (const box of plan.boxes) {
    const key = `${box.boxName}|${box.actualWeightLb}`
    const entry = grouped.get(key)
    if (entry) entry.count++
    else grouped.set(key, { count: 1, box })
  }
  for (const { count, box } of grouped.values()) {
    lines.push(
      `${count} × ${box.boxName} — ${formatDims(box.outerLengthIn, box.outerWidthIn, box.outerHeightIn)} — ` +
        `${box.actualWeightLb} lb actual / ${box.dimWeightLb} lb dim / ${box.billableWeightLb} lb billable each`
    )
  }

  lines.push('-'.repeat(46))
  lines.push(
    `Total: ${plan.totals.boxCount} carton${plan.totals.boxCount === 1 ? '' : 's'} | ` +
      `${plan.totals.actualWeightLb} lb actual | ${plan.totals.billableWeightLb} lb billable`
  )
  lines.push(`Routing: ${plan.routing.label}`)

  if (plan.palletPlan) {
    const p = plan.palletPlan
    for (const pallet of p.pallets) {
      lines.push(
        `Pallet: ${pallet.lengthIn}×${pallet.widthIn}×${pallet.heightIn} in — ${pallet.weightLb} lb (${pallet.boxCount} cartons, incl. deck)`
      )
    }
    lines.push(
      `Pallets: ${p.palletCount} | Total ${p.totalWeightLb} lb | Density ${p.densityPcf} PCF | Est. class ${p.freightClass}`
    )
  }

  return lines.join('\n')
}
