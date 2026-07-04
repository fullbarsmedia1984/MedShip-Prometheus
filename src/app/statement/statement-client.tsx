'use client'

import { useCallback, useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { fetchJson } from '@/lib/client-api'

type ScorecardPayload = {
  rep: string
  repDisplayName?: string | null
  month: string
  found: boolean
  gate?: { enrollments: number; threshold: number; qualifies: boolean }
  commission?: { base: number | null; bonus: number | null; projected: number | null }
  breakdown?: {
    newWindowRevenue: number
    newWindowOrders: number
    winBackRevenue: number
    winBackOrders: number
    recurringRevenue: number
    recurringOrders: number
    creditsAmount: number
    creditsOrders: number
  }
  modelComparison?: { oldModelTotal: number; newModelTotal: number | null; delta: number | null }
  baseRate?: number
  bonusRate?: number
  inPromoPeriod: boolean
  payoutBlocked: boolean
}

type FreezePayload = {
  snapshots: Array<{
    month: string
    rep_key: string
    enrollments: number
    qualifies: boolean
    base_commission: number
    bonus_commission: number
    projected_total: number
    frozen_at: string
    frozen_by: string | null
  }>
}

type ExplainPayload = { found: boolean; explanation?: { text: string } }

function usd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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

  const baseRate = data.baseRate ?? 0.04
  const bonusRate = data.bonusRate ?? 0.02
  // Frozen figures are authoritative for payout; live figures otherwise.
  const totals = frozen
    ? { base: frozen.base_commission, bonus: frozen.bonus_commission, total: frozen.projected_total }
    : {
        base: data.commission.base ?? 0,
        bonus: data.commission.bonus ?? 0,
        total: data.commission.projected ?? 0,
      }

  const rows: Array<[string, number, number]> = [
    ['New business', data.breakdown.newWindowOrders, data.breakdown.newWindowRevenue],
    ['Winback', data.breakdown.winBackOrders, data.breakdown.winBackRevenue],
    ['Recurring', data.breakdown.recurringOrders, data.breakdown.recurringRevenue],
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
              <th className="py-2 text-right">Base ({(baseRate * 100).toFixed(0)}%)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, orders, revenue]) => (
              <tr key={label} className="border-b border-slate-200">
                <td className="py-2">{label}</td>
                <td className="py-2 text-center tabular-nums">{orders}</td>
                <td className="py-2 text-right tabular-nums">{usd(revenue)}</td>
                <td className="py-2 text-right tabular-nums">{usd(revenue * baseRate)}</td>
              </tr>
            ))}
            {data.breakdown.creditsOrders > 0 && (
              <tr className="border-b border-slate-200 text-red-700">
                <td className="py-2">Credits / adjustments</td>
                <td className="py-2 text-center tabular-nums">{data.breakdown.creditsOrders}</td>
                <td className="py-2 text-right tabular-nums">{usd(data.breakdown.creditsAmount)}</td>
                <td className="py-2 text-right tabular-nums">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded border border-slate-300 p-4">
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <p>Base commission ({(baseRate * 100).toFixed(0)}% of attributed revenue)</p>
          <p className="text-right font-semibold tabular-nums">{usd(totals.base)}</p>
          <p>
            New-customer bonus ({(bonusRate * 100).toFixed(0)}%) —{' '}
            {data.gate?.qualifies
              ? `gate met (${data.gate.enrollments}/${data.gate.threshold} enrollments)`
              : `gate not met (${data.gate?.enrollments ?? 0}/${data.gate?.threshold ?? 0} enrollments)`}
          </p>
          <p className="text-right font-semibold tabular-nums">{usd(totals.bonus)}</p>
          <p className="border-t border-slate-900 pt-2 text-base font-bold">Total commission</p>
          <p className="border-t border-slate-900 pt-2 text-right text-base font-bold tabular-nums">{usd(totals.total)}</p>
        </div>
        {data.modelComparison && (
          <p className="mt-3 text-xs text-slate-600">
            Legacy 4% flat model would have paid {usd(data.modelComparison.oldModelTotal)} — the new model
            {(data.modelComparison.delta ?? 0) > 0.005
              ? ` paid ${usd(data.modelComparison.delta ?? 0)} more.`
              : ' pays the same base; the bonus is upside for new-customer enrollments.'}
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
