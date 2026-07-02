'use client'

import { useEffect, useState } from 'react'
import { Loader2, Ruler, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fetchJson } from '@/lib/client-api'
import { cn } from '@/lib/utils'
import type { ItemAttributes } from '@/lib/packing-engine'
import type { ResolvedLineItem } from './estimator-types'

type DimsSuggestion = {
  lengthIn: number
  widthIn: number
  heightIn: number
  weightLb: number
  attributes: ItemAttributes
  shipsInOwnCarton: boolean
  confidence: number
  sourceUrl: string | null
  rationale: string
}

type FormState = {
  lengthIn: string
  widthIn: string
  heightIn: string
  weightLb: string
  shipsInOwnCarton: boolean
  source: 'manufacturer_site' | 'physical_measurement' | 'fishbowl_confirmed'
  sourceUrl: string
  llmSuggested: boolean
  attributes: ItemAttributes
}

const ATTRIBUTE_FIELDS: Array<{ key: keyof ItemAttributes & string; label: string }> = [
  { key: 'liquid', label: 'Liquid' },
  { key: 'fragile', label: 'Fragile' },
  { key: 'stackable', label: 'Stackable' },
  { key: 'nestable', label: 'Nestable' },
  { key: 'orientation_lock', label: 'Keep upright' },
  { key: 'hazmat', label: 'Hazmat' },
]

function initialForm(line: ResolvedLineItem): FormState {
  const fb = line.fishbowlDims
  return {
    lengthIn: fb.lengthIn && fb.lengthIn > 0 ? String(fb.lengthIn) : '',
    widthIn: fb.widthIn && fb.widthIn > 0 ? String(fb.widthIn) : '',
    heightIn: fb.heightIn && fb.heightIn > 0 ? String(fb.heightIn) : '',
    weightLb: fb.weightLb && fb.weightLb > 0 ? String(fb.weightLb) : '',
    shipsInOwnCarton: line.resolved.shipsInOwnCarton,
    source: 'physical_measurement',
    sourceUrl: '',
    llmSuggested: false,
    attributes: { ...line.resolved.attributes },
  }
}

