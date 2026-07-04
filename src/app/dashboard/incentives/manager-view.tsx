'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Settings2 } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PayoutBlockedCard } from '@/components/incentive/PayoutBlockedCard'
import { IncentiveLeaderboard } from '@/components/incentive/IncentiveLeaderboard'
import { GateFeasibilityChart } from '@/components/charts/GateFeasibilityChart'
import { WinBackTracker } from '@/components/incentive/WinBackTracker'
import { ExceptionsPanel } from '@/components/incentive/ExceptionsPanel'
import { NewAccountFeed } from '@/components/incentive/NewAccountFeed'
import { fetchJson } from '@/lib/client-api'
import type { ExceptionsPayload } from '@/lib/incentive/queries'
import type {
  BellLogRow,
  IncentiveSettings,
  OrderIncentiveDetailRow,
  RepIncentiveMonthlyRow,
} from '@/lib/incentive/types'

type IncentiveDashboardResponse = {
  month: string
  settings: IncentiveSettings
  leaderboard: RepIncentiveMonthlyRow[]
  gateTrend: Array<{ weekStart: string; enrollments: number }>
  winBacks: { count: number; revenue: number; orders: OrderIncentiveDetailRow[] }
  exceptions: ExceptionsPayload
  feed: BellLogRow[]
  payoutBlocked: boolean
  blockingUnmappedCount: number
}

function monthLabel(month: string): string {
  return new Date(`${month}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/** Selectable months: one month before the promo through the current month. */
function buildMonthOptions(settings: IncentiveSettings): string[] {
  const start = new Date(`${settings.promoStart.slice(0, 7)}-01T00:00:00Z`)
  start.setUTCMonth(start.getUTCMonth() - 1)
  const now = new Date()
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const end = new Date(`${settings.promoEnd.slice(0, 7)}-01T00:00:00Z`)
  const options: string[] = []
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const key = cursor.toISOString().slice(0, 10)
    options.push(key)
    if (key === currentKey) break
  }
  return options
}

export function ManagerView() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<IncentiveDashboardResponse | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [month, setMonth] = useState<string | null>(null)

  const load = useCallback(async (selectedMonth: string | null) => {
    try {
      setError(null)
      const query = selectedMonth ? `?month=${encodeURIComponent(selectedMonth)}` : ''
      const payload = await fetchJson<IncentiveDashboardResponse>(`/api/dashboard/incentives${query}`)
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incentive dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(month)
  }, [load, month])

  const monthOptions = useMemo(
    () => (data ? buildMonthOptions(data.settings) : []),
    [data]
  )

  const triggerRecompute = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetchJson('/api/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation: 'P8_INCENTIVE_RECOMPUTE' }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger recompute')
    } finally {
      setRefreshing(false)
    }
  }, [])

  return (
    <div className="flex flex-col">
      <Header title="Q3 Incentive" />
      <main className="flex-1 space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Manager View</h2>
            {data && (
              <p className="text-xs text-muted-foreground">
                Promo {data.settings.promoStart} → {data.settings.promoEnd} · gate {data.settings.enrollmentGate}{' '}
                enrollments/month · base {(data.settings.baseRate * 100).toFixed(0)}% + bonus{' '}
                {(data.settings.bonusRate * 100).toFixed(0)}%
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {data && monthOptions.length > 0 && (
              <Select value={data.month} onValueChange={(value) => value && setMonth(value)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {monthLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" onClick={triggerRecompute} disabled={refreshing}>
              <RefreshCw className={refreshing ? 'mr-1.5 h-4 w-4 animate-spin' : 'mr-1.5 h-4 w-4'} />
              Refresh incentive data
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/incentives/admin')}>
              <Settings2 className="mr-1.5 h-4 w-4" /> Admin
            </Button>
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading incentive data…</p>
        ) : data ? (
          <>
            {data.payoutBlocked && <PayoutBlockedCard blockingUnmappedCount={data.blockingUnmappedCount} />}

            <IncentiveLeaderboard rows={data.leaderboard} payoutBlocked={data.payoutBlocked} />

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <GateFeasibilityChart data={data.gateTrend} />
              </div>
              <NewAccountFeed feed={data.feed} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <WinBackTracker count={data.winBacks.count} revenue={data.winBacks.revenue} orders={data.winBacks.orders} />
              <ExceptionsPanel exceptions={data.exceptions} />
            </div>
          </>
        ) : null}
      </main>
    </div>
  )
}
