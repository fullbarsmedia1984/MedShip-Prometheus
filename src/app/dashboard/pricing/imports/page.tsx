'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Database, FileText, ShieldAlert } from 'lucide-react'
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

type BatchRow = {
  id: string
  dry_run_id: string | null
  source_file_name: string | null
  profile_name: string
  profile_version: string
  distributor_name: string | null
  status: string
  row_count: number
  valid_row_count: number
  warning_row_count: number
  blocking_row_count: number
  created_at: string
}

function statusBadge(status: string) {
  const className =
    status === 'staged' || status === 'approved'
      ? 'border-medship-success/30 bg-medship-success/10 text-medship-success'
      : status === 'needs_review'
        ? 'border-medship-warning/30 bg-medship-warning/10 text-medship-warning'
        : 'border-border bg-muted/60 text-muted-foreground'
  return <Badge variant="outline" className={className}>{status.replace(/_/g, ' ')}</Badge>
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function PricingImportsPage() {
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadBatches = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<{ batches: BatchRow[] }>('/api/pricing/contract-migration/batches')
      setBatches(data.batches)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load contract cost imports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBatches()
  }, [loadBatches])

  const totalRows = batches.reduce((sum, batch) => sum + (batch.row_count ?? 0), 0)
  const blockingRows = batches.reduce((sum, batch) => sum + (batch.blocking_row_count ?? 0), 0)

  return (
    <>
      <Header title="Pricing Imports" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-card-foreground">Supplier Contract Cost Imports</h1>
                  <Badge variant="outline" className="border-medship-primary/30 bg-medship-primary/10 text-medship-primary">
                    Buy-Side Costs
                  </Badge>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Reviewed dry-run outputs stage supplier cost data. Approve, prepare, and final-publish flows are
                  gated per batch with typed confirmation and rollback. Customer sell pricing is never touched.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={loadBatches} disabled={loading}>
                  Refresh
                </Button>
                <Button size="sm" render={<Link href="/dashboard/pricing/imports/upload" />}>
                  Upload Workbook
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-medship-primary" />
                <div>
                  <p className="text-2xl font-semibold">{batches.length}</p>
                  <p className="text-xs uppercase text-muted-foreground">Staged Batches</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Database className="h-5 w-5 text-medship-info" />
                <div>
                  <p className="text-2xl font-semibold">{totalRows.toLocaleString()}</p>
                  <p className="text-xs uppercase text-muted-foreground">Rows Staged</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-medship-warning" />
                <div>
                  <p className="text-2xl font-semibold">{blockingRows.toLocaleString()}</p>
                  <p className="text-xs uppercase text-muted-foreground">Blocking Rows</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-medship-warning" />
              Import Batches
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <p className="mb-4 rounded-md border border-medship-warning/25 bg-medship-warning/5 p-3 text-sm text-muted-foreground">
                {error}
              </p>
            )}
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading imports...</p>
            ) : batches.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No staged supplier cost imports yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dry Run</TableHead>
                      <TableHead>Profile</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Rows</TableHead>
                      <TableHead className="text-right">Blocking</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map((batch) => (
                      <TableRow key={batch.id}>
                        <TableCell>
                          <Link href={`/dashboard/pricing/imports/${batch.id}`} className="font-medium text-medship-primary hover:underline">
                            {batch.dry_run_id ?? 'Dry run'}
                          </Link>
                          <p className="text-xs text-muted-foreground">{batch.distributor_name ?? 'Unknown distributor'}</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {batch.profile_name} / {batch.profile_version}
                        </TableCell>
                        <TableCell>{statusBadge(batch.status)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{batch.row_count.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{batch.blocking_row_count.toLocaleString()}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(batch.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  )
}
