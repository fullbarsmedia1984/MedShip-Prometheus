'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ClipboardList, ShieldAlert } from 'lucide-react'
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
  profile_name: string
  profile_version: string
  distributor_name: string | null
  status: string
  row_count: number
  warning_row_count: number
  blocking_row_count: number
}

function statusBadge(status: string) {
  return (
    <Badge variant="outline" className="border-medship-warning/30 bg-medship-warning/10 text-medship-warning">
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

export default function PricingExceptionsPage() {
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<{ batches: BatchRow[] }>('/api/pricing/contract-migration/batches')
      setBatches(data.batches)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pricing exceptions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const exceptionBatches = useMemo(
    () => batches.filter((batch) => (batch.blocking_row_count ?? 0) > 0 || (batch.warning_row_count ?? 0) > 0),
    [batches]
  )
  const blockingRows = exceptionBatches.reduce((sum, batch) => sum + (batch.blocking_row_count ?? 0), 0)
  const warningRows = exceptionBatches.reduce((sum, batch) => sum + (batch.warning_row_count ?? 0), 0)

  return (
    <>
      <Header title="Pricing Exceptions" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-card-foreground">Supplier Cost Exception Queue</h1>
                  <Badge variant="outline" className="border-medship-warning/30 bg-medship-warning/10 text-medship-warning">
                    Review Only
                  </Badge>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Exceptions come from staged supplier contract-cost dry-runs. Exception review is enabled; publishing and active cost creation remain disabled.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>Refresh</Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="shadow-sm"><CardContent className="p-4"><ClipboardList className="mb-2 h-5 w-5 text-medship-primary" /><p className="text-2xl font-semibold">{exceptionBatches.length}</p><p className="text-xs uppercase text-muted-foreground">Batches With Exceptions</p></CardContent></Card>
          <Card className="shadow-sm"><CardContent className="p-4"><AlertTriangle className="mb-2 h-5 w-5 text-medship-warning" /><p className="text-2xl font-semibold">{warningRows.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Warning Rows</p></CardContent></Card>
          <Card className="shadow-sm"><CardContent className="p-4"><ShieldAlert className="mb-2 h-5 w-5 text-medship-danger" /><p className="text-2xl font-semibold">{blockingRows.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Blocking Rows</p></CardContent></Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader><CardTitle>Exception Batches</CardTitle></CardHeader>
          <CardContent>
            {error && (
              <p className="mb-4 rounded-md border border-medship-warning/25 bg-medship-warning/5 p-3 text-sm text-muted-foreground">
                {error}
              </p>
            )}
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading exceptions...</p>
            ) : exceptionBatches.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No staged exception batches yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch</TableHead>
                      <TableHead>Profile</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Warnings</TableHead>
                      <TableHead className="text-right">Blocking</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exceptionBatches.map((batch) => (
                      <TableRow key={batch.id}>
                        <TableCell>
                          <Link href={`/dashboard/pricing/imports/${batch.id}`} className="font-medium text-medship-primary hover:underline">
                            {batch.dry_run_id ?? 'Import batch'}
                          </Link>
                          <p className="text-xs text-muted-foreground">{batch.distributor_name ?? 'Unknown distributor'}</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{batch.profile_name} / {batch.profile_version}</TableCell>
                        <TableCell>{statusBadge(batch.status)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{batch.warning_row_count.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{batch.blocking_row_count.toLocaleString()}</TableCell>
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
