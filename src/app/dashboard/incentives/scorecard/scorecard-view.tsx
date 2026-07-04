'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DollarSign } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScorecardGateCard } from '@/components/incentive/ScorecardGateCard'
import { CommissionProjectionCard } from '@/components/incentive/CommissionProjectionCard'
import { NewAccountWindowTable } from '@/components/incentive/NewAccountWindowTable'
import { PayoutBlockedCard } from '@/components/incentive/PayoutBlockedCard'
import { fetchJson } from '@/lib/client-api'
import type { RepNewAccount } from '@/lib/incentive/types'

type ScorecardResponse = {
  rep: string
  repDisplayName?: string | null
  month: string
  monthOptions: string[]
  reps: Array<{ key: string; name: string }>
  found: boolean
  locked: boolean
  gate?: { enrollments: number; threshold: number; qualifies: boolean }
  newCustomerRevenueMTD?: number
  commission?: { base: number | null; bonus: number | null; projected: number | null }
  counterfactual?: { enrollmentsAway: number; bonusAtStake: number; message: string } | null
  accounts?: RepNewAccount[]
  payoutBlocked: boolean
  blockingUnmappedCount: number
}

function monthLabel(month: string): string {
  return new Date(`${month}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function ScorecardContent({ lockedRepKey }: { lockedRepKey: string | null }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const repParam = lockedRepKey ?? searchParams.get('rep') ?? ''
  const monthParam = searchParams.get('month') ?? ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ScorecardResponse | null>(null)

  const load = useCallback(async (rep: string, month: string) => {
    setLoading(true)
    try {
      setError(null)
      const params = new URLSearchParams()
      if (rep) params.set('rep', rep)
      if (month) params.set('month', month)
      const payload = await fetchJson<ScorecardResponse>(
        `/api/dashboard/incentives/scorecard?${params.toString()}`
      )
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scorecard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(repParam, monthParam)
  }, [load, repParam, monthParam])

  const navigate = (rep: string | null, month: string | null) => {
    const params = new URLSearchParams()
    if (rep && !lockedRepKey) params.set('rep', rep)
    if (month) params.set('month', month)
    router.replace(`/dashboard/incentives/scorecard?${params.toString()}`)
  }

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {lockedRepKey ? 'My Scorecard' : 'Rep Scorecard'}
          {lockedRepKey && data?.repDisplayName && (
            <Badge variant="outline">{data.repDisplayName}</Badge>
          )}
        </h2>
        <div className="flex flex-wrap gap-2">
          {data && data.monthOptions.length > 0 && (
            <Select
              value={data.month}
              onValueChange={(value) => value && navigate(data.found ? data.rep : null, value)}
            >
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.monthOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {monthLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!lockedRepKey && data && (
            <Select value={data.found ? data.rep : undefined} onValueChange={(rep) => navigate(rep, data.month)}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Select a rep…" />
              </SelectTrigger>
              <SelectContent>
                {data.reps.map((rep) => (
                  <SelectItem key={rep.key} value={rep.key}>
                    {rep.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading scorecard…</p>
      ) : data && !data.found ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {lockedRepKey
              ? `No incentive activity recorded for you in ${monthLabel(data.month)} yet — new-customer orders appear here within ~15 minutes of issuing.`
              : data.reps.length === 0
                ? 'No incentive data for this month yet. Run a recompute or check back after the next sync.'
                : 'Pick a rep above to see their scorecard.'}
          </CardContent>
        </Card>
      ) : data && data.found && data.gate && data.commission ? (
        <>
          {data.payoutBlocked && <PayoutBlockedCard blockingUnmappedCount={data.blockingUnmappedCount} />}

          <div className="grid gap-6 lg:grid-cols-3">
            <ScorecardGateCard
              enrollments={data.gate.enrollments}
              threshold={data.gate.threshold}
              qualifies={data.gate.qualifies}
            />
            <KpiCard
              title={`New-Customer Revenue — ${monthLabel(data.month)}`}
              value={`$${Math.round(data.newCustomerRevenueMTD ?? 0).toLocaleString()}`}
              icon={DollarSign}
              iconColor="text-medship-success"
            />
            <CommissionProjectionCard
              base={data.commission.base}
              bonus={data.commission.bonus}
              projected={data.commission.projected}
              counterfactual={data.counterfactual ?? null}
              payoutBlocked={data.payoutBlocked}
              blockingUnmappedCount={data.blockingUnmappedCount}
            />
          </div>

          <NewAccountWindowTable accounts={data.accounts ?? []} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">New Business Meetings</CardTitle>
            </CardHeader>
            <CardContent>
              <ComingSoonPanel
                title="NBM activity — Phase 2"
                description="NBM vs Profile Call tracking requires the Salesforce Record Type fix and an activity-sync update. It ships in Phase 2 of the incentive program."
                className="h-[140px]"
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </main>
  )
}

export function ScorecardView({ lockedRepKey }: { lockedRepKey: string | null }) {
  return (
    <div className="flex flex-col">
      <Header title="Q3 Incentive" />
      <Suspense fallback={<p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}>
        <ScorecardContent lockedRepKey={lockedRepKey} />
      </Suspense>
    </div>
  )
}