export function VerifyDimsDialog({
  line,
  onClose,
  onSaved,
}: {
  line: ResolvedLineItem | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestion, setSuggestion] = useState<DimsSuggestion | null>(null)

  useEffect(() => {
    if (line) {
      setForm(initialForm(line))
      setSuggestion(null)
    }
  }, [line])

  if (!line || !form) return null

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))

  const askLlm = async () => {
    setSuggesting(true)
    try {
      const response = await fetchJson<{ suggestion: DimsSuggestion | null; message?: string }>(
        '/api/estimator/dims/suggest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partNumber: line.partNumber, description: line.description }),
        }
      )
      if (!response.suggestion) {
        toast.info(response.message ?? 'No confident suggestion for this item — enter dims manually.')
        return
      }
      const s = response.suggestion
      setSuggestion(s)
      setForm((prev) =>
        prev
          ? {
              ...prev,
              lengthIn: String(s.lengthIn),
              widthIn: String(s.widthIn),
              heightIn: String(s.heightIn),
              weightLb: String(s.weightLb),
              shipsInOwnCarton: s.shipsInOwnCarton,
              attributes: s.attributes,
              source: 'manufacturer_site',
              sourceUrl: s.sourceUrl ?? '',
              llmSuggested: true,
            }
          : prev
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'LLM suggestion failed')
    } finally {
      setSuggesting(false)
    }
  }

  const save = async () => {
    const dims = {
      lengthIn: Number(form.lengthIn),
      widthIn: Number(form.widthIn),
      heightIn: Number(form.heightIn),
      weightLb: Number(form.weightLb),
    }
    if (
      !Number.isFinite(dims.lengthIn) || dims.lengthIn <= 0 ||
      !Number.isFinite(dims.widthIn) || dims.widthIn <= 0 ||
      !Number.isFinite(dims.heightIn) || dims.heightIn <= 0 ||
      !Number.isFinite(dims.weightLb) || dims.weightLb < 0
    ) {
      toast.error('Enter positive dimensions and a non-negative weight.')
      return
    }

    setSaving(true)
    try {
      await fetchJson('/api/estimator/dims', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fishbowlPartNumber: line.partNumber,
          ...dims,
          shipsInOwnCarton: form.shipsInOwnCarton,
          attributes: form.attributes,
          source: form.source,
          sourceUrl: form.sourceUrl.trim() || null,
          llmSuggested: form.llmSuggested,
        }),
      })
      toast.success(`${line.partNumber} verified — it won't be asked again.`)
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save dims')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-medship-heading dark:text-white">
            <Ruler className="h-4 w-4 text-medship-primary" />
            Confirm shipping dims — {line.partNumber}
          </DialogTitle>
          <DialogDescription className="text-medship-text dark:text-white/60">
            {line.description}. Fishbowl values are pre-filled as untrusted defaults; confirm or
            correct them once and this SKU is never asked again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                ['lengthIn', 'Length (in)'],
                ['widthIn', 'Width (in)'],
                ['heightIn', 'Height (in)'],
                ['weightLb', 'Weight (lb)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="space-y-1">
                <span className="text-[0.7rem] font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
                  {label}
                </span>
                <Input
                  inputMode="decimal"
                  value={form[key]}
                  onChange={(e) => setField(key, e.target.value)}
                  placeholder="—"
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {ATTRIBUTE_FIELDS.map(({ key, label }) => {
              const active = Boolean(form.attributes[key])
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setField('attributes', { ...form.attributes, [key]: !active })
                  }
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-medship-primary bg-medship-primary/10 text-medship-primary'
                      : 'border-medship-border text-medship-slate hover:border-medship-primary/50 dark:border-white/10 dark:text-white/60'
                  )}
                >
                  {label}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setField('shipsInOwnCarton', !form.shipsInOwnCarton)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                form.shipsInOwnCarton
                  ? 'border-medship-secondary bg-medship-secondary/10 text-medship-secondary'
                  : 'border-medship-border text-medship-slate hover:border-medship-secondary/50 dark:border-white/10 dark:text-white/60'
              )}
            >
              Ships in own carton
            </button>
          </div>

          {form.attributes.nestable && (
            <label className="flex items-center gap-3">
              <span className="text-xs font-medium text-medship-slate dark:text-white/60">
                Nesting factor (volume each nested unit consumes, 0–1)
              </span>
              <Input
                className="w-24"
                inputMode="decimal"
                value={String(form.attributes.nesting_factor)}
                onChange={(e) =>
                  setField('attributes', {
                    ...form.attributes,
                    nesting_factor: Number(e.target.value) || 0,
                  })
                }
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[0.7rem] font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
                Source
              </span>
              <Select
                value={form.source}
                onValueChange={(value) => setField('source', value as FormState['source'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="physical_measurement">Physical measurement</SelectItem>
                  <SelectItem value="manufacturer_site">Manufacturer site</SelectItem>
                  <SelectItem value="fishbowl_confirmed">Fishbowl confirmed</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-[0.7rem] font-medium uppercase tracking-wide text-medship-slate dark:text-white/50">
                Source URL (optional)
              </span>
              <Input
                value={form.sourceUrl}
                onChange={(e) => setField('sourceUrl', e.target.value)}
                placeholder="https://…"
              />
            </label>
          </div>

          {suggestion && (
            <div className="rounded-lg border border-medship-primary/30 bg-medship-primary/5 p-3 text-xs text-medship-slate dark:text-white/70">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-medship-primary">
                <Sparkles className="h-3.5 w-3.5" />
                LLM suggestion ({Math.round(suggestion.confidence * 100)}% confident) — review before saving
              </div>
              {suggestion.rationale}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={askLlm}
            disabled={suggesting}
            className="border-medship-primary/40 text-medship-primary hover:bg-medship-primary/5"
          >
            {suggesting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Suggest with AI
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-medship-success text-white hover:bg-medship-success/90"
          >
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save verified dims
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
