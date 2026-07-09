'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Boxes,
  History,
  Loader2,
  PackageSearch,
  Pencil,
  Search,
  Settings2,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Header } from '@/components/layout/Header'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { cn } from '@/lib/utils'
import { ConfidenceMeter } from './ConfidenceMeter'
import { DimsSourceBadge } from './DimsSourceBadge'
import { EstimateResults } from './EstimateResults'
import { PastEstimates } from './PastEstimates'
import { VerifyDimsDialog } from './VerifyDimsDialog'
import {
  formatDims,
  type EstimateRecord,
  type ResolvedLineItem,
  type SalesOrderSummary,
} from './estimator-types'

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7

export function EstimatorClient({ canManage = false }: { canManage?: boolean }) {
  const [soInput, setSoInput] = useState('')
  const [loadingSo, setLoadingSo] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [summary, setSummary] = useState<SalesOrderSummary | null>(null)
  const [estimate, setEstimate] = useState<EstimateRecord | null>(null)
  const [verifyLine, setVerifyLine] = useState<ResolvedLineItem | null>(null)
  const [confidenceThreshold, setConfidenceThreshold] = useState(DEFAULT_CONFIDENCE_THRESHOLD)
  const [historyKey, setHistoryKey] = useState(0)

  useEffect(() => {
    fetchJson<{ rules: { estimate_confidence_threshold?: number } }>('/api/estimator/rules')
      .then(({ rules }) => {
        if (typeof rules.estimate_confidence_threshold === 'number') {
          setConfidenceThreshold(rules.estimate_confidence_threshold)
        }
      })
      .catch(() => {
        // Threshold stays at the default when rules aren't reachable.
      })
  }, [])

  const fetchSo = useCallback(
    async (soNumber?: string) => {
      const target = (soNumber ?? soInput).trim()
      if (!target) return
      setLoadingSo(true)
      setEstimate(null)
      try {
        const { summary } = await fetchJson<{ summary: SalesOrderSummary }>(
          `/api/estimator/so/${encodeURIComponent(target)}`
        )
        setSummary(summary)
        if (summary.lineItems.length === 0) {
          toast.warning('No physical line items found on this SO.')
        }
      } catch (err) {
        setSummary(null)
        toast.error(err instanceof Error ? err.message : 'Failed to fetch SO')
      } finally {
        setLoadingSo(false)
      }
    },
    [soInput]
  )

  const refreshAfterVerify = useCallback(() => {
    if (summary) void fetchSo(summary.soNumber)
  }, [summary, fetchSo])

  const generate = async () => {
    if (!summary) return
    setGenerating(true)
    try {
      const response = await fetchJson<{
        estimate: EstimateRecord
        summary: SalesOrderSummary
      }>('/api/estimator/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soNumber: summary.soNumber }),
      })
      setEstimate(response.estimate)
      setSummary(response.summary)
      setHistoryKey((k) => k + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate estimate')
    } finally {
      setGenerating(false)
    }
  }

  const unverifiedCount =
    summary?.lineItems.filter((line) => line.dimsSource !== 'verified').length ?? 0

  return (
    <>
      <Header title="Packaging Estimator" />
      <main className="flex-1 space-y-6 overflow-auto p-4 md:p-6">
        {/* SO input */}
        <Card className="border-medship-primary/20">
          <CardContent className="pt-6">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void fetchSo()
              }}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <label className="flex-1 space-y-1.5">
                <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
                  <PackageSearch className="h-3.5 w-3.5 text-medship-primary" />
                  Fishbowl Sales Order number
                </span>
                <Input
                  value={soInput}
                  onChange={(e) => setSoInput(e.target.value)}
                  placeholder="Paste an SO number, e.g. 10245"
                  className="h-11 font-mono text-base"
                  autoFocus
                />
              </label>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={loadingSo || !soInput.trim()}
                  className="h-11 bg-medship-primary px-6 text-white hover:bg-medship-primary/90"
                >
                  {loadingSo ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  Fetch line items
                </Button>
                {canManage && (
                  <Link
                    href="/dashboard/estimator/admin"
                    className={cn(
                      buttonVariants({ variant: 'outline' }),
                      'h-11 border-medship-border text-medship-slate hover:text-medship-primary dark:border-white/10 dark:text-white/60'
                    )}
                  >
                    <Settings2 className="mr-2 h-4 w-4" />
                    Admin
                  </Link>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Line items */}
        {summary && (
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-medship-heading dark:text-white">
                  <Boxes className="h-4 w-4 text-medship-primary" />
                  SO {summary.soNumber}
                  {summary.status && (
                    <Badge
                      variant="outline"
                      className="border-medship-border font-normal text-medship-slate dark:border-white/20 dark:text-white/60"
                    >
                      {summary.status}
                    </Badge>
                  )}
                </CardTitle>
                <div className="mt-1 text-xs text-medship-slate dark:text-white/50">
                  {summary.customerName ?? 'Unknown customer'} • {summary.lineItems.length} physical
                  line{summary.lineItems.length === 1 ? '' : 's'}
                  {summary.excludedLineCount > 0 &&
                    ` • ${summary.excludedLineCount} non-physical line${summary.excludedLineCount === 1 ? '' : 's'} excluded`}
                </div>
              </div>
              <ConfidenceMeter confidence={summary.confidence} threshold={confidenceThreshold} />
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Dims used</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="w-[6rem]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.lineItems.map((line) => (
                    <TableRow key={line.partNumber}>
                      <TableCell className="font-mono text-xs font-medium text-medship-heading dark:text-white">
                        {line.partNumber}
                      </TableCell>
                      <TableCell className="max-w-[18rem] truncate text-medship-slate dark:text-white/70">
                        {line.description}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.quantity}
                        {line.uom ? ` ${line.uom}` : ''}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDims(
                          line.resolved.lengthIn,
                          line.resolved.widthIn,
                          line.resolved.heightIn
                        )}{' '}
                        • {line.resolved.weightLb} lb
                      </TableCell>
                      <TableCell>
                        <DimsSourceBadge source={line.dimsSource} />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant={line.dimsSource === 'verified' ? 'ghost' : 'outline'}
                          onClick={() => setVerifyLine(line)}
                          className={cn(
                            line.dimsSource === 'verified'
                              ? 'text-medship-slate hover:text-medship-primary dark:text-white/50'
                              : 'border-medship-primary/40 text-medship-primary hover:bg-medship-primary/5'
                          )}
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          {line.dimsSource === 'verified' ? 'Edit' : 'Confirm dims'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex flex-col items-start justify-between gap-3 border-t border-medship-border pt-4 sm:flex-row sm:items-center dark:border-white/10">
                <div className="text-xs text-medship-slate dark:text-white/50">
                  {unverifiedCount === 0
                    ? 'All items verified — estimate will generate with full confidence.'
                    : `${unverifiedCount} item${unverifiedCount === 1 ? '' : 's'} unverified — confirm dims to raise confidence, or generate now with untrusted values.`}
                </div>
                <Button
                  type="button"
                  onClick={generate}
                  disabled={generating || summary.lineItems.length === 0}
                  className="bg-medship-secondary px-8 text-white hover:bg-medship-secondary/90"
                >
                  {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Generate estimate
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {estimate && (
          <EstimateResults estimate={estimate} confidenceThreshold={confidenceThreshold} />
        )}

        {/* Past estimates + feedback loop */}
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-medship-heading dark:text-white">
            <History className="h-4 w-4 text-medship-primary" />
            Recent estimates
          </div>
          <PastEstimates
            key={historyKey}
            onLoadEstimate={(record) => {
              setEstimate(record)
              setSoInput(record.soNumber)
            }}
          />
        </div>
      </main>

      <VerifyDimsDialog
        line={verifyLine}
        onClose={() => setVerifyLine(null)}
        onSaved={refreshAfterVerify}
      />
    </>
  )
}
