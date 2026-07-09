'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen, ExternalLink } from 'lucide-react'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchJson } from '@/lib/client-api'
import { cn } from '@/lib/utils'

type IngestionRun = {
  id: string
  runType: 'full' | 'delta'
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  nextOffset: number
  totalRemote: number | null
  itemsSeen: number
  itemsInserted: number
  itemsUpdated: number
  itemsRejected: number
  startedAt: string
  completedAt: string | null
  lastError: string | null
}

type IngestStatusResponse = {
  configured: boolean
  activeRun: IngestionRun | null
  recentRuns: IngestionRun[]
  watermark: string | null
}

function formatDateTime(isoString?: string | null): string {
  if (!isoString) return 'Never'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return 'Never'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * P10 ops card: Hercules supplier catalog ingestion status. Reads the
 * staff-visible run status endpoint and refreshes while a run is active.
 */
export function HerculesIngestionCard() {
  const [status, setStatus] = useState<IngestStatusResponse | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<IngestStatusResponse>('/api/hercules/ingest')
      setStatus(data)
      setUnavailable(false)
    } catch {
      setUnavailable(true)
    }
  }, [])

  useEffect(() => {
    // load() only touches state after awaiting the API response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  useEffect(() => {
    if (!status?.activeRun) return
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [status?.activeRun, load])

  const run = status?.activeRun ?? status?.recentRuns?.[0] ?? null
  const progressPct =
    run && run.totalRemote && run.totalRemote > 0
      ? Math.min(100, Math.round((run.nextOffset / run.totalRemote) * 1000) / 10)
      : null

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-medship-primary" />
            Hercules Supplier Catalog Ingestion
          </span>
          <Link
            href="/dashboard/catalog"
            className="inline-flex items-center gap-1 text-xs font-normal text-medship-primary hover:underline"
          >
            Browse catalog <ExternalLink className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {unavailable || !status ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {unavailable ? 'Ingestion status unavailable.' : 'Loading…'}
          </p>
        ) : !status.configured && !run ? (
          <ComingSoonPanel
            title="Hercules API not configured"
            description="Set HERCULES_API_APP_ID and HERCULES_API_ACCESS_TOKEN to enable catalog ingestion."
          />
        ) : !run ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No ingestion runs yet.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={run.status} />
              <span className="text-sm text-muted-foreground">
                {run.runType === 'full' ? 'Full import' : 'Delta sync'} · started{' '}
                {formatDateTime(run.startedAt)}
                {run.completedAt ? ` · finished ${formatDateTime(run.completedAt)}` : ''}
              </span>
            </div>

            {progressPct !== null && (
              <div className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="tabular-nums">
                    {run.nextOffset.toLocaleString()} /{' '}
                    {(run.totalRemote ?? 0).toLocaleString()} parts
                  </span>
                  <span className="font-medium tabular-nums">{progressPct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      run.status === 'failed' ? 'bg-medship-danger' : 'bg-medship-primary'
                    )}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-2xl font-semibold tabular-nums">
                  {run.itemsInserted.toLocaleString()}
                </p>
                <p className="text-xs uppercase text-muted-foreground">Inserted</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-2xl font-semibold tabular-nums">
                  {run.itemsUpdated.toLocaleString()}
                </p>
                <p className="text-xs uppercase text-muted-foreground">Updated</p>
              </div>
              <div className="rounded-lg border p-3">
                <p
                  className={cn(
                    'text-2xl font-semibold tabular-nums',
                    run.itemsRejected > 0 && 'text-medship-danger'
                  )}
                >
                  {run.itemsRejected.toLocaleString()}
                </p>
                <p className="text-xs uppercase text-muted-foreground">Rejected</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-sm font-semibold">
                  {formatDateTime(status.watermark)}
                </p>
                <p className="text-xs uppercase text-muted-foreground">Delta Watermark</p>
              </div>
            </div>

            {run.lastError && (
              <p className="rounded-md bg-medship-danger/10 px-3 py-2 text-sm text-medship-danger">
                {run.lastError}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
