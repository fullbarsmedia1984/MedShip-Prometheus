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
  inPromoPeriod: boolean
  reps: Array<{ key: string; name: string }>
  found: boolean
  locked: boolean
  gate?: { enrollments: number; threshold: number; qualifies: boolean; recurringRate: number }
  newCustomerRevenueMTD?: number
  commission?: {
    new: number | null
    winback: number | null
    recurring: number | null
    projected: number | null
  }
  counterfactual?: { enrollmentsAway: number; recurringAtStake: number; message: string } | null
  accounts?: RepNewAccount[]
  breakdown?: {
    newRevenue: number
    newOrders: number
    winbackRevenue: number
    winbackOrders: number
    recurringRevenue: number
    recurringOrders: number
    creditsAmount: number
    creditsOrders: number
  }
  modelComparison?: { oldModelTotal: number; newModelTotal: number | null; delta: number | null }
  rates?: {
    new: number
    winback: number
    recurringFull: number
    recurringPartial: number
    recurringZero: number
    legacyFlat: number
  }
  payoutBlocked: boolean
  blockingUnmappedCount: number
}

type ExplainResponse = {
  found: boolean
  explanation?: { text: string; source: 'ai' | 'fallback' }
}

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`
}

function pct(rate: number): string {
  const value = rate * 100
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`
}

