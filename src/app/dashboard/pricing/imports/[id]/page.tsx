'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Ban, CheckCircle2, ClipboardCheck, FileText, Rows3, ShieldCheck } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchJson } from '@/lib/client-api'

type Batch = {
  id: string
  dry_run_id: string | null
  profile_name: string
  profile_version: string
  distributor_name: string | null
  status: string
  row_count: number
  valid_row_count: number
  warning_row_count: number
  blocking_row_count: number
  summary_json?: Record<string, unknown>
}

type StagedRow = {
  id: string
  row_number: number | null
  validation_status: string
  exception_codes: string[]
  warning_codes: string[]
  source_file_name: string | null
  source_sheet_name: string | null
  source_row_number: number | null
  source_cell_map: Record<string, unknown>
}

type ExceptionRow = {
  id: string
  severity: string
  exception_code: string
  canonical_field: string | null
  source_sheet_name: string | null
  source_row_number: number | null
  status: string
  resolution?: string | null
  resolution_notes?: string | null
}

type PublishPreview = {
  batchId: string
  batchStatus: string
  rowCount: number
  validRowCount: number
  warningRowCount: number
  blockingRowCount: number
  openExceptionCount: number
  unresolvedExceptionCount: number
  candidatePendingCostLines: number
  existingPendingCostLines: number
  existingActiveCostLines: number
  wouldCreateActiveCosts: false
  wouldTouchCustomerSellPricing: false
  canProceedToPublishImplementation: boolean
  blockers: string[]
}

type MatchStats = {
  costLines: number
  linkedToInternalItem: number
  linkedToHerculesItem: number
  openSuggestions: number
  approvedMatches: number
  rejectedMatches: number
}

type MatchSuggestion = {
  id: string
  target_type: 'pricing_product' | 'hercules_catalog_item'
  match_method: string
  match_confidence: number | null
  matched_identifier_field: string | null
  status: string
  cost_line_source_row_number: number | null
  cost_line_identifier: string | null
  target_label: string | null
  target_manufacturer: string | null
}

type PageProps = {
  params: Promise<{ id: string }>
}

function statusBadge(status: string) {
  const className =
    status === 'valid' || status === 'staged' || status === 'approved' || status === 'publishing' || status === 'published'
      ? 'border-medship-success/30 bg-medship-success/10 text-medship-success'
      : status === 'blocking' || status === 'needs_review' || status === 'rolled_back'
        ? 'border-medship-warning/30 bg-medship-warning/10 text-medship-warning'
        : 'border-border bg-muted/60 text-muted-foreground'
  return <Badge variant="outline" className={className}>{status.replace(/_/g, ' ')}</Badge>
}

function publishStateBadge(status: string | undefined) {
  if (status === 'published') {
    return (
      <Badge variant="outline" className="border-medship-success/30 bg-medship-success/10 text-medship-success">
        Published
      </Badge>
    )
  }
  if (status === 'rolled_back') {
    return (
      <Badge variant="outline" className="border-medship-warning/30 bg-medship-warning/10 text-medship-warning">
        Rolled Back
      </Badge>
    )
  }
  if (status === 'publishing') {
    return (
      <Badge variant="outline" className="border-medship-primary/30 bg-medship-primary/10 text-medship-primary">
        Ready For Final Publish
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-medship-warning/30 bg-medship-warning/10 text-medship-warning">
      Publish Gated
    </Badge>
  )
}

function countBy<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const value = String(row[key] ?? 'unknown')
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
}

