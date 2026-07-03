'use client'

import { useEffect, useState } from 'react'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchJson } from '@/lib/client-api'
import { formatPct, type EstimateRecord } from './estimator-types'

export function PastEstimates({
  onLoadEstimate,
}: {
  onLoadEstimate: (estimate: EstimateRecord) => void
}) {
  const [estimates, setEstimates] = useState<EstimateRecord[] | null>(null)
  const [recordingFor, setRecordingFor] = useState<EstimateRecord | null>(null)
  const [actualBoxCount, setActualBoxCount] = useState('')
  const [actualNote, setActualNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    fetchJson<{ estimates: EstimateRecord[] }>('/api/estimator/estimates')
      .then(({ estimates }) => setEstimates(estimates))
      .catch(() => setEstimates([]))
  }

  useEffect(load, [])

  const saveActual = async () => {
    if (!recordingFor) return
    const boxCount = Number(actualBoxCount)
    if (!Number.isInteger(boxCount) || boxCount <= 0) {
      toast.error('Enter the actual number of boxes used.')
      return
    }
    setSaving(true)
    try {
      await fetchJson(`/api/estimator/estimates/${recordingFor.id}/actual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualBoxesUsed: { boxCount, note: actualNote.trim() || null },
        }),
      })
      toast.success('Actual packaging recorded — thanks for feeding the loop.')
      setRecordingFor(null)
      setActualBoxCount('')
      setActualNote('')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record actuals')
    } finally {
      setSaving(false)
    }
  }

  if (estimates === null) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-medship-slate dark:text-white/50">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading estimates…
        </CardContent>
      </Card>
    )
  }

  if (estimates.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-medship-slate dark:text-white/50">
          No estimates yet. Paste an SO number above to generate the first one.
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SO</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Boxes</TableHead>
                <TableHead className="text-right">Billable</TableHead>
                <TableHead>Routing</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
                <TableHead>Actual</TableHead>
                <TableHead className="w-[12rem]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimates.map((record) => {
                const actual = record.actualBoxesUsed as { boxCount?: number } | null
                return (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono text-xs font-medium text-medship-heading dark:text-white">
                      {record.soNumber}
                    </TableCell>
                    <TableCell className="text-xs text-medship-slate dark:text-white/60">
                      {new Date(record.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {record.packPlan.totals.boxCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {record.packPlan.totals.billableWeightLb} lb
                    </TableCell>
                    <TableCell className="text-xs">{record.packPlan.routing.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPct(record.confidenceScore)}
                    </TableCell>
                    <TableCell className="text-xs text-medship-slate dark:text-white/60">
                      {actual?.boxCount !== undefined ? (
                        <span className="font-medium text-medship-success">
                          {actual.boxCount} boxes
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onLoadEstimate(record)}
                        className="text-medship-primary hover:bg-medship-primary/5"
                      >
                        View
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRecordingFor(record)}
                        className="border-medship-border text-medship-slate hover:text-medship-primary dark:border-white/10 dark:text-white/60"
                      >
                        <ClipboardCheck className="mr-1 h-3 w-3" />
                        Record actual
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={recordingFor !== null} onOpenChange={(open) => !open && setRecordingFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-medship-heading dark:text-white">
              Record actual packaging — SO {recordingFor?.soNumber}
            </DialogTitle>
            <DialogDescription className="text-medship-text dark:text-white/60">
              The engine estimated {recordingFor?.packPlan.totals.boxCount} boxes. Recording what
              the warehouse actually used improves future estimates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="space-y-1">
              <span className="text-[0.7rem] font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
                Boxes actually used
              </span>
              <Input
                inputMode="numeric"
                value={actualBoxCount}
                onChange={(e) => setActualBoxCount(e.target.value)}
                placeholder="e.g. 4"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[0.7rem] font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
                Note (optional)
              </span>
              <Input
                value={actualNote}
                onChange={(e) => setActualNote(e.target.value)}
                placeholder="e.g. palletized, 2 oversize cartons"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={saveActual}
              disabled={saving}
              className="bg-medship-success text-white hover:bg-medship-success/90"
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
