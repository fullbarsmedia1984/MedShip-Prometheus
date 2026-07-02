'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchJson } from '@/lib/client-api'
import { cn } from '@/lib/utils'
import type { PackingRules } from '@/lib/packing-engine'
import { formatDims } from './estimator-types'

// -----------------------------------------------------------------------------
// Boxes tab
// -----------------------------------------------------------------------------

type AdminBox = {
  id: string
  name: string
  innerLengthIn: number
  innerWidthIn: number
  innerHeightIn: number
  outerLengthIn: number
  outerWidthIn: number
  outerHeightIn: number
  boxWeightLb: number
  maxContentWeightLb: number
  active: boolean
}

type BoxForm = {
  name: string
  inner: [string, string, string]
  outer: [string, string, string]
  boxWeightLb: string
  maxContentWeightLb: string
}

const EMPTY_BOX_FORM: BoxForm = {
  name: '',
  inner: ['', '', ''],
  outer: ['', '', ''],
  boxWeightLb: '',
  maxContentWeightLb: '50',
}

function BoxesTab() {
  const [boxes, setBoxes] = useState<AdminBox[] | null>(null)
  const [form, setForm] = useState<BoxForm>(EMPTY_BOX_FORM)
  const [saving, setSaving] = useState(false)

  const load = () => {
    fetchJson<{ boxes: AdminBox[] }>('/api/estimator/boxes')
      .then(({ boxes }) => setBoxes(boxes))
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'Failed to load boxes')
        setBoxes([])
      })
  }

  useEffect(load, [])

  const addBox = async () => {
    const inner = form.inner.map(Number)
    const outerRaw = form.outer.map((v, i) => (v.trim() === '' ? inner[i] + 0.5 : Number(v)))
    if (!form.name.trim() || inner.some((n) => !Number.isFinite(n) || n <= 0)) {
      toast.error('Provide a name and positive inner dimensions.')
      return
    }
    setSaving(true)
    try {
      await fetchJson('/api/estimator/boxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          inner_length_in: inner[0],
          inner_width_in: inner[1],
          inner_height_in: inner[2],
          outer_length_in: outerRaw[0],
          outer_width_in: outerRaw[1],
          outer_height_in: outerRaw[2],
          box_weight_lb: Number(form.boxWeightLb) || 0,
          max_content_weight_lb: Number(form.maxContentWeightLb) || 50,
          active: true,
        }),
      })
      toast.success('Box saved')
      setForm(EMPTY_BOX_FORM)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save box')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (box: AdminBox) => {
    try {
      await fetchJson(`/api/estimator/boxes/${box.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !box.active }),
      })
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update box')
    }
  }

  const remove = async (box: AdminBox) => {
    if (!window.confirm(`Delete ${box.name}? Existing estimates keep their snapshots.`)) return
    try {
      await fetchJson(`/api/estimator/boxes/${box.id}`, { method: 'DELETE' })
      toast.success('Box deleted')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete box')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-medship-heading dark:text-white">
            Add a standard box
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="w-40 space-y-1">
            <span className="text-[0.7rem] font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
              Name
            </span>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Box 18x16x16"
            />
          </label>
          {(['inner', 'outer'] as const).map((side) => (
            <div key={side} className="space-y-1">
              <span className="text-[0.7rem] font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
                {side} L×W×H (in{side === 'outer' ? ', optional' : ''})
              </span>
              <div className="flex gap-1.5">
                {form[side].map((value, i) => (
                  <Input
                    key={i}
                    className="w-16"
                    inputMode="decimal"
                    value={value}
                    placeholder={['L', 'W', 'H'][i]}
                    onChange={(e) => {
                      const next = [...form[side]] as BoxForm['inner']
                      next[i] = e.target.value
                      setForm({ ...form, [side]: next })
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <label className="w-24 space-y-1">
            <span className="text-[0.7rem] font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
              Tare (lb)
            </span>
            <Input
              inputMode="decimal"
              value={form.boxWeightLb}
              onChange={(e) => setForm({ ...form, boxWeightLb: e.target.value })}
            />
          </label>
          <label className="w-24 space-y-1">
            <span className="text-[0.7rem] font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
              Max (lb)
            </span>
            <Input
              inputMode="decimal"
              value={form.maxContentWeightLb}
              onChange={(e) => setForm({ ...form, maxContentWeightLb: e.target.value })}
            />
          </label>
          <Button
            type="button"
            onClick={addBox}
            disabled={saving}
            className="bg-medship-primary text-white hover:bg-medship-primary/90"
          >
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-3.5 w-3.5" />
            )}
            Add box
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {!boxes ? (
            <div className="flex justify-center py-8 text-medship-slate">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Inner dims</TableHead>
                  <TableHead>Outer dims</TableHead>
                  <TableHead className="text-right">Tare</TableHead>
                  <TableHead className="text-right">Max content</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[8rem]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {boxes.map((box) => (
                  <TableRow key={box.id} className={cn(!box.active && 'opacity-50')}>
                    <TableCell className="font-medium text-medship-heading dark:text-white">
                      {box.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDims(box.innerLengthIn, box.innerWidthIn, box.innerHeightIn)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDims(box.outerLengthIn, box.outerWidthIn, box.outerHeightIn)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{box.boxWeightLb} lb</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {box.maxContentWeightLb} lb
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => toggleActive(box)}
                        className={cn(
                          'rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium',
                          box.active
                            ? 'border-medship-success/30 bg-medship-success/10 text-medship-success'
                            : 'border-medship-border text-medship-slate dark:border-white/10 dark:text-white/50'
                        )}
                      >
                        {box.active ? 'Active' : 'Inactive'}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => remove(box)}
                        className="text-medship-danger hover:bg-medship-danger/5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Rules tab
// -----------------------------------------------------------------------------

type RuleField = {
  label: string
  get: (r: PackingRules) => number
  set: (r: PackingRules, value: number) => PackingRules
}

const RULE_GROUPS: Array<{ title: string; fields: RuleField[] }> = [
  {
    title: 'Packing',
    fields: [
      {
        label: 'Fill factor (usable volume share)',
        get: (r) => r.fill_factor,
        set: (r, v) => ({ ...r, fill_factor: v }),
      },
      {
        label: 'Max box content weight (lb)',
        get: (r) => r.max_box_weight_lb,
        set: (r, v) => ({ ...r, max_box_weight_lb: v }),
      },
      {
        label: 'Dim divisor (FedEx Ground 139)',
        get: (r) => r.dim_divisor,
        set: (r, v) => ({ ...r, dim_divisor: v }),
      },
    ],
  },
  {
    title: 'Parcel limits (forced LTL beyond these)',
    fields: [
      {
        label: 'Single package weight ceiling (lb)',
        get: (r) => r.parcel_max.single_package_weight_lb,
        set: (r, v) => ({ ...r, parcel_max: { ...r.parcel_max, single_package_weight_lb: v } }),
      },
      {
        label: 'Max length (in)',
        get: (r) => r.parcel_max.max_length_in,
        set: (r, v) => ({ ...r, parcel_max: { ...r.parcel_max, max_length_in: v } }),
      },
      {
        label: 'Max length + girth (in)',
        get: (r) => r.parcel_max.max_length_plus_girth_in,
        set: (r, v) => ({ ...r, parcel_max: { ...r.parcel_max, max_length_plus_girth_in: v } }),
      },
    ],
  },
  {
    title: 'LTL comparison triggers',
    fields: [
      {
        label: 'Total billable weight (lb)',
        get: (r) => r.ltl_triggers.total_billable_weight_lb,
        set: (r, v) => ({
          ...r,
          ltl_triggers: { ...r.ltl_triggers, total_billable_weight_lb: v },
        }),
      },
      {
        label: 'Carton count (same destination)',
        get: (r) => r.ltl_triggers.carton_count,
        set: (r, v) => ({ ...r, ltl_triggers: { ...r.ltl_triggers, carton_count: v } }),
      },
      {
        label: 'Dim-weight flag threshold (lb)',
        get: (r) => r.ltl_triggers.dim_weight_flag_threshold_lb,
        set: (r, v) => ({
          ...r,
          ltl_triggers: { ...r.ltl_triggers, dim_weight_flag_threshold_lb: v },
        }),
      },
    ],
  },
  {
    title: 'Pallets',
    fields: [
      { label: 'Length (in)', get: (r) => r.pallet.length_in, set: (r, v) => ({ ...r, pallet: { ...r.pallet, length_in: v } }) },
      { label: 'Width (in)', get: (r) => r.pallet.width_in, set: (r, v) => ({ ...r, pallet: { ...r.pallet, width_in: v } }) },
      { label: 'Deck height (in)', get: (r) => r.pallet.deck_height_in, set: (r, v) => ({ ...r, pallet: { ...r.pallet, deck_height_in: v } }) },
      { label: 'Deck weight (lb)', get: (r) => r.pallet.deck_weight_lb, set: (r, v) => ({ ...r, pallet: { ...r.pallet, deck_weight_lb: v } }) },
      { label: 'Max height (in)', get: (r) => r.pallet.max_height_in, set: (r, v) => ({ ...r, pallet: { ...r.pallet, max_height_in: v } }) },
      { label: 'Max weight (lb)', get: (r) => r.pallet.max_weight_lb, set: (r, v) => ({ ...r, pallet: { ...r.pallet, max_weight_lb: v } }) },
      { label: 'Max single-piece weight (lb)', get: (r) => r.pallet.max_piece_weight_lb, set: (r, v) => ({ ...r, pallet: { ...r.pallet, max_piece_weight_lb: v } }) },
      { label: 'Stack fill factor', get: (r) => r.pallet.stack_fill_factor, set: (r, v) => ({ ...r, pallet: { ...r.pallet, stack_fill_factor: v } }) },
    ],
  },
  {
    title: 'Confidence',
    fields: [
      {
        label: 'LLM confidence threshold (0–1)',
        get: (r) => r.llm_confidence_threshold,
        set: (r, v) => ({ ...r, llm_confidence_threshold: v }),
      },
      {
        label: 'Estimate confidence threshold (0–1)',
        get: (r) => r.estimate_confidence_threshold,
        set: (r, v) => ({ ...r, estimate_confidence_threshold: v }),
      },
    ],
  },
]

function RulesTab() {
  const [rules, setRules] = useState<PackingRules | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchJson<{ rules: PackingRules }>('/api/estimator/rules')
      .then(({ rules }) => setRules(rules))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load rules'))
  }, [])

  const save = async () => {
    if (!rules) return
    setSaving(true)
    try {
      const payload = { ...rules, segregate_liquids: rules.segregate_liquids }
      await fetchJson('/api/estimator/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      toast.success('Packing rules saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save rules')
    } finally {
      setSaving(false)
    }
  }

  if (!rules) {
    return (
      <div className="flex justify-center py-10 text-medship-slate">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {RULE_GROUPS.map((group) => (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle className="text-base text-medship-heading dark:text-white">
                {group.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {group.fields.map((field) => (
                <label key={field.label} className="space-y-1">
                  <span className="block text-[0.7rem] font-medium text-medship-slate dark:text-white/50">
                    {field.label}
                  </span>
                  <Input
                    inputMode="decimal"
                    value={String(field.get(rules))}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      if (Number.isFinite(value)) setRules(field.set(rules, value))
                    }}
                  />
                </label>
              ))}
              {group.title === 'Packing' && (
                <label className="col-span-2 flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={rules.segregate_liquids}
                    onChange={(e) => setRules({ ...rules, segregate_liquids: e.target.checked })}
                    className="h-4 w-4 accent-[#1E98D5]"
                  />
                  <span className="text-xs text-medship-slate dark:text-white/60">
                    Segregate liquids from dry goods
                  </span>
                </label>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Button
        type="button"
        onClick={save}
        disabled={saving}
        className="bg-medship-primary px-8 text-white hover:bg-medship-primary/90"
      >
        {saving ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Save className="mr-2 h-4 w-4" />
        )}
        Save rules
      </Button>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Verified dims tab
// -----------------------------------------------------------------------------

type AdminDims = {
  id: string
  fishbowlPartNumber: string
  lengthIn: number
  widthIn: number
  heightIn: number
  weightLb: number
  shipsInOwnCarton: boolean
  source: string
  llmSuggested: boolean
  verifiedBy: string | null
  verifiedAt: string
}

function DimsTab() {
  const [search, setSearch] = useState('')
  const [dims, setDims] = useState<AdminDims[] | null>(null)

  const load = (term: string) => {
    const query = term ? `?search=${encodeURIComponent(term)}` : ''
    fetchJson<{ dims: AdminDims[] }>(`/api/estimator/dims${query}`)
      .then(({ dims }) => setDims(dims))
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'Failed to load dims')
        setDims([])
      })
  }

  useEffect(() => load(''), [])

  return (
    <Card>
      <CardHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            load(search.trim())
          }}
          className="flex gap-2"
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search part number…"
            className="max-w-xs"
          />
          <Button
            type="submit"
            variant="outline"
            className="border-medship-primary/40 text-medship-primary"
          >
            Search
          </Button>
        </form>
      </CardHeader>
      <CardContent>
        {!dims ? (
          <div className="flex justify-center py-8 text-medship-slate">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : dims.length === 0 ? (
          <div className="py-8 text-center text-sm text-medship-slate dark:text-white/50">
            No verified dims yet. SKUs get verified inline during the quote flow.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part #</TableHead>
                <TableHead>Dims</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead>Own carton</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Verified by</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dims.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs font-medium text-medship-heading dark:text-white">
                    {row.fishbowlPartNumber}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDims(row.lengthIn, row.widthIn, row.heightIn)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.weightLb} lb</TableCell>
                  <TableCell className="text-xs">{row.shipsInOwnCarton ? 'Yes' : '—'}</TableCell>
                  <TableCell className="text-xs">
                    {row.source.replaceAll('_', ' ')}
                    {row.llmSuggested && (
                      <span className="ml-1.5 rounded-full bg-medship-info/10 px-1.5 py-0.5 text-[0.65rem] text-medship-info">
                        AI-assisted
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-medship-slate dark:text-white/60">
                    {row.verifiedBy ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-medship-slate dark:text-white/60">
                    {new Date(row.verifiedAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

export function EstimatorAdminClient() {
  return (
    <>
      <Header title="Estimator Admin" />
      <main className="flex-1 space-y-6 overflow-auto p-4 md:p-6">
        <Link
          href="/dashboard/estimator"
          className="inline-flex items-center gap-1.5 text-sm text-medship-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to estimator
        </Link>
        <Tabs defaultValue="boxes">
          <TabsList>
            <TabsTrigger value="boxes">Standard boxes</TabsTrigger>
            <TabsTrigger value="rules">Packing rules</TabsTrigger>
            <TabsTrigger value="dims">Verified dims</TabsTrigger>
          </TabsList>
          <TabsContent value="boxes" className="mt-6">
            <BoxesTab />
          </TabsContent>
          <TabsContent value="rules" className="mt-6">
            <RulesTab />
          </TabsContent>
          <TabsContent value="dims" className="mt-6">
            <DimsTab />
          </TabsContent>
        </Tabs>
      </main>
    </>
  )
}