function monthLabel(month: string): string {
  return new Date(`${month}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function ScorecardContent({
  lockedRepKey,
  previewMode,
}: {
  lockedRepKey: string | null
  previewMode: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const repParam = lockedRepKey ?? searchParams.get('rep') ?? ''
  const monthParam = searchParams.get('month') ?? ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ScorecardResponse | null>(null)
  const [explanation, setExplanation] = useState<string | null>(null)

  const load = useCallback(async (rep: string, month: string) => {
    setLoading(true)
    try {
      setError(null)
      const params = new URLSearchParams()
      // Preview requests use viewAs so the API returns the exact locked
      // payload a sales_rep login receives.
      if (rep) params.set(previewMode ? 'viewAs' : 'rep', rep)
      if (month) params.set('month', month)
      const payload = await fetchJson<ScorecardResponse>(
        `/api/dashboard/incentives/scorecard?${params.toString()}`
      )
      setData(payload)

      // Model-comparison narrative loads after the main payload (it may take
      // a few seconds on a cold AI call); failures degrade to no section.
      setExplanation(null)
      if (payload.found) {
        const explainParams = new URLSearchParams(params)
        explainParams.set(previewMode ? 'viewAs' : 'rep', payload.rep)
        void fetchJson<ExplainResponse>(
          `/api/dashboard/incentives/scorecard/explain?${explainParams.toString()}`
        )
          .then((result) => {
            if (result.found && result.explanation) setExplanation(result.explanation.text)
          })
          .catch(() => {})
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scorecard')
    } finally {
      setLoading(false)
    }
  }, [previewMode])

  useEffect(() => {
    void load(repParam, monthParam)
  }, [load, repParam, monthParam])

  const navigate = (rep: string | null, month: string | null) => {
    const params = new URLSearchParams()
    if (lockedRepKey && previewMode) params.set('viewAs', lockedRepKey)
    if (rep && !lockedRepKey) params.set('rep', rep)
    if (month) params.set('month', month)
    router.replace(`/dashboard/incentives/scorecard?${params.toString()}`)
  }

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      {previewMode && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800">
          <span>
            <b>Rep preview</b> — this is exactly what{' '}
            {data?.repDisplayName ?? 'this rep'} will see when they log in (same API scoping;
            no other reps&apos; data is included).
          </span>
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => router.push('/dashboard/incentives')}
          >
            Exit preview
          </button>
        </div>
      )}
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
          {!data.inPromoPeriod && (
            <p className="rounded-md border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm text-slate-700">
              {monthLabel(data.month)} is outside the Q3 promo period — these are reference
              figures computed under the program rules, not payable commissions.
            </p>
          )}
          {data.payoutBlocked && <PayoutBlockedCard blockingUnmappedCount={data.blockingUnmappedCount} />}

          <div className="grid gap-6 lg:grid-cols-3">
            <ScorecardGateCard
              enrollments={data.gate.enrollments}
              threshold={data.gate.threshold}
              qualifies={data.gate.qualifies}
              recurringRate={data.gate.recurringRate}
              fullRate={data.rates?.recurringFull ?? 0.04}
            />
            <KpiCard
              title={`New-Customer Revenue — ${monthLabel(data.month)}`}
              value={`$${Math.round(data.newCustomerRevenueMTD ?? 0).toLocaleString()}`}
              icon={DollarSign}
              iconColor="text-medship-success"
            />
            <CommissionProjectionCard
              newCommission={data.commission.new}
              winbackCommission={data.commission.winback}
              recurringCommission={data.commission.recurring}
              projected={data.commission.projected}
              counterfactual={data.counterfactual ?? null}
              payoutBlocked={data.payoutBlocked}
              blockingUnmappedCount={data.blockingUnmappedCount}
            />
          </div>

          {data.breakdown && data.rates && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Commission Breakdown — {monthLabel(data.month)}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  New business pays {pct(data.rates.new)} and winbacks pay {pct(data.rates.winback)} for the
                  first 365 days after enrollment. Recurring business pays {pct(data.rates.recurringFull)} when
                  you land {data.gate.threshold}+ new enrollments in the month, {pct(data.rates.recurringPartial)} at
                  one, and {pct(data.rates.recurringZero)} at zero.
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Revenue type</th>
                      <th className="px-4 py-2 text-center font-medium">Orders</th>
                      <th className="px-4 py-2 text-right font-medium">Revenue</th>
                      <th className="px-4 py-2 text-center font-medium">Rate</th>
                      <th className="px-4 py-2 text-right font-medium">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ['New business', data.breakdown.newOrders, data.breakdown.newRevenue, data.rates.new, data.commission?.new ?? null, null],
                      ['Winback', data.breakdown.winbackOrders, data.breakdown.winbackRevenue, data.rates.winback, data.commission?.winback ?? null, null],
                      [
                        'Recurring',
                        data.breakdown.recurringOrders,
                        data.breakdown.recurringRevenue,
                        data.gate.recurringRate,
                        data.commission?.recurring ?? null,
                        data.gate.qualifies
                          ? 'quota met'
                          : `${data.gate.enrollments}/${data.gate.threshold} enrollments — reduced rate`,
                      ],
                    ] as Array<[string, number, number, number, number | null, string | null]>).map(
                      ([label, orders, revenue, rate, commission, note]) => (
                        <tr key={label} className="border-b">
                          <td className="px-4 py-2 font-medium">{label}</td>
                          <td className="px-4 py-2 text-center tabular-nums">{orders}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{usd(revenue)}</td>
                          <td className="px-4 py-2 text-center tabular-nums">
                            {pct(rate)}
                            {note && (
                              <span
                                className={`ml-1.5 text-[0.65rem] ${
                                  note === 'quota met' ? 'text-emerald-600' : 'text-amber-600'
                                }`}
                              >
                                ({note})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {commission === null ? '—' : usd(commission)}
                          </td>
                        </tr>
                      )
                    )}
                    {data.breakdown.creditsOrders > 0 && (
                      <tr className="border-b text-xs text-muted-foreground">
                        <td className="px-4 py-2" colSpan={5}>
                          Includes {data.breakdown.creditsOrders} credit
                          {data.breakdown.creditsOrders === 1 ? '' : 's'} / adjustment
                          {data.breakdown.creditsOrders === 1 ? '' : 's'} totaling{' '}
                          {usd(data.breakdown.creditsAmount)}, already netted into the revenue above.
                        </td>
                      </tr>
                    )}
                    <tr className="font-semibold">
                      <td className="px-4 py-2">Total</td>
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2 text-right tabular-nums">
                        {usd(
                          data.breakdown.newRevenue +
                            data.breakdown.winbackRevenue +
                            data.breakdown.recurringRevenue
                        )}
                      </td>
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2 text-right tabular-nums">
                        {data.commission?.projected !== null && data.commission?.projected !== undefined
                          ? usd(data.commission.projected)
                          : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          <NewAccountWindowTable accounts={data.accounts ?? []} />

          {data.modelComparison && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  vs. the old {pct(data.rates?.legacyFlat ?? 0.04)} flat commission
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">
                      Old model ({pct(data.rates?.legacyFlat ?? 0.04)} flat)
                    </p>
                    <p className="text-xl font-bold tabular-nums">{usd(data.modelComparison.oldModelTotal)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">New model (tiered by cohort)</p>
                    <p className="text-xl font-bold tabular-nums">
                      {data.modelComparison.newModelTotal === null ? '—' : usd(data.modelComparison.newModelTotal)}
                    </p>
                  </div>
                  <div
                    className={`rounded-lg border p-3 ${
                      (data.modelComparison.delta ?? 0) > 0.005
                        ? 'border-emerald-500/40 bg-emerald-500/5'
                        : (data.modelComparison.delta ?? 0) < -0.005
                          ? 'border-red-500/40 bg-red-500/5'
                          : 'bg-muted/30'
                    }`}
                  >
                    <p className="text-xs text-muted-foreground">
                      {(data.modelComparison.delta ?? 0) < -0.005 ? 'Quota penalty this month' : 'Your upside this month'}
                    </p>
                    <p
                      className={`text-xl font-bold tabular-nums ${
                        (data.modelComparison.delta ?? 0) > 0.005
                          ? 'text-emerald-700'
                          : (data.modelComparison.delta ?? 0) < -0.005
                            ? 'text-red-700'
                            : ''
                      }`}
                    >
                      {data.modelComparison.delta === null
                        ? '—'
                        : `${data.modelComparison.delta > 0.005 ? '+' : data.modelComparison.delta < -0.005 ? '−' : ''}${usd(Math.abs(data.modelComparison.delta))}`}
                    </p>
                  </div>
                </div>
                {explanation ? (
                  <p className="rounded-md border bg-muted/20 px-4 py-3 text-sm leading-relaxed">{explanation}</p>
                ) : (
                  <p className="px-1 text-xs text-muted-foreground">Preparing your month summary…</p>
                )}
                <p className="text-xs text-muted-foreground">
                  How this compares: new business ({pct(data.rates?.new ?? 0.06)}) and winbacks (
                  {pct(data.rates?.winback ?? 0.05)}) pay above the old flat rate, but the recurring rate rides on
                  your monthly enrollment quota — {pct(data.rates?.recurringFull ?? 0.04)} at{' '}
                  {data.gate.threshold}+, {pct(data.rates?.recurringPartial ?? 0.03)} at one,{' '}
                  {pct(data.rates?.recurringZero ?? 0.02)} at zero. Missing the quota can pay less than the old
                  model; hitting it protects your recurring book and keeps the premium rates pure upside.
                </p>
              </CardContent>
            </Card>
          )}

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

export function ScorecardView({
  lockedRepKey,
  previewMode = false,
}: {
  lockedRepKey: string | null
  previewMode?: boolean
}) {
  return (
    <div className="flex flex-col">
      <Header title="Q3 Incentive" />
      <Suspense fallback={<p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}>
        <ScorecardContent lockedRepKey={lockedRepKey} previewMode={previewMode} />
      </Suspense>
    </div>
  )
}
