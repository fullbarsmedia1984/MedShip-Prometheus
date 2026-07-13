'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import type {
  KitWorkbench,
  KitRow,
  KitUrgency,
  KitKpis,
} from '@/lib/kits/data'
import type { KitImportPreview } from '@/lib/kits/import'

const URGENCY_META: Record<
  KitUrgency,
  { label: string; cls: string; rank: number }
> = {
  overdue: { label: 'OVERDUE', cls: 'bg-red-100 text-red-700 border-red-300', rank: 0 },
  due_today: { label: 'DUE TODAY', cls: 'bg-orange-100 text-orange-700 border-orange-300', rank: 1 },
  this_week: { label: 'THIS WEEK', cls: 'bg-amber-100 text-amber-700 border-amber-300', rank: 2 },
  no_dates: { label: 'NEEDS DATES', cls: 'bg-slate-100 text-slate-600 border-slate-300', rank: 3 },
  on_track: { label: 'ON TRACK', cls: 'bg-sky-100 text-sky-700 border-sky-300', rank: 4 },
  shipped: { label: 'SHIPPED', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300', rank: 5 },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.slice(0, 10) + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
}

export function KitsWorkbench({
  initial,
  kpis,
  canImport,
}: {
  initial: KitWorkbench
  kpis: KitKpis
  canImport: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'workbench' | 'performance' | 'backorders'>(
    'workbench'
  )
  const [rows, setRows] = useState<KitRow[]>(initial.rows)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showShipped, setShowShipped] = useState(false)
  const [filter, setFilter] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importCsv, setImportCsv] = useState('')
  const [importResult, setImportResult] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<KitImportPreview | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [savingSo, setSavingSo] = useState<string | null>(null)

  // keep server-refreshed data flowing in
  useEffect(() => setRows(initial.rows), [initial.generatedAt, initial.rows])

  const visible = rows.filter(
    (r) =>
      (showShipped || r.status !== 'shipped') &&
      (!filter ||
        r.soNumber.toLowerCase().includes(filter.toLowerCase()) ||
        r.school.toLowerCase().includes(filter.toLowerCase()))
  )

  async function patch(soNumber: string, body: Record<string, unknown>) {
    setSavingSo(soNumber)
    // optimistic ops update
    setRows((prev) =>
      prev.map((r) =>
        r.soNumber === soNumber ? { ...r, ops: { ...r.ops, ...body } } : r
      )
    )
    try {
      const res = await fetch(`/api/kits/${encodeURIComponent(soNumber)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) router.refresh() // recompute ship windows / urgency server-side
    } finally {
      setSavingSo(null)
    }
  }

  async function runImport(mode: 'preview' | 'commit') {
    setImportBusy(true)
    setImportResult(mode === 'preview' ? 'Checking workbook…' : 'Applying reviewed changes…')
    try {
      const res = await fetch('/api/kits/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: importCsv,
          mode,
          confirmDigest: mode === 'commit' ? importPreview?.digest : undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (data?.preview) setImportPreview(data.preview as KitImportPreview)
      if (!res.ok) {
        setImportResult(`Failed: ${data?.error ?? res.status}`)
        return
      }
      if (mode === 'preview') {
        const summary = (data.preview as KitImportPreview).summary
        setImportResult(
          `Preview ready: ${summary.changes} change${summary.changes === 1 ? '' : 's'}; nothing has been written.`
        )
        return
      }
      setImportResult(
        `Applied ${data.applied} reviewed change${data.applied === 1 ? '' : 's'}.` +
          (data.auditLogged ? '' : ' Changes applied, but the audit log needs attention.')
      )
      router.refresh()
    } finally {
      setImportBusy(false)
    }
  }

  const t = initial.totals

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Kit Assembly</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Canonical kit workbench — live from Fishbowl, ops fields owned here.
            Ship-by = need-by minus transit (workdays).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter SO / school…"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            data-testid="kits-filter"
          />
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showShipped}
              onChange={(e) => setShowShipped(e.target.checked)}
            />
            shipped
          </label>
          {canImport && (
            <button
              onClick={() => setImportOpen(true)}
              className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              data-testid="kits-import-open"
            >
              Import workbook
            </button>
          )}
        </div>
      </div>

      {/* tabs */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {(
          [
            ['workbench', 'Workbench'],
            ['performance', `Performance · ${kpis.windowDays}d`],
            ['backorders', 'Backorders'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            data-testid={`kits-tab-${key}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'performance' && <PerformanceTab kpis={kpis} />}
      {tab === 'backorders' && <BackordersTab rows={rows} />}

      {/* totals */}
      <div className={`mb-4 flex flex-wrap gap-2 ${tab !== 'workbench' ? 'hidden' : ''}`}>
        {[
          { label: 'Open kits', value: t.open, cls: 'text-foreground' },
          { label: 'Needs dates', value: t.needsDates, cls: t.needsDates ? 'text-slate-600' : 'text-muted-foreground' },
          { label: 'Overdue', value: t.overdue, cls: t.overdue ? 'text-red-600' : 'text-muted-foreground' },
          { label: 'Due ≤5 workdays', value: t.dueThisWeek, cls: t.dueThisWeek ? 'text-amber-600' : 'text-muted-foreground' },
          { label: 'Backorder · no PO', value: t.backorderNoPo, cls: t.backorderNoPo ? 'text-red-600' : 'text-muted-foreground' },
          { label: 'Shipped 30d', value: t.shipped30d, cls: 'text-emerald-600' },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-border bg-card px-3 py-2"
          >
            <p className={`text-xl font-semibold leading-none ${s.cls}`}>{s.value}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      <div
        className={`overflow-x-auto rounded-lg border border-border ${
          tab !== 'workbench' ? 'hidden' : ''
        }`}
      >
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Order #</th>
              <th className="px-3 py-2">School</th>
              <th className="px-2 py-2">Rep</th>
              <th className="px-2 py-2 text-right">Kits</th>
              <th className="px-2 py-2 text-right">Lines</th>
              <th className="px-2 py-2">Picked</th>
              <th className="px-2 py-2">Need-by (E)</th>
              <th className="px-2 py-2">Need-by (A)</th>
              <th className="px-2 py-2 text-right">Transit</th>
              <th className="px-2 py-2">Ship window</th>
              <th className="px-2 py-2">Table</th>
              <th className="px-2 py-2 text-center">Kit list</th>
              <th className="px-2 py-2">Sub kits</th>
              <th className="px-2 py-2">Backorders</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const u = URGENCY_META[r.urgency]
              const isOpen = expanded === r.soNumber
              return (
                <FragmentRow
                  key={r.soNumber}
                  r={r}
                  u={u}
                  isOpen={isOpen}
                  saving={savingSo === r.soNumber}
                  onToggle={() => setExpanded(isOpen ? null : r.soNumber)}
                  onPatch={patch}
                />
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={15} className="px-3 py-8 text-center text-muted-foreground">
                  No kit orders match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* import dialog */}
      <AnimatePresence>
        {importOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setImportOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              className="fixed inset-x-0 top-[12vh] z-50 mx-auto w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-2xl"
              data-testid="kits-import-dialog"
            >
              <h2 className="text-lg font-semibold">Import Nursing Kit Report</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Paste a CSV export or copied Excel table. Preview is required and
                automatically excludes closed/shipped history. Recognized columns: Order#,
                Earliest/Absolute Need By, Days for Transit, Rep, Table Location,
                and the exact Notes column. Blank cells preserve existing Zeus data;
                Fishbowl facts stay live.
              </p>
              <textarea
                value={importCsv}
                onChange={(e) => {
                  setImportCsv(e.target.value)
                  setImportPreview(null)
                  setImportResult(null)
                }}
                rows={10}
                placeholder="PO Received,Earliest Need By,Absolute Need By,Status,Order#,School Name,REP,KITS,..."
                className="mt-3 w-full rounded-md border border-border bg-background p-2 font-mono text-xs outline-none focus:border-primary"
                data-testid="kits-import-csv"
              />
              {importResult && (
                <p className="mt-2 text-sm text-muted-foreground">{importResult}</p>
              )}
              {importPreview && (
                <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <p><span className="font-semibold">{importPreview.summary.eligible}</span> eligible</p>
                    <p><span className="font-semibold">{importPreview.summary.inserts}</span> new</p>
                    <p><span className="font-semibold">{importPreview.summary.updates}</span> updates</p>
                    <p><span className="font-semibold">{importPreview.summary.unchanged}</span> unchanged</p>
                    <p><span className="font-semibold">{importPreview.summary.needsDates}</span> need dates</p>
                    <p><span className="font-semibold">{importPreview.summary.estimates}</span> estimates</p>
                    <p><span className="font-semibold">{importPreview.summary.skippedIneligible}</span> historical</p>
                    <p><span className="font-semibold">{importPreview.summary.skippedNotFound}</span> not found</p>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Notes mapping: {importPreview.recognizedColumns.notes ?? 'not present; existing notes preserved'}
                  </p>
                  {importPreview.blockingErrors.length > 0 && (
                    <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
                      <p className="font-semibold">
                        Fix {importPreview.blockingErrors.length} validation error{importPreview.blockingErrors.length === 1 ? '' : 's'} before applying:
                      </p>
                      <ul className="mt-1 list-disc pl-4">
                        {importPreview.blockingErrors.slice(0, 6).map((error, index) => (
                          <li key={`${error.row}-${error.field}-${index}`}>
                            Row {error.row}{error.soNumber ? ` (${error.soNumber})` : ''}: {error.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {importPreview.summary.skippedNotFound > 0 && (
                    <p className="mt-2 text-xs text-amber-700">
                      Not found: {importPreview.skipped
                        .filter((row) => row.reason === 'not_found')
                        .map((row) => row.soNumber)
                        .join(', ')}
                    </p>
                  )}
                </div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setImportOpen(false)}
                  className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted"
                >
                  Close
                </button>
                <button
                  onClick={() => void runImport('preview')}
                  disabled={!importCsv.trim() || importBusy}
                  className="h-9 rounded-md border border-primary px-4 text-sm font-medium text-primary disabled:opacity-50"
                  data-testid="kits-import-run"
                >
                  {importBusy && !importPreview ? 'Checking…' : 'Preview'}
                </button>
                {importPreview && (
                  <button
                    onClick={() => void runImport('commit')}
                    disabled={
                      importBusy ||
                      importPreview.blockingErrors.length > 0 ||
                      importPreview.summary.changes === 0
                    }
                    className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    data-testid="kits-import-apply"
                  >
                    Apply {importPreview.summary.changes} change{importPreview.summary.changes === 1 ? '' : 's'}
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function PerformanceTab({ kpis }: { kpis: KitKpis }) {
  const groupTable = (title: string, groups: KitKpis['byRep']) => (
    <div className="rounded-lg border border-border">
      <p className="border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-1.5">Group</th>
            <th className="px-3 py-1.5 text-right">Shipped</th>
            <th className="px-3 py-1.5 text-right">On-time</th>
            <th className="px-3 py-1.5 text-right">Median turn</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-b border-border/50">
              <td className="max-w-[220px] truncate px-3 py-1.5" title={g.key}>
                {g.key}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">{g.shipped}</td>
              <td className="px-3 py-1.5 text-right font-mono">
                {g.onTimePct !== null ? (
                  <span
                    className={
                      g.onTimePct >= 90
                        ? 'text-emerald-600'
                        : g.onTimePct >= 70
                          ? 'text-amber-600'
                          : 'text-red-600'
                    }
                  >
                    {g.onTimePct}%{' '}
                    <span className="text-muted-foreground">({g.onTimeKnown})</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">no dates</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">
                {g.medianTurnDays !== null ? `${g.medianTurnDays} wd` : '—'}
              </td>
            </tr>
          ))}
          {groups.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                No shipped kits in window.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="mb-6" data-testid="kits-performance">
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { label: `Shipped · ${kpis.windowDays}d`, value: String(kpis.shipped), cls: 'text-foreground' },
          {
            label: `On-time (${kpis.onTimeKnown} with dates)`,
            value: kpis.onTimePct !== null ? `${kpis.onTimePct}%` : '—',
            cls:
              kpis.onTimePct === null
                ? 'text-muted-foreground'
                : kpis.onTimePct >= 90
                  ? 'text-emerald-600'
                  : kpis.onTimePct >= 70
                    ? 'text-amber-600'
                    : 'text-red-600',
          },
          {
            label: 'Median turn (workdays)',
            value: kpis.medianTurnDays !== null ? String(kpis.medianTurnDays) : '—',
            cls: 'text-foreground',
          },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card px-3 py-2">
            <p className={`text-xl font-semibold leading-none ${s.cls}`}>{s.value}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {s.label}
            </p>
          </div>
        ))}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        On-time is measurable only for kits whose need-by dates were entered —
        coverage grows as the team fills dates in. Turn time = workdays from PO
        received to shipped.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {groupTable('By rep', kpis.byRep)}
        {groupTable('By school (top 10)', kpis.bySchool)}
      </div>
    </div>
  )
}

function BackordersTab({ rows }: { rows: KitRow[] }) {
  type Agg = {
    part: string
    desc: string | null
    totalShort: number
    kits: { so: string; short: number }[]
    onOrder: boolean
    eta: string | null
  }
  const byPart = new Map<string, Agg>()
  for (const r of rows) {
    if (r.status === 'shipped') continue
    for (const b of r.backorders) {
      const agg =
        byPart.get(b.part) ??
        byPart
          .set(b.part, {
            part: b.part,
            desc: b.desc,
            totalShort: 0,
            kits: [],
            onOrder: b.onOrder,
            eta: b.eta,
          })
          .get(b.part)!
      agg.totalShort += b.short
      const existing = agg.kits.find((k) => k.so === r.soNumber)
      if (existing) existing.short += b.short
      else agg.kits.push({ so: r.soNumber, short: b.short })
    }
  }
  const aggs = [...byPart.values()].sort(
    (a, b) =>
      Number(a.onOrder) - Number(b.onOrder) || b.totalShort - a.totalShort
  )
  const noPo = aggs.filter((a) => !a.onOrder).length

  return (
    <div className="mb-6" data-testid="kits-backorders">
      <p className="mb-3 text-sm text-muted-foreground">
        Every part short across open kit orders, live from inventory and open
        POs — this view replaces the Backorder Report workbook.{' '}
        <span className={noPo > 0 ? 'font-semibold text-red-600' : ''}>
          {noPo} part{noPo === 1 ? '' : 's'} short with NO PO.
        </span>
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Total short</th>
              <th className="px-3 py-2">Kits affected</th>
              <th className="px-3 py-2">PO coverage</th>
            </tr>
          </thead>
          <tbody>
            {aggs.map((a) => (
              <tr key={a.part} className="border-b border-border/50 align-top">
                <td className="px-3 py-1.5 font-mono font-semibold">{a.part}</td>
                <td className="max-w-[320px] truncate px-3 py-1.5 text-muted-foreground" title={a.desc ?? ''}>
                  {a.desc ?? '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{a.totalShort}</td>
                <td className="px-3 py-1.5">
                  <span className="font-mono text-xs">
                    {a.kits
                      .slice(0, 4)
                      .map((k) => k.so)
                      .join(', ')}
                    {a.kits.length > 4 ? ` +${a.kits.length - 4}` : ''}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${
                      a.onOrder
                        ? 'border-amber-300 bg-amber-100 text-amber-700'
                        : 'border-red-300 bg-red-100 text-red-700'
                    }`}
                  >
                    {a.onOrder
                      ? `PO · eta ${a.eta ? fmtDate(a.eta) : 'unknown'}`
                      : 'NO PO'}
                  </span>
                </td>
              </tr>
            ))}
            {aggs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No shortages across open kit orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FragmentRow({
  r,
  u,
  isOpen,
  saving,
  onToggle,
  onPatch,
}: {
  r: KitRow
  u: { label: string; cls: string }
  isOpen: boolean
  saving: boolean
  onToggle: () => void
  onPatch: (so: string, body: Record<string, unknown>) => Promise<void>
}) {
  const shipped = r.status === 'shipped'
  return (
    <>
      <tr
        className={`border-b border-border/60 align-middle transition-colors hover:bg-muted/40 ${
          isOpen ? 'bg-muted/30' : ''
        }`}
        data-testid={`kit-row-${r.soNumber}`}
      >
        <td className="px-3 py-1.5">
          <span
            className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${u.cls}`}
          >
            {u.label}
          </span>
        </td>
        <td className="px-3 py-1.5">
          <button
            onClick={onToggle}
            className="font-mono font-semibold text-primary hover:underline"
            data-testid={`kit-expand-${r.soNumber}`}
          >
            {r.soNumber}
          </button>
          {saving && <span className="ml-1 text-xs text-muted-foreground">…</span>}
        </td>
        <td className="max-w-[220px] truncate px-3 py-1.5" title={r.school}>
          {r.school}
        </td>
        <td className="px-2 py-1.5">
          <input
            defaultValue={r.ops.rep ?? ''}
            onBlur={(e) => {
              if (e.target.value !== (r.ops.rep ?? ''))
                void onPatch(r.soNumber, { rep: e.target.value || null })
            }}
            className="w-12 rounded border border-transparent bg-transparent px-1 py-0.5 text-center font-mono uppercase hover:border-border focus:border-primary focus:outline-none"
            data-testid={`kit-rep-${r.soNumber}`}
          />
        </td>
        <td className="px-2 py-1.5 text-right font-mono">{r.kits || '—'}</td>
        <td className="px-2 py-1.5 text-right font-mono">{r.lineItems}</td>
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-16 overflow-hidden rounded bg-muted">
              <div
                className={`h-full rounded ${
                  r.pct >= 100 ? 'bg-emerald-500' : r.pct > 0 ? 'bg-amber-500' : 'bg-slate-300'
                }`}
                style={{ width: `${r.pct}%` }}
              />
            </div>
            <span className="font-mono text-xs text-muted-foreground">{r.pct}%</span>
          </div>
        </td>
        <td className="px-2 py-1.5">
          <input
            type="date"
            defaultValue={r.ops.earliest_need_by ?? ''}
            onChange={(e) =>
              void onPatch(r.soNumber, { earliest_need_by: e.target.value || null })
            }
            className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-border focus:border-primary focus:outline-none"
            data-testid={`kit-eneedby-${r.soNumber}`}
          />
        </td>
        <td className="px-2 py-1.5">
          <input
            type="date"
            defaultValue={r.ops.absolute_need_by ?? ''}
            onChange={(e) =>
              void onPatch(r.soNumber, { absolute_need_by: e.target.value || null })
            }
            className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-border focus:border-primary focus:outline-none"
            data-testid={`kit-aneedby-${r.soNumber}`}
          />
        </td>
        <td className="px-2 py-1.5 text-right">
          <input
            type="number"
            min={0}
            max={30}
            defaultValue={r.ops.transit_days ?? ''}
            onBlur={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value)
              if (v !== r.ops.transit_days)
                void onPatch(r.soNumber, { transit_days: v })
            }}
            className="w-12 rounded border border-transparent bg-transparent px-1 py-0.5 text-right font-mono text-xs hover:border-border focus:border-primary focus:outline-none"
            data-testid={`kit-transit-${r.soNumber}`}
          />
        </td>
        <td className="px-2 py-1.5 font-mono text-xs">
          {r.latestShipBy ? (
            <span
              className={
                r.urgency === 'overdue'
                  ? 'font-bold text-red-600'
                  : r.urgency === 'due_today' || r.urgency === 'this_week'
                    ? 'font-bold text-amber-600'
                    : ''
              }
            >
              {fmtDate(r.earliestShipBy)}–{fmtDate(r.latestShipBy)}
            </span>
          ) : shipped ? (
            <span className="text-muted-foreground">
              {r.onTime === null ? 'shipped' : r.onTime ? 'on time' : 'late'}{' '}
              {fmtDate(r.shippedAt)}
              {r.turnTimeDays !== null ? ` · ${r.turnTimeDays}wd` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">set dates →</span>
          )}
        </td>
        <td className="px-2 py-1.5">
          <input
            defaultValue={r.ops.table_location ?? ''}
            onBlur={(e) => {
              if (e.target.value !== (r.ops.table_location ?? ''))
                void onPatch(r.soNumber, { table_location: e.target.value || null })
            }}
            className="w-14 rounded border border-transparent bg-transparent px-1 py-0.5 text-center font-mono text-xs hover:border-border focus:border-primary focus:outline-none"
            data-testid={`kit-table-${r.soNumber}`}
          />
        </td>
        <td className="px-2 py-1.5 text-center">
          <input
            type="checkbox"
            checked={r.ops.kit_list_printed}
            onChange={(e) =>
              void onPatch(r.soNumber, { kit_list_printed: e.target.checked })
            }
            data-testid={`kit-printed-${r.soNumber}`}
          />
        </td>
        <td className="px-2 py-1.5">
          <select
            value={r.ops.sub_kit_status ?? ''}
            onChange={(e) =>
              void onPatch(r.soNumber, { sub_kit_status: e.target.value || null })
            }
            className="rounded border border-transparent bg-transparent py-0.5 text-xs hover:border-border focus:border-primary focus:outline-none"
            data-testid={`kit-subkit-${r.soNumber}`}
          >
            <option value="">—</option>
            <option value="received">Received</option>
            <option value="pack_as_needed">Pack as needed</option>
          </select>
        </td>
        <td className="px-2 py-1.5">
          {r.backorders.length > 0 ? (
            <button
              onClick={onToggle}
              className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${
                r.backordersNoPo > 0
                  ? 'border-red-300 bg-red-100 text-red-700'
                  : 'border-amber-300 bg-amber-100 text-amber-700'
              }`}
              data-testid={`kit-bo-${r.soNumber}`}
            >
              {r.backorders.length}
              {r.backordersNoPo > 0 ? ` · ${r.backordersNoPo} no PO` : ' on order'}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {shipped ? '—' : 'clear'}
            </span>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-border bg-muted/20">
          <td colSpan={15} className="px-6 py-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Backordered lines (live: short vs on-hand, PO coverage)
                </p>
                {r.backorders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    All lines coverable from stock.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {r.backorders.map((b, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 rounded border border-border bg-card px-2 py-1 text-xs"
                      >
                        <span className="font-mono font-semibold">{b.part}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {b.desc ?? ''}
                        </span>
                        <span className="font-mono">short {b.short}</span>
                        <span
                          className={`rounded px-1 py-0.5 font-bold ${
                            b.onOrder
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {b.onOrder ? `PO · ${fmtDate(b.eta)}` : 'NO PO'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Notes · PO received {fmtDate(r.poReceived)} · {r.units} units
                </p>
                <textarea
                  defaultValue={r.ops.notes ?? ''}
                  onBlur={(e) => {
                    if (e.target.value !== (r.ops.notes ?? ''))
                      void onPatch(r.soNumber, { notes: e.target.value || null })
                  }}
                  rows={3}
                  placeholder="Substitutions, packing notes…"
                  className="w-full rounded-md border border-border bg-card p-2 text-sm outline-none focus:border-primary"
                  data-testid={`kit-notes-${r.soNumber}`}
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
