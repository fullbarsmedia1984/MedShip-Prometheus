'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DollarSign } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  reps: Array<{ key: string; name: string }>
  found: boolean
  gate?: { enrollments: number; threshold: number; qualifies: boolean }
  newCustomerRevenueMTD?: number
  commission?: { base: number | null; bonus: number | null; projected: number | null }
  counterfactual?: { enrollmentsAway: number; bonusAtStake: number; message: string } | null
  accounts?: RepNewAccount[]
  payoutBlocked: boolean
  blockingUnmappedCount: number
}

function ScorecardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const repParam = searchParams.get('rep') ?? ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ScorecardResponse | null>(null)

  const load = useCallback(async (rep: string) => {
    setLoading(true)
    try {
      setError(null)
      const payload = await fetchJson<ScorecardResponse>(
        `/api/dashboard/incentives/scorecard?rep=${encodeURIComponent(rep)}`
      )
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scorecard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(repParam)
  }, [load, repParam])

  const selectRep = (rep: string | null) => {
    if (!rep) return
    router.replace(`/dashboard/incentives/scorecard?rep=${encodeURIComponent(rep)}`)
  }

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Rep Scorecard</h2>
        {data && (
          <Select value={data.found ? data.rep : undefined} onValueChange={selectRep}>
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

      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading scorecard…</p>
      ) : data && !data.found ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {data.reps.length === 0
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
              title="New-Customer Revenue MTD"
              value={`$${Math.round(data.newCustomerRevenueMTD ?? 0)}`}
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

export default function ScorecardPage() {
  return (
    <div className="flex flex-col">
      <Header title="Q3 Incentive" />
      <Suspense fallback={<p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}>
        <ScorecardContent />
      </Suspense>
    </div>
  )
}
