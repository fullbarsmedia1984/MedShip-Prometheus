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

type PageProps = {
  params: Promise<{ id: string }>
}

function statusBadge(status: string) {
  const className =
    status === 'valid' || status === 'staged' || status === 'approved' || status === 'publishing'
      ? 'border-medship-success/30 bg-medship-success/10 text-medship-success'
      : status === 'blocking' || status === 'needs_review'
        ? 'border-medship-warning/30 bg-medship-warning/10 text-medship-warning'
        : 'border-border bg-muted/60 text-muted-foreground'
  return <Badge variant="outline" className={className}>{status.replace(/_/g, ' ')}</Badge>
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
          notes: 'Approved from contract pricing import review UI. Publish remains disabled.',
        }),
      })
      setNotice('Batch approved. Publish remains disabled until the controlled publish phase is implemented.')
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
                  <Badge variant="outline" className="border-medship-warning/30 bg-medship-warning/10 text-medship-warning">
                    Publish Disabled
                  </Badge>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Supplier cost review only. Approval records a gated review decision; publish and active cost creation remain disabled.
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
                <Button size="sm" disabled>Publish</Button>
              </div>
            </div>
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
              <p className="mt-3 text-sm text-muted-foreground">Preview is clear for the next implementation phase. Publish remains intentionally unavailable.</p>
            ) : null}
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