export default function PricingImportDetailPage({ params }: PageProps) {
  const { id } = use(params)
  const [batch, setBatch] = useState<Batch | null>(null)
  const [rows, setRows] = useState<StagedRow[]>([])
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([])
  const [preview, setPreview] = useState<PublishPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<'publish' | 'rollback' | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [matchStats, setMatchStats] = useState<MatchStats | null>(null)
  const [matchSuggestions, setMatchSuggestions] = useState<MatchSuggestion[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [batchData, rowData, exceptionData] = await Promise.all([
        fetchJson<{ batch: Batch }>(`/api/pricing/contract-migration/batches/${id}`),
        fetchJson<{ rows: StagedRow[] }>(`/api/pricing/contract-migration/batches/${id}/rows?page=1&pageSize=25`),
        fetchJson<{ exceptions: ExceptionRow[] }>(`/api/pricing/contract-migration/batches/${id}/exceptions`),
      ])
      setBatch(batchData.batch)
      setRows(rowData.rows)
      setExceptions(exceptionData.exceptions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load import batch')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!batch || preview || actionLoading) return
    if (!['publishing', 'published'].includes(batch.status)) return
    let cancelled = false
    fetchJson<{ preview: PublishPreview }>(`/api/pricing/contract-migration/batches/${id}/publish-preview`)
      .then((data) => {
        if (!cancelled) setPreview(data.preview)
      })
      .catch(() => {
        /* preview stays manual on failure */
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, id])

  const exceptionCounts = useMemo(() => countBy(exceptions, 'exception_code'), [exceptions])
  const openExceptions = exceptions.filter((exception) => exception.status === 'open').length
  const topExceptions = Object.entries(exceptionCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)

  const loadPreview = useCallback(async () => {
    setActionLoading('preview')
    setError(null)
    try {
      const data = await fetchJson<{ preview: PublishPreview }>(`/api/pricing/contract-migration/batches/${id}/publish-preview`)
      setPreview(data.preview)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to build publish preview')
    } finally {
      setActionLoading(null)
    }
  }, [id])

  const approveBatch = useCallback(async () => {
    setActionLoading('approve')
    setError(null)
    setNotice(null)
    try {
      await fetchJson<{ approval: { status: string } }>(`/api/pricing/contract-migration/batches/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewerIdentifier: 'pricing-manager',
          notes: 'Approved from contract pricing import review UI.',
        }),
      })
      setNotice('Batch approved. Next: prepare pending costs, then final publish (typed confirmation required).')
      await load()
      await loadPreview()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to approve batch')
    } finally {
      setActionLoading(null)
    }
  }, [id, load, loadPreview])

  const preparePendingCosts = useCallback(async () => {
    setActionLoading('prepare')
    setError(null)
    setNotice(null)
    try {
      const data = await fetchJson<{
        preparePublish: {
          pendingCostLinesCreated: number
          pendingCostLinesReplaced: number
          activeCostLinesCreated: number
          skippedRows: number
        }
      }>(`/api/pricing/contract-migration/batches/${id}/prepare-publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: 'Prepared pending supplier cost lines from approved staged import. Active publish remains disabled.',
        }),
      })
      setNotice(
        `Prepared ${data.preparePublish.pendingCostLinesCreated.toLocaleString()} pending supplier cost lines. Active lines created: ${data.preparePublish.activeCostLinesCreated}.`
      )
      await load()
      await loadPreview()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to prepare pending costs')
    } finally {
      setActionLoading(null)
    }
  }, [id, load, loadPreview])

  const loadMatches = useCallback(async () => {
    try {
      const data = await fetchJson<{ stats: MatchStats; suggestions: MatchSuggestion[] }>(
        `/api/pricing/contract-migration/batches/${id}/match-suggestions`
      )
      setMatchStats(data.stats)
      setMatchSuggestions(data.suggestions)
    } catch {
      /* item matching not yet provisioned (migration 047) — card shows setup hint */
    }
  }, [id])

  useEffect(() => {
    loadMatches()
  }, [loadMatches])

  const generateMatches = useCallback(async () => {
    setActionLoading('match-generate')
    setError(null)
    setNotice(null)
    try {
      const data = await fetchJson<{ run: { totalSuggestions: number } }>(
        `/api/pricing/contract-migration/batches/${id}/match-suggestions`,
        { method: 'POST' }
      )
      setNotice(`Generated ${data.run.totalSuggestions.toLocaleString()} new item match suggestions.`)
      await loadMatches()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate match suggestions')
    } finally {
      setActionLoading(null)
    }
  }, [id, loadMatches])

  const reviewMatch = useCallback(async (matchId: string, status: 'approved' | 'rejected') => {
    setActionLoading(matchId)
    setError(null)
    try {
      await fetchJson<{ matchReview: { status: string } }>(`/api/pricing/item-matching/matches/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await loadMatches()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review match suggestion')
    } finally {
      setActionLoading(null)
    }
  }, [loadMatches])

  const publishBatch = useCallback(async () => {
    setActionLoading('publish')
    setError(null)
    setNotice(null)
    try {
      const data = await fetchJson<{
        publish: {
          activatedCostLines: number
          supersededCostLines: number
          linesWithoutIdentity: number
        }
      }>(`/api/pricing/contract-migration/batches/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: confirmText,
          notes: 'Final publish confirmed from contract pricing import review UI.',
        }),
      })
      setNotice(
        `Published: ${data.publish.activatedCostLines.toLocaleString()} supplier cost lines are now active. Superseded prior lines: ${data.publish.supersededCostLines.toLocaleString()}. Lines without an item identifier: ${data.publish.linesWithoutIdentity.toLocaleString()}.`
      )
      setConfirmAction(null)
      setConfirmText('')
      setPreview(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to publish batch')
    } finally {
      setActionLoading(null)
    }
  }, [id, confirmText, load])

  const rollbackBatch = useCallback(async () => {
    setActionLoading('rollback')
    setError(null)
    setNotice(null)
    try {
      const data = await fetchJson<{
        rollback: {
          deactivatedCostLines: number
          restoredCostLines: number
        }
      }>(`/api/pricing/contract-migration/batches/${id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: confirmText,
          notes: 'Rollback confirmed from contract pricing import review UI.',
        }),
      })
      setNotice(
        `Rolled back: ${data.rollback.deactivatedCostLines.toLocaleString()} cost lines deactivated, ${data.rollback.restoredCostLines.toLocaleString()} previously superseded lines restored.`
      )
      setConfirmAction(null)
      setConfirmText('')
      setPreview(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to roll back batch')
    } finally {
      setActionLoading(null)
    }
  }, [id, confirmText, load])

  const reviewException = useCallback(async (exceptionId: string, status: string) => {
    setActionLoading(exceptionId)
    setError(null)
    try {
      await fetchJson<{ exception: { status: string } }>(`/api/pricing/contract-migration/batches/${id}/exceptions/${exceptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          resolution: status,
          resolutionNotes: `Marked ${status} during import review.`,
        }),
      })
      await load()
      await loadPreview()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review exception')
    } finally {
      setActionLoading(null)
    }
  }, [id, load, loadPreview])

  return (
    <>
      <Header title="Pricing Import Detail" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <Link href="/dashboard/pricing/imports" className="text-sm text-medship-primary hover:underline">
                  Back to imports
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-card-foreground">{batch?.dry_run_id ?? 'Import batch'}</h1>
                  {batch && statusBadge(batch.status)}
                  {publishStateBadge(batch?.status)}
                </div>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Buy-side supplier costs only — customer sell pricing is never touched. Final publish activates
                  this batch&apos;s prepared cost lines and supersedes prior active costs for the same item and UOM;
                  it requires typed confirmation and can be rolled back.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>Refresh</Button>
                <Button variant="outline" size="sm" onClick={loadPreview} disabled={actionLoading !== null}>
                  Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={approveBatch}
                  disabled={actionLoading !== null || !batch || !['staged', 'needs_review'].includes(batch.status) || (batch.blocking_row_count ?? 0) > 0 || openExceptions > 0}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={preparePendingCosts}
                  disabled={actionLoading !== null || !batch || !['approved', 'publishing'].includes(batch.status) || !preview?.canProceedToPublishImplementation}
                >
                  Prepare Costs
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setConfirmAction('publish')
                    setConfirmText('')
                    setNotice(null)
                    setError(null)
                  }}
                  disabled={
                    actionLoading !== null ||
                    confirmAction !== null ||
                    batch?.status !== 'publishing' ||
                    !preview?.canProceedToPublishImplementation ||
                    (preview?.existingPendingCostLines ?? 0) === 0
                  }
                >
                  Publish
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-medship-warning/40 text-medship-warning hover:bg-medship-warning/10"
                  onClick={() => {
                    setConfirmAction('rollback')
                    setConfirmText('')
                    setNotice(null)
                    setError(null)
                  }}
                  disabled={actionLoading !== null || confirmAction !== null || batch?.status !== 'published'}
                >
                  Roll Back
                </Button>
              </div>
            </div>
            {confirmAction && (
              <div className="mt-4 rounded-md border border-medship-warning/40 bg-medship-warning/5 p-4">
                <p className="text-sm font-medium text-card-foreground">
                  {confirmAction === 'publish'
                    ? `Final publish will activate ${preview?.existingPendingCostLines?.toLocaleString() ?? '0'} pending supplier cost lines and supersede any prior active cost for the same item and UOM on this contract. Customer sell pricing is not touched. This action is audited and reversible via rollback.`
                    : 'Rollback will deactivate every cost line published by this batch and restore the lines it superseded. Customer sell pricing is not touched. This action is audited.'}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(event) => setConfirmText(event.target.value)}
                    placeholder={confirmAction === 'publish' ? 'Type PUBLISH to confirm' : 'Type ROLLBACK to confirm'}
                    className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={confirmAction === 'publish' ? publishBatch : rollbackBatch}
                    disabled={
                      actionLoading !== null ||
                      confirmText !== (confirmAction === 'publish' ? 'PUBLISH' : 'ROLLBACK')
                    }
                  >
                    {actionLoading === confirmAction
                      ? confirmAction === 'publish' ? 'Publishing...' : 'Rolling back...'
                      : confirmAction === 'publish' ? 'Confirm Publish' : 'Confirm Rollback'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmAction(null)
                      setConfirmText('')
                    }}
                    disabled={actionLoading !== null}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {notice && (
              <p className="mt-4 rounded-md border border-medship-success/25 bg-medship-success/5 p-3 text-sm text-muted-foreground">
                {notice}
              </p>
            )}
            {error && (
              <p className="mt-4 rounded-md border border-medship-warning/25 bg-medship-warning/5 p-3 text-sm text-muted-foreground">
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <Card className="shadow-sm"><CardContent className="p-4"><FileText className="mb-2 h-5 w-5 text-medship-primary" /><p className="text-2xl font-semibold">{batch?.row_count?.toLocaleString() ?? 0}</p><p className="text-xs uppercase text-muted-foreground">Rows</p></CardContent></Card>
          <Card className="shadow-sm"><CardContent className="p-4"><CheckCircle2 className="mb-2 h-5 w-5 text-medship-success" /><p className="text-2xl font-semibold">{batch?.valid_row_count?.toLocaleString() ?? 0}</p><p className="text-xs uppercase text-muted-foreground">Valid</p></CardContent></Card>
          <Card className="shadow-sm"><CardContent className="p-4"><AlertTriangle className="mb-2 h-5 w-5 text-medship-warning" /><p className="text-2xl font-semibold">{batch?.warning_row_count?.toLocaleString() ?? 0}</p><p className="text-xs uppercase text-muted-foreground">Warning</p></CardContent></Card>
          <Card className="shadow-sm"><CardContent className="p-4"><Ban className="mb-2 h-5 w-5 text-medship-danger" /><p className="text-2xl font-semibold">{batch?.blocking_row_count?.toLocaleString() ?? 0}</p><p className="text-xs uppercase text-muted-foreground">Blocking</p></CardContent></Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Publish Preview</CardTitle></CardHeader>
          <CardContent>
            {!preview ? (
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-sm text-muted-foreground">Preview summarizes pending supplier cost candidates without creating active costs.</p>
                <Button variant="outline" size="sm" onClick={loadPreview} disabled={actionLoading !== null}>Build Preview</Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
                <div className="rounded-md border p-3"><p className="text-lg font-semibold">{preview.candidatePendingCostLines.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Pending Candidates</p></div>
                <div className="rounded-md border p-3"><p className="text-lg font-semibold">{preview.openExceptionCount.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Open Exceptions</p></div>
                <div className="rounded-md border p-3"><p className="text-lg font-semibold">{preview.blockingRowCount.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Blocking Rows</p></div>
                <div className="rounded-md border p-3"><p className="text-lg font-semibold">{preview.existingPendingCostLines.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Pending Lines</p></div>
                <div className="rounded-md border p-3"><p className="text-lg font-semibold">{preview.existingActiveCostLines.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Active Lines</p></div>
                <div className="rounded-md border p-3"><p className="text-lg font-semibold">{preview.wouldTouchCustomerSellPricing ? 'Yes' : 'No'}</p><p className="text-xs uppercase text-muted-foreground">Sell Pricing</p></div>
              </div>
            )}
            {preview?.blockers?.length ? (
              <p className="mt-3 text-sm text-muted-foreground">Blockers: {preview.blockers.join(', ')}</p>
            ) : preview ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {preview.wouldCreateActiveCosts
                  ? 'Preview is clear. Final publish is available and will activate the pending cost lines above.'
                  : 'Preview is clear. Approve and prepare costs to reach the final publish gate.'}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" /> Item Matching
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!matchStats ? (
              <p className="text-sm text-muted-foreground">
                Item matching is not provisioned yet (migration 047 pending) or no data is available.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{matchStats.costLines.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Cost Lines</p></div>
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{matchStats.linkedToInternalItem.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Internal Item</p></div>
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{matchStats.linkedToHerculesItem.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Hercules Item</p></div>
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{matchStats.openSuggestions.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Open Suggestions</p></div>
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{matchStats.approvedMatches.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Approved</p></div>
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{matchStats.rejectedMatches.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Rejected</p></div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Deterministic suggest-only matching (GTIN, SKU, MPN, model). Every link requires reviewer approval;
                    unmatched lines are allowed and never block publish.
                  </p>
                  <Button variant="outline" size="sm" onClick={generateMatches} disabled={actionLoading !== null}>
                    {actionLoading === 'match-generate' ? 'Generating...' : 'Generate Suggestions'}
                  </Button>
                </div>
                {matchSuggestions.filter((match) => match.status === 'suggested').length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">Source Row</TableHead>
                          <TableHead>Line Identifier</TableHead>
                          <TableHead>Suggested Item</TableHead>
                          <TableHead>Target</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Confidence</TableHead>
                          <TableHead>Review</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {matchSuggestions.filter((match) => match.status === 'suggested').map((match) => (
                          <TableRow key={match.id}>
                            <TableCell className="text-right font-mono text-sm">{match.cost_line_source_row_number ?? '-'}</TableCell>
                            <TableCell className="max-w-[160px] truncate font-mono text-xs">{match.cost_line_identifier ?? '-'}</TableCell>
                            <TableCell className="max-w-[280px] truncate text-sm">
                              {match.target_label ?? 'Unknown'}
                              {match.target_manufacturer ? (
                                <span className="ml-1 text-xs text-muted-foreground">({match.target_manufacturer})</span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-xs">{match.target_type === 'pricing_product' ? 'Internal' : 'Hercules'}</TableCell>
                            <TableCell className="text-xs">{match.match_method.replace(/_/g, ' ')}</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {match.match_confidence === null ? '-' : `${Math.round(match.match_confidence * 100)}%`}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => reviewMatch(match.id, 'approved')} disabled={actionLoading !== null}>
                                  Approve
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => reviewMatch(match.id, 'rejected')} disabled={actionLoading !== null}>
                                  Reject
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <Card className="shadow-sm xl:col-span-8">
            <CardHeader><CardTitle className="flex items-center gap-2"><Rows3 className="h-4 w-4" /> Staged Row Lineage</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading rows...</p>
              ) : rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No staged rows available.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Sheet</TableHead>
                        <TableHead className="text-right">Source Row</TableHead>
                        <TableHead>Exception Codes</TableHead>
                        <TableHead>Mapped Fields</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{statusBadge(row.validation_status)}</TableCell>
                          <TableCell className="text-sm">{row.source_sheet_name ?? 'Unknown'}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{row.source_row_number ?? '-'}</TableCell>
                          <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{row.exception_codes?.join(', ') || 'None'}</TableCell>
                          <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{Object.keys(row.source_cell_map ?? {}).join(', ') || 'None'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm xl:col-span-4">
            <CardHeader><CardTitle>Exception Counts</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {topExceptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exceptions are staged for this batch.</p>
              ) : (
                <>
                  {topExceptions.map(([code, count]) => (
                    <div key={code} className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <span className="min-w-0 truncate text-sm">{code}</span>
                      <span className="font-mono text-sm">{count.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="space-y-2 pt-2">
                    {exceptions.slice(0, 10).map((exception) => (
                      <div key={exception.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{exception.exception_code}</p>
                            <p className="text-xs text-muted-foreground">{exception.status}</p>
                          </div>
                          <ClipboardCheck className="h-4 w-4 text-medship-primary" />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => reviewException(exception.id, 'acknowledged')} disabled={actionLoading !== null || exception.status !== 'open'}>Ack</Button>
                          <Button variant="outline" size="sm" onClick={() => reviewException(exception.id, 'waived')} disabled={actionLoading !== null || exception.status !== 'open'}>Waive</Button>
                          <Button variant="outline" size="sm" onClick={() => reviewException(exception.id, 'resolved')} disabled={actionLoading !== null || exception.status !== 'open'}>Resolve</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
