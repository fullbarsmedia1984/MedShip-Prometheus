'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import type {
  KitWorkbench,
  KitRow,
  KitUrgency,
} from '@/lib/kits/data'

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
  canImport,
}: {
  initial: KitWorkbench
  canImport: boolean
}) {
  const router = useRouter()
  const [rows, setRows] = useState<KitRow[]>(initial.rows)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showShipped, setShowShipped] = useState(false)
  const [filter, setFilter] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importCsv, setImportCsv] = useState('')
  const [importResult, setImportResult] = useState<string | null>(null)
  const [savingSo, setSavingSo] = useState<string | null>(null)

  // keep server-refreshed data flowing in
  useMemo(() => setRows(initial.rows), [initial.generatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function runImport() {
    setImportResult('Importing…')
    const res = await fetch('/api/kits/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: importCsv }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setImportResult(`Failed: ${data?.error ?? res.status}`)
      return
    }
    setImportResult(
      `Imported ${data.imported} kit orders.` +
        (data.skipped?.length
          ? ` Skipped (not found in Fishbowl cache): ${data.skipped.join(', ')}`
          : '')
    )
    router.refresh()
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

      {/* totals */}
      <div className="mb-4 flex flex-wrap gap-2">
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

      <div className="overflow-x-auto rounded-lg border border-border">
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
                In Excel: select the live report sheet → File → Save As → CSV, or
                copy the table and paste here. Recognized columns: Order#,
                Earliest/Absolute Need By, Days for Transit, Rep, Table Location,
                Notes. Only ops fields are imported — Fishbowl facts stay live.
              </p>
              <textarea
                value={importCsv}
                onChange={(e) => setImportCsv(e.target.value)}
                rows={10}
                placeholder="PO Received,Earliest Need By,Absolute Need By,Status,Order#,School Name,REP,KITS,..."
                className="mt-3 w-full rounded-md border border-border bg-background p-2 font-mono text-xs outline-none focus:border-primary"
                data-testid="kits-import-csv"
              />
              {importResult && (
                <p className="mt-2 text-sm text-muted-foreground">{importResult}</p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setImportOpen(false)}
                  className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted"
                >
                  Close
                </button>
                <button
                  onClick={() => void runImport()}
                  disabled={!importCsv.trim()}
                  className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  data-testid="kits-import-run"
                >
                  Import
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
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
