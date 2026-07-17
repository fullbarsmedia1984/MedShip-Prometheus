'use client'

// Admin CRUD over askzeus_knowledge. Facts entered here are injected into
// AskZeus's system context on the very next question — no deploy needed.

import { useCallback, useEffect, useState } from 'react'
import { BookOpenCheck, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface KnowledgeEntry {
  id: string
  content: string
  active: boolean
  createdAt: string
  updatedAt: string
}

const EXAMPLES = [
  'Kit orders always ship complete — we never partial-ship a nursing kit.',
  'When asked about "the fall rush", that means July through September.',
  '"House accounts" are orders without an assigned rep; exclude them when discussing rep performance unless asked.',
]

export function KnowledgeManager() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/askzeus/knowledge')
      if (!response.ok) throw new Error('Failed to load knowledge')
      const data = (await response.json()) as { entries: KnowledgeEntry[] }
      setEntries(data.entries ?? [])
    } catch {
      toast.error('Could not load knowledge entries')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const add = useCallback(async () => {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true)
    try {
      const response = await fetch('/api/askzeus/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!response.ok) throw new Error()
      const data = (await response.json()) as { entry: KnowledgeEntry }
      setEntries((prev) => [data.entry, ...prev])
      setDraft('')
      toast.success('Added — AskZeus knows this starting with the next question')
    } catch {
      toast.error('Could not save the entry')
    } finally {
      setSaving(false)
    }
  }, [draft, saving])

  const toggle = useCallback(async (entry: KnowledgeEntry) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, active: !e.active } : e))
    )
    const response = await fetch(`/api/askzeus/knowledge/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !entry.active }),
    }).catch(() => null)
    if (!response?.ok) {
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, active: entry.active } : e))
      )
      toast.error('Could not update the entry')
    }
  }, [])

  const remove = useCallback(async (entry: KnowledgeEntry) => {
    const response = await fetch(`/api/askzeus/knowledge/${entry.id}`, {
      method: 'DELETE',
    }).catch(() => null)
    if (response?.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id))
      toast.success('Entry deleted')
    } else {
      toast.error('Could not delete the entry')
    }
  }, [])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpenCheck className="h-4 w-4 text-medship-primary" />
            Teach AskZeus
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Facts added here are given to AskZeus with every question, effective
            immediately. Use them for business rules, vocabulary, and context the
            data alone doesn&apos;t carry. Examples:
          </p>
          <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
            {EXAMPLES.map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
          <div className="flex items-start gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Add a fact AskZeus should always know…"
              className="flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-medship-primary/60 focus:ring-2 focus:ring-medship-primary/20"
            />
            <button
              type="button"
              onClick={() => void add()}
              disabled={!draft.trim() || saving}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-opacity',
                draft.trim()
                  ? 'bg-medship-primary text-white hover:opacity-90'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Current knowledge ({entries.filter((e) => e.active).length} active)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing yet — add the first fact above.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 py-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entry.active}
                    onClick={() => void toggle(entry)}
                    className={cn(
                      'mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
                      entry.active ? 'bg-medship-success' : 'bg-muted'
                    )}
                    title={entry.active ? 'Active — click to disable' : 'Disabled — click to enable'}
                  >
                    <span
                      className={cn(
                        'block h-4 w-4 rounded-full bg-white shadow transition-transform',
                        entry.active ? 'translate-x-[18px]' : 'translate-x-0.5'
                      )}
                    />
                  </button>
                  <p
                    className={cn(
                      'min-w-0 flex-1 text-sm leading-relaxed',
                      !entry.active && 'text-muted-foreground line-through'
                    )}
                  >
                    {entry.content}
                  </p>
                  <button
                    type="button"
                    onClick={() => void remove(entry)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:text-medship-danger"
                    aria-label="Delete entry"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
