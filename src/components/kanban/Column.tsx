'use client'

import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { motion, AnimatePresence } from 'motion/react'
import { TaskCard } from './TaskCard'
import { KANBAN_PRIORITY_META } from '@/lib/kanban/ui'
import type { KanbanColumn, KanbanPriority, KanbanTask } from '@/lib/kanban/types'

const ease = [0.22, 1, 0.36, 1] as const

export function ColumnView({
  column,
  tasks,
  index,
  accent,
  onOpen,
  onCreate,
}: {
  column: KanbanColumn
  tasks: KanbanTask[]
  index: number
  accent: string
  onOpen: (task: KanbanTask) => void
  onCreate: (columnId: string, title: string, priority: KanbanPriority) => Promise<void>
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', column },
  })
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<KanbanPriority>('medium')
  const [busy, setBusy] = useState(false)

  const overWip = column.wip_limit !== null && tasks.length > column.wip_limit

  async function submit() {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      await onCreate(column.id, t, priority)
      setTitle('')
      setPriority('medium')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + index * 0.07, duration: 0.5, ease }}
      className="flex w-[290px] shrink-0 flex-col"
      data-column-name={column.name}
    >
      <header className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-sm"
            style={{ background: column.is_done_column ? '#0FA62C' : accent }}
          />
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
            {column.name}
          </h3>
        </div>
        <span
          className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
            overWip
              ? 'bg-medship-danger/10 text-medship-danger'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {tasks.length}
          {column.wip_limit ? `/${column.wip_limit}` : ''}
          {overWip ? ' WIP!' : ''}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-1 flex-col gap-2 rounded-xl border p-2 transition-colors duration-200 ${
          isOver
            ? 'border-medship-primary/60 bg-medship-primary/5'
            : 'border-border bg-muted/50'
        }`}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <AnimatePresence initial={false}>
            {tasks.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, scale: 0.94, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: -6 }}
                transition={{ duration: 0.22, ease }}
              >
                <TaskCard task={t} done={column.is_done_column} onOpen={onOpen} />
              </motion.div>
            ))}
          </AnimatePresence>
        </SortableContext>

        {tasks.length === 0 && !composing && (
          <p className="px-2 py-4 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            — empty —
          </p>
        )}

        <AnimatePresence initial={false}>
          {composing ? (
            <motion.div
              key="composer"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease }}
              className="overflow-hidden"
            >
              <div className="rounded-lg border border-medship-primary/50 bg-card p-2 shadow-sm">
                <textarea
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void submit()
                    }
                    if (e.key === 'Escape') setComposing(false)
                  }}
                  placeholder="Task title…"
                  rows={2}
                  className="w-full resize-none bg-transparent text-[13px] font-medium text-card-foreground outline-none placeholder:text-muted-foreground"
                  data-testid={`composer-${column.name}`}
                />
                <div className="mt-1.5 flex items-center justify-between">
                  <div className="flex gap-1">
                    {(Object.keys(KANBAN_PRIORITY_META) as KanbanPriority[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPriority(p)}
                        className={`rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase transition-colors ${
                          priority === p
                            ? 'bg-muted'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        style={priority === p ? { color: KANBAN_PRIORITY_META[p].color } : undefined}
                      >
                        {KANBAN_PRIORITY_META[p].label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setComposing(false)}
                      className="rounded px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
                    >
                      esc
                    </button>
                    <button
                      onClick={() => void submit()}
                      disabled={busy || !title.trim()}
                      className="rounded bg-medship-primary px-2.5 py-1 font-mono text-[10px] font-semibold uppercase text-white transition-colors hover:bg-medship-primary-light disabled:opacity-40"
                    >
                      {busy ? '…' : 'Add ↵'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.button
              key="add"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setComposing(true)}
              className="rounded-lg border border-dashed border-border px-2 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-medship-primary/50 hover:text-medship-primary"
            >
              + add task
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  )
}
