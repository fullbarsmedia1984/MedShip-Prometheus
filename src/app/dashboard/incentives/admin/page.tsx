'use client'

import { useCallback, useEffect, useState } from 'react'
import { GitMerge, Lock, Settings2, UserCheck } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchJson } from '@/lib/client-api'
import { formatUsd } from '@/lib/incentive/calculator'
import type { IncentiveSettings, MergeCandidateRow, MergeMapRow, PayoutSnapshotRow, PayoutVarianceRow, UnmappedRepRow } from '@/lib/incentive/types'

type AliasesResponse = { unmapped: UnmappedRepRow[]; sfUsers: Array<{ sf_id: string; name: string }> }
type MergeMapResponse = { mappings: MergeMapRow[]; candidates: MergeCandidateRow[] }

type Status = { kind: 'success' | 'error'; message: string } | null

function StatusLine({ status }: { status: Status }) {
  if (!status) return null
  return (
    <p
      className={
        status.kind === 'success'
          ? 'rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700'
          : 'rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700'
      }
    >
      {status.message}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Alias completion
// ---------------------------------------------------------------------------

function AliasSection() {
  const [rows, setRows] = useState<UnmappedRepRow[]>([])
  const [sfUsers, setSfUsers] = useState<Array<{ sf_id: string; name: string }>>([])
  const [drafts, setDrafts] = useState<Record<string, { displayName: string; sfUserId: string }>>({})
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const payload = await fetchJson<AliasesResponse>('/api/dashboard/incentives/aliases')
      setRows(payload.unmapped)
      setSfUsers(payload.sfUsers)
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load aliases' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (alias: string, action: 'assign' | 'house' | 'system') => {
    const draft = drafts[alias] ?? { displayName: '', sfUserId: '' }
    if (action === 'assign' && !draft.displayName.trim()) {
      setStatus({ kind: 'error', message: `Enter a display name before assigning "${alias}"` })
      return
    }
    setBusy(alias)
    try {
      await fetchJson('/api/dashboard/incentives/aliases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fishbowlSalesperson: alias,
          action,
          displayName: draft.displayName.trim() || undefined,
          sfUserId: draft.sfUserId || null,
        }),
      })
      setStatus({ kind: 'success', message: `Mapped "${alias}" (${action}). Recompute triggered.` })
      await load()
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to map alias' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card id="aliases">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-primary/10">
            <UserCheck className="h-4 w-4 text-medship-primary" />
          </span>
          Rep Alias Completion
          <Badge
            variant="outline"
            className={
              rows.length > 0
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
            }
          >
            {rows.length} unmapped
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Payout math is blocked while any string with promo-period orders is unmapped. Assign each Fishbowl
          salesperson string to a rep, or mark it as a house/system identity.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusLine status={status} />
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Every salesperson string is mapped. Payouts are unblocked from the alias side.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fishbowl string</TableHead>
                <TableHead className="text-right">In-period orders</TableHead>
                <TableHead className="text-right">In-period revenue</TableHead>
                <TableHead>Display name</TableHead>
                <TableHead>Salesforce user</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const draft = drafts[row.fishbowl_salesperson] ?? { displayName: '', sfUserId: '' }
                return (
                  <TableRow key={row.fishbowl_salesperson}>
                    <TableCell className="font-mono text-xs">{row.fishbowl_salesperson}</TableCell>
                    <TableCell className="text-right">
                      {row.order_count_in_period}
                      <span className="text-muted-foreground"> / {row.order_count_all_time}</span>
                    </TableCell>
                    <TableCell className="text-right">{formatUsd(row.amount_in_period)}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-40"
                        placeholder="Display name"
                        value={draft.displayName}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [row.fishbowl_salesperson]: { ...draft, displayName: event.target.value },
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={draft.sfUserId || undefined}
                        onValueChange={(value) =>
                          setDrafts((current) => ({
                            ...current,
                            [row.fishbowl_salesperson]: {
                              ...draft,
                              sfUserId: value ?? '',
                              displayName:
                                draft.displayName || sfUsers.find((user) => user.sf_id === value)?.name || '',
                            },
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 w-44">
                          <SelectValue placeholder="Optional SF user" />
                        </SelectTrigger>
                        <SelectContent>
                          {sfUsers.map((user) => (
                            <SelectItem key={user.sf_id} value={user.sf_id}>
                              {user.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          disabled={busy === row.fishbowl_salesperson}
                          onClick={() => act(row.fishbowl_salesperson, 'assign')}
                        >
                          Assign
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === row.fishbowl_salesperson}
                          onClick={() => act(row.fishbowl_salesperson, 'house')}
                        >
                          House
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === row.fishbowl_salesperson}
                          onClick={() => act(row.fishbowl_salesperson, 'system')}
                        >
                          System
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Customer merge map
// ---------------------------------------------------------------------------

function MergeMapSection() {
  const [mappings, setMappings] = useState<MergeMapRow[]>([])
  const [candidates, setCandidates] = useState<MergeCandidateRow[]>([])
  const [form, setForm] = useState({ duplicateKey: '', canonicalKey: '', reason: '' })
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const payload = await fetchJson<MergeMapResponse>('/api/dashboard/incentives/merge-map')
      setMappings(payload.mappings)
      setCandidates(payload.candidates)
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load merge map' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    setBusy(true)
    try {
      await fetchJson('/api/dashboard/incentives/merge-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setStatus({ kind: 'success', message: `Mapped ${form.duplicateKey} → ${form.canonicalKey}. Recompute triggered.` })
      setForm({ duplicateKey: '', canonicalKey: '', reason: '' })
      await load()
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to add mapping' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (duplicateKey: string) => {
    setBusy(true)
    try {
      await fetchJson('/api/dashboard/incentives/merge-map', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicateKey }),
      })
      setStatus({ kind: 'success', message: `Removed mapping for ${duplicateKey}. Recompute triggered.` })
      await load()
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to remove mapping' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card id="merge-map">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-info/10">
            <GitMerge className="h-4 w-4 text-medship-info" />
          </span>
          Customer Merge Map
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Duplicate customer keys resolve to one canonical key so a duplicate record can never mint a false
          &quot;new customer&quot;. Keys use the <code>id:&lt;fishbowl id&gt;</code> /{' '}
          <code>name:&lt;normalized name&gt;</code> format.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <StatusLine status={status} />

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Duplicate key</label>
            <Input
              className="h-8 w-44"
              placeholder="id:3779"
              value={form.duplicateKey}
              onChange={(event) => setForm((current) => ({ ...current, duplicateKey: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Canonical key</label>
            <Input
              className="h-8 w-44"
              placeholder="id:237"
              value={form.canonicalKey}
              onChange={(event) => setForm((current) => ({ ...current, canonicalKey: event.target.value }))}
            />
          </div>
          <div className="grow">
            <label className="text-xs text-muted-foreground">Reason</label>
            <Input
              className="h-8"
              placeholder="Same institution, name variant"
              value={form.reason}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
            />
          </div>
          <Button size="sm" onClick={add} disabled={busy || !form.duplicateKey || !form.canonicalKey}>
            Add mapping
          </Button>
        </div>

        {candidates.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-medium">Suggested candidates ({candidates.length})</h4>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
              {candidates.map((pair) => (
                <li key={`${pair.key_a}|${pair.key_b}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="font-medium">{pair.name_a}</span> ({pair.key_a}, {pair.orders_a} orders) ↔{' '}
                    <span className="font-medium">{pair.name_b}</span> ({pair.key_b}, {pair.orders_b} orders)
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={() => {
                      // Prefill: more orders → canonical
                      const [dup, canon] =
                        pair.orders_a >= pair.orders_b ? [pair.key_b, pair.key_a] : [pair.key_a, pair.key_b]
                      setForm({
                        duplicateKey: dup,
                        canonicalKey: canon,
                        reason: pair.exact_normalized_match ? 'Exact normalized-name match' : 'Similarity candidate',
                      })
                    }}
                  >
                    Prefill
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Duplicate</TableHead>
              <TableHead>Canonical</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>By</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((mapping) => (
              <TableRow key={mapping.duplicate_key}>
                <TableCell className="font-mono text-xs">{mapping.duplicate_key}</TableCell>
                <TableCell className="font-mono text-xs">{mapping.canonical_key}</TableCell>
                <TableCell className="max-w-72 truncate text-xs">{mapping.reason ?? '—'}</TableCell>
                <TableCell className="text-xs">{mapping.created_by ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => remove(mapping.duplicate_key)}>
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Program settings
// ---------------------------------------------------------------------------

function SettingsSection() {
  const [settings, setSettings] = useState<IncentiveSettings | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchJson<{ settings: IncentiveSettings }>('/api/dashboard/incentives/settings')
      .then((payload) => setSettings(payload.settings))
      .catch((err) =>
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load settings' })
      )
  }, [])

  const save = async () => {
    if (!settings) return
    setBusy(true)
    try {
      const payload = await fetchJson<{ settings: IncentiveSettings }>('/api/dashboard/incentives/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      setSettings(payload.settings)
      setStatus({ kind: 'success', message: 'Settings saved. Recompute triggered where needed.' })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to save settings' })
    } finally {
      setBusy(false)
    }
  }

  const field = (
    label: string,
    key: keyof IncentiveSettings,
    props: { type?: string; step?: string } = {}
  ) => (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        className="h-8 w-36"
        type={props.type ?? 'text'}
        step={props.step}
        value={settings ? String(settings[key]) : ''}
        onChange={(event) =>
          setSettings((current) =>
            current
              ? {
                  ...current,
                  [key]:
                    props.type === 'number'
                      ? Number(event.target.value)
                      : event.target.value,
                }
              : current
          )
        }
      />
    </div>
  )

  return (
    <Card id="settings">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-warning/10">
            <Settings2 className="h-4 w-4 text-medship-warning" />
          </span>
          Program Settings
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The enrollment gate is admin-adjustable by design (per Dan). Rate and window changes recompute all
          classifications.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusLine status={status} />
        {settings && (
          <>
            <div className="flex flex-wrap gap-3">
              {field('Promo start (YYYY-MM-DD)', 'promoStart')}
              {field('Promo end (YYYY-MM-DD)', 'promoEnd')}
              {field('Enrollment gate / month', 'enrollmentGate', { type: 'number' })}
              {field('Base rate (0-1)', 'baseRate', { type: 'number', step: '0.01' })}
              {field('Bonus rate (0-1)', 'bonusRate', { type: 'number', step: '0.01' })}
              {field('New-customer window (days)', 'newWindowDays', { type: 'number' })}
              {field('Win-back gap (days)', 'winBackGapDays', { type: 'number' })}
            </div>
            <Button size="sm" onClick={save} disabled={busy}>
              Save settings
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Payout freeze
// ---------------------------------------------------------------------------

type FreezeResponse = { snapshots: PayoutSnapshotRow[]; variance: PayoutVarianceRow[] }

function monthLabel(month: string): string {
  return new Date(`${month}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function PayoutFreezeSection() {
  const [snapshots, setSnapshots] = useState<PayoutSnapshotRow[]>([])
  const [variance, setVariance] = useState<PayoutVarianceRow[]>([])
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const payload = await fetchJson<FreezeResponse>('/api/dashboard/incentives/freeze')
      setSnapshots(payload.snapshots)
      setVariance(payload.variance)
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load payout freezes' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const frozenMonths = [...new Set(snapshots.map((row) => row.month))]
  // Promo months that have ended but are not frozen yet are freezable now.
  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const promoMonths = ['2026-07-01', '2026-08-01', '2026-09-01']
  const freezable = promoMonths.filter((month) => month < currentMonthKey && !frozenMonths.includes(month))

  const freeze = async (month: string) => {
    setBusy(month)
    setStatus(null)
    try {
      await fetchJson('/api/dashboard/incentives/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      })
      setStatus({ kind: 'success', message: `${monthLabel(month)} frozen — finance pays these figures.` })
      await load()
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Freeze failed' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card id="freeze">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Lock className="h-4 w-4" />
          Payout Freeze
          <Badge variant="outline">auto-freezes 7 days after month end</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Finance pays from frozen snapshots, never live numbers. Freezing fails while any rep is
          payout-blocked by unmapped salespersons. Later data changes appear as variance — they never
          restate paid figures.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <StatusLine status={status} />
        {freezable.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {freezable.map((month) => (
              <Button key={month} size="sm" onClick={() => freeze(month)} disabled={busy !== null}>
                <Lock className="h-4 w-4" />
                {busy === month ? 'Freezing…' : `Freeze ${monthLabel(month)}`}
              </Button>
            ))}
          </div>
        )}
        {snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No months frozen yet. July freezes automatically around August 8, or freeze it manually
            here once the month closes.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Month</TableHead>
                <TableHead>Rep</TableHead>
                <TableHead className="text-center">Enrollments</TableHead>
                <TableHead className="text-center">Qualified</TableHead>
                <TableHead className="text-right">Frozen payout</TableHead>
                <TableHead className="text-right">Live now</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshots.map((row) => {
                const varianceRow = variance.find((v) => v.month === row.month && v.rep_key === row.rep_key)
                const delta = varianceRow?.variance ?? 0
                return (
                  <TableRow key={`${row.month}-${row.rep_key}`}>
                    <TableCell className="whitespace-nowrap">
                      {monthLabel(row.month)}
                      <p className="text-xs text-muted-foreground">
                        frozen {new Date(row.frozen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {row.frozen_by ? ` · ${row.frozen_by}` : ''}
                      </p>
                    </TableCell>
                    <TableCell className="font-medium">{row.rep_display_name ?? row.rep_key}</TableCell>
                    <TableCell className="text-center tabular-nums">
                      {row.enrollments} / {row.enrollment_gate}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.qualifies ? (
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">Yes</Badge>
                      ) : (
                        <Badge variant="outline">No</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatUsd(row.projected_total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{varianceRow ? formatUsd(varianceRow.live_total) : '—'}</TableCell>
                    <TableCell className={`text-right font-medium tabular-nums ${Math.abs(delta) > 0.005 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                      {Math.abs(delta) > 0.005 ? `${delta > 0 ? '+' : ''}${formatUsd(delta)}` : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export default function IncentiveAdminPage() {
  return (
    <div className="flex flex-col">
      <Header title="Q3 Incentive — Admin" />
      <main className="flex-1 space-y-6 p-4 md:p-6">
        <AliasSection />
        <MergeMapSection />
        <SettingsSection />
        <PayoutFreezeSection />
      </main>
    </div>
  )
}
