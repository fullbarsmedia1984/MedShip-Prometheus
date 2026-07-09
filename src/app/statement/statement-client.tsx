'use client'

import { useCallback, useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { fetchJson } from '@/lib/client-api'

type ScorecardPayload = {
  rep: string
  repDisplayName?: string | null
  month: string
  found: boolean
  gate?: { enrollments: number; threshold: number; qualifies: boolean; recurringRate: number }
  commission?: {
    new: number | null
    winback: number | null
    recurring: number | null
    projected: number | null
  }
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
  inPromoPeriod: boolean
  payoutBlocked: boolean
}

type FreezePayload = {
  snapshots: Array<{
    month: string
    rep_key: string
    enrollments: number
    qualifies: boolean
    recurring_rate: number
    new_commission: number
    winback_commission: number
    recurring_commission: number
    projected_total: number
    legacy_flat_commission: number
    frozen_at: string
    frozen_by: string | null
  }>
}

type ExplainPayload = { found: boolean; explanation?: { text: string } }

function usd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function pct(rate: number): string {
  const value = rate * 100
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`
}

function monthLabel(month: string): string {
  return new Date(`${month}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function StatementClient({ repKey, month }: { repKey: string | null; month: string | null }) {
  const [data, setData] = useState<ScorecardPayload | null>(null)
  const [frozen, setFrozen] = useState<FreezePayload['snapshots'][number] | null>(null)
  const [narrative, setNarrative] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!repKey || !month) return
    try {
      const params = `rep=${encodeURIComponent(repKey)}&month=${encodeURIComponent(month)}`
      const [scorecard, freeze] = await Promise.all([
        fetchJson<ScorecardPayload>(`/api/dashboard/incentives/scorecard?${params}`),
        fetchJson<FreezePayload>('/api/dashboard/incentives/freeze').catch(() => ({ snapshots: [] })),
      ])
      setData(scorecard)
      setFrozen(freeze.snapshots.find((row) => row.month === month && row.rep_key === repKey) ?? null)
      void fetchJson<ExplainPayload>(`/api/dashboard/incentives/scorecard/explain?${params}`)
        .then((result) => {
          if (result.found && result.explanation) setNarrative(result.explanation.text)
        })
        .catch(() => {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statement')
    }
  }, [repKey, month])

  useEffect(() => {
    void load()
  }, [load])

  if (!repKey || !month) {
    return (
      <main className="mx-auto max-w-2xl p-10 text-sm text-muted-foreground">
        Missing parameters — open a statement from the Incentives manager page or the admin payout panel.
      </main>
    )
  }
  if (error) return <main className="mx-auto max-w-2xl p-10 text-sm text-red-600">{error}</main>
  if (!data) return <main className="mx-auto max-w-2xl p-10 text-sm text-muted-foreground">Preparing statement…</main>
  if (!data.found || !data.breakdown || !data.commission) {
    return (
      <main className="mx-auto max-w-2xl p-10 text-sm text-muted-foreground">
        No incentive activity recorded for this rep in {monthLabel(month)}.
      </main>
    )
  }

  const rates = data.rates ?? {
    new: 0.06, winback: 0.05, recurringFull: 0.04, recurringPartial: 0.03, recurringZero: 0.02, legacyFlat: 0.04,
  }
  const recurringRate = frozen?.recurring_rate ?? data.gate?.recurringRate ?? rates.recurringFull
  // Frozen figures are authoritative for payout; live figures otherwise.
  const totals = frozen
    ? {
        new: frozen.new_commission,
        winback: frozen.winback_commission,
        recurring: frozen.recurring_commission,
        total: frozen.projected_total,
      }
    : {
        new: data.commission.new ?? 0,
        winback: data.commission.winback ?? 0,
        recurring: data.commission.recurring ?? 0,
        total: data.commission.projected ?? 0,
      }

  const rows: Array<[string, number, number, number, number]> = [
    ['New business', data.breakdown.newOrders, data.breakdown.newRevenue, rates.new, totals.new],
    ['Winback', data.breakdown.winbackOrders, data.breakdown.winbackRevenue, rates.winback, totals.winback],
    ['Recurring', data.breakdown.recurringOrders, data.breakdown.recurringRevenue, recurringRate, totals.recurring],
  ]

  return (
    <main className="mx-auto max-w-3xl p-8 print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <p className="text-sm text-muted-foreground">
          Review, then Print / Save as PDF. This statement is not sent to the rep automatically.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
      </div>

      <header className="border-b-2 border-slate-900 pb-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Commission Statement</h1>
            <p className="mt-1 text-sm text-slate-600">MedShip — Q3 New-Customer Incentive Program</p>
          </div>
          <div className="text-right text-sm">
            <p className="text-lg font-semibold">{data.repDisplayName ?? data.rep}</p>
            <p className="text-slate-600">{monthLabel(month)}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2 text-xs">
          {frozen ? (
            <span className="rounded border border-emerald-600 px-2 py-0.5 font-semibold text-emerald-700">
              FROZEN {new Date(frozen.frozen_at).toLocaleDateString('en-US')} — final payout figures
            </span>
          ) : (
            <span className="rounded border border-amber-600 px-2 py-0.5 font-semibold text-amber-700">
              PRELIMINARY — figures move until the month is frozen
            </span>
          )}
          {!data.inPromoPeriod && (
            <span className="rounded border border-slate-400 px-2 py-0.5 text-slate-600">
              Outside promo period — reference only, not payable
            </span>
          )}
        </div>
      </header>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Revenue &amp; Commission</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
              <th className="py-2">Revenue type</th>
              <th className="py-2 text-center">Orders</th>
              <th className="py-2 text-right">Revenue</th>
              <th className="py-2 text-center">Rate</th>
              <th className="py-2 text-right">Commission</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, orders, revenue, rate, commission]) => (
              <tr key={label} className="border-b border-slate-200">
                <td className="py-2">{label}</td>
                <td className="py-2 text-center tabular-nums">{orders}</td>
                <td className="py-2 text-right tabular-nums">{usd(revenue)}</td>
                <td className="py-2 text-center tabular-nums">{pct(rate)}</td>
                <td className="py-2 text-right tabular-nums">{usd(commission)}</td>
              </tr>
            ))}
            {data.breakdown.creditsOrders > 0 && (
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <td className="py-2" colSpan={5}>
                  Includes {data.breakdown.creditsOrders} credit{data.breakdown.creditsOrders === 1 ? '' : 's'} /
                  adjustment{data.breakdown.creditsOrders === 1 ? '' : 's'} totaling {usd(data.breakdown.creditsAmount)},
                  netted into the revenue above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded border border-slate-300 p-4">
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <p>New business ({pct(rates.new)} — first 365 days from enrollment)</p>
          <p className="text-right font-semibold tabular-nums">{usd(totals.new)}</p>
          <p>Winback ({pct(rates.winback)} — first 365 days from re-entry)</p>
          <p className="text-right font-semibold tabular-nums">{usd(totals.winback)}</p>
          <p>
            Recurring at {pct(recurringRate)} —{' '}
            {data.gate?.qualifies
              ? `quota met (${data.gate.enrollments}/${data.gate.threshold} new enrollments)`
              : `quota not met (${data.gate?.enrollments ?? 0}/${data.gate?.threshold ?? 0} new enrollments; full rate is ${pct(rates.recurringFull)})`}
          </p>
          <p className="text-right font-semibold tabular-nums">{usd(totals.recurring)}</p>
          <p className="border-t border-slate-900 pt-2 text-base font-bold">Total commission</p>
          <p className="border-t border-slate-900 pt-2 text-right text-base font-bold tabular-nums">{usd(totals.total)}</p>
        </div>
        {data.modelComparison && (
          <p className="mt-3 text-xs text-slate-600">
            The legacy {pct(rates.legacyFlat)} flat model would have paid {usd(data.modelComparison.oldModelTotal)} —{' '}
            {(data.modelComparison.delta ?? 0) > 0.005
              ? `the tiered model paid ${usd(data.modelComparison.delta ?? 0)} more.`
              : (data.modelComparison.delta ?? 0) < -0.005
                ? `the tiered model paid ${usd(Math.abs(data.modelComparison.delta ?? 0))} less this month because the enrollment quota was missed, reducing the recurring rate.`
                : 'the tiered model paid about the same this month.'}
          </p>
        )}
      </section>

      {narrative && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Month in review</h2>
          <p className="text-sm leading-relaxed text-slate-800">{narrative}</p>
        </section>
      )}

      <footer className="mt-10 border-t border-slate-200 pt-3 text-xs text-slate-400">
        Generated {new Date().toLocaleString('en-US')} · MedShip Prometheus · Figures per the Q3 incentive engine
        {frozen ? ' (frozen payout snapshot)' : ' (live, pre-freeze)'}
      </footer>
    </main>
  )
}
