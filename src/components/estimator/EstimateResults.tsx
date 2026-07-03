'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Container,
  Scale,
  ShieldAlert,
  Sparkles,
  Truck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ConfidenceMeter } from './ConfidenceMeter'
import { buildPortalText, formatDims, type EstimateRecord } from './estimator-types'

const ROUTING_STYLES = {
  parcel: {
    icon: Truck,
    className: 'border-medship-success/40 bg-medship-success/5 text-medship-success',
    accent: 'text-medship-success',
  },
  ltl: {
    icon: Container,
    className: 'border-medship-primary-dark/30 bg-medship-primary-dark/5 text-medship-primary-dark dark:border-white/20 dark:bg-white/5 dark:text-white',
    accent: 'text-medship-primary-dark dark:text-white',
  },
  compare: {
    icon: Scale,
    className: 'border-medship-warning/40 bg-medship-warning/5 text-medship-warning',
    accent: 'text-medship-warning',
  },
  manual_review: {
    icon: ShieldAlert,
    className: 'border-medship-danger/40 bg-medship-danger/5 text-medship-danger',
    accent: 'text-medship-danger',
  },
} as const

export function EstimateResults({
  estimate,
  confidenceThreshold,
}: {
  estimate: EstimateRecord
  confidenceThreshold: number
}) {
  const [copied, setCopied] = useState(false)
  const plan = estimate.packPlan
  const routing = ROUTING_STYLES[plan.routing.mode] ?? ROUTING_STYLES.parcel
  const RoutingIcon = routing.icon
  const lowConfidence = estimate.confidenceScore < confidenceThreshold

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(
        buildPortalText({
          soNumber: estimate.soNumber,
          packPlan: plan,
          confidenceScore: estimate.confidenceScore,
        })
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be unavailable in insecure contexts; the text is visible below.
    }
  }

  return (
    <div className="space-y-6">
      {lowConfidence && (
        <div className="flex items-start gap-3 rounded-lg border border-medship-warning/40 bg-medship-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-medship-warning" />
          <div className="text-sm text-medship-heading dark:text-white">
            <span className="font-semibold">Low confidence</span> — only{' '}
            {Math.round(estimate.confidenceScore * 100)}% of shipment volume is backed by verified
            dims (threshold {Math.round(confidenceThreshold * 100)}%). Escalate to Dan or verify
            the remaining items before quoting.
          </div>
        </div>
      )}

      {/* Routing verdict */}
      <div className={cn('flex items-start gap-4 rounded-lg border p-5', routing.className)}>
        <div className="rounded-lg bg-white/60 p-2.5 dark:bg-white/10">
          <RoutingIcon className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">
            Shipment mode recommendation
          </div>
          <div className={cn('text-lg font-semibold', routing.accent)}>{plan.routing.label}</div>
          <ul className="mt-1 space-y-0.5 text-xs text-medship-slate dark:text-white/60">
            {plan.routing.reasons.map((reason, i) => (
              <li key={i}>• {reason}</li>
            ))}
          </ul>
        </div>
        <div className="hidden text-right sm:block">
          <ConfidenceMeter confidence={estimate.confidenceScore} threshold={confidenceThreshold} compact />
          <div className="mt-1 font-mono text-[0.65rem] text-medship-slate/70 dark:text-white/40">
            {estimate.engineVersion}
          </div>
        </div>
      </div>

      {/* Boxes summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-medship-heading dark:text-white">
            Boxes — {plan.totals.boxCount} carton{plan.totals.boxCount === 1 ? '' : 's'}
          </CardTitle>
          <Button
            size="sm"
            onClick={copyToClipboard}
            className="bg-medship-primary text-white hover:bg-medship-primary/90"
          >
            {copied ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied ? 'Copied' : 'Copy for carrier portal'}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Box</TableHead>
                <TableHead>Outer dims</TableHead>
                <TableHead>Contents</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Dim wt</TableHead>
                <TableHead className="text-right">Billable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.boxes.map((box, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-medship-heading dark:text-white">
                    {box.boxName}
                    {box.liquidsOnly && (
                      <span className="ml-2 rounded-full bg-medship-info/10 px-2 py-0.5 text-[0.65rem] font-medium text-medship-info">
                        liquids
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDims(box.outerLengthIn, box.outerWidthIn, box.outerHeightIn)}
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate text-xs text-medship-slate dark:text-white/60">
                    {box.contents.map((c) => `${c.quantity}× ${c.partNumber}`).join(', ')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{box.actualWeightLb} lb</TableCell>
                  <TableCell className="text-right tabular-nums">{box.dimWeightLb} lb</TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-semibold tabular-nums',
                      box.dimWeightLb > box.actualWeightLb
                        ? 'text-medship-warning'
                        : 'text-medship-heading dark:text-white'
                    )}
                  >
                    {box.billableWeightLb} lb
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-medship-border bg-medship-pale-blue/10 font-semibold">
                <TableCell className="text-medship-heading dark:text-white">Totals</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right tabular-nums">
                  {plan.totals.actualWeightLb} lb
                </TableCell>
                <TableCell className="text-right tabular-nums">{plan.totals.dimWeightLb} lb</TableCell>
                <TableCell className="text-right tabular-nums text-medship-primary">
                  {plan.totals.billableWeightLb} lb
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pallet plan */}
      {plan.palletPlan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-medship-heading dark:text-white">
              Pallet plan — {plan.palletPlan.palletCount} pallet
              {plan.palletPlan.palletCount === 1 ? '' : 's'} (LTL)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plan.palletPlan.pallets.map((pallet, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-medship-border p-4 dark:border-white/10"
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
                    Pallet {i + 1}
                  </div>
                  <div className="mt-1 font-mono text-sm text-medship-heading dark:text-white">
                    {formatDims(pallet.lengthIn, pallet.widthIn, pallet.heightIn)}
                  </div>
                  <div className="mt-1 text-sm text-medship-slate dark:text-white/60">
                    {pallet.weightLb} lb incl. deck • {pallet.boxCount} cartons
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-medship-border pt-4 text-sm dark:border-white/10">
              <div>
                <span className="text-medship-slate dark:text-white/50">Total weight </span>
                <span className="font-semibold tabular-nums text-medship-heading dark:text-white">
                  {plan.palletPlan.totalWeightLb} lb
                </span>
              </div>
              <div>
                <span className="text-medship-slate dark:text-white/50">Density </span>
                <span className="font-semibold tabular-nums text-medship-heading dark:text-white">
                  {plan.palletPlan.densityPcf} lb/ft³
                </span>
              </div>
              <div>
                <span className="text-medship-slate dark:text-white/50">Est. NMFC class </span>
                <span className="font-semibold tabular-nums text-medship-accent">
                  {plan.palletPlan.freightClass}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Engine warnings + LLM flags */}
      {(plan.warnings.length > 0 || estimate.llmFlags.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-medship-heading dark:text-white">Review flags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {plan.warnings.map((warning, i) => (
              <div
                key={`w-${i}`}
                className="flex items-start gap-2 rounded-md bg-medship-warning/10 px-3 py-2 text-xs text-medship-heading dark:text-white"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-medship-warning" />
                {warning.message}
              </div>
            ))}
            {estimate.llmFlags.map((flag, i) => (
              <div
                key={`f-${i}`}
                className={cn(
                  'flex items-start gap-2 rounded-md px-3 py-2 text-xs text-medship-heading dark:text-white',
                  flag.severity === 'warning' ? 'bg-medship-accent/10' : 'bg-medship-info/10'
                )}
              >
                <Sparkles
                  className={cn(
                    'mt-0.5 h-3.5 w-3.5 flex-shrink-0',
                    flag.severity === 'warning' ? 'text-medship-accent' : 'text-medship-info'
                  )}
                />
                <span>
                  <span className="font-medium">AI review:</span> {flag.message}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Copy block preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-medship-heading dark:text-white">Carrier portal text</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg bg-medship-primary-dark p-4 font-mono text-xs leading-relaxed text-white/90 dark:bg-black/40">
            {buildPortalText({
              soNumber: estimate.soNumber,
              packPlan: plan,
              confidenceScore: estimate.confidenceScore,
            })}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
