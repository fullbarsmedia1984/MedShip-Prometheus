'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { KanbanAvatar } from './KanbanAvatar'
import { KANBAN_ROLE_LABELS } from '@/lib/kanban/roles'
import { KANBAN_PRIORITY_META, timeAgo } from '@/lib/kanban/ui'
import type {
  KanbanActivity,
  KanbanColumn,
  KanbanComment,
  KanbanPriority,
  KanbanTask,
  KanbanUser,
} from '@/lib/kanban/types'

const ease = [0.22, 1, 0.36, 1] as const

export function TaskDrawer({
  task,
  columns,
  assignable,
  onClose,
  onUpdated,
  onDeleted,
}: {
  task: KanbanTask
  columns: KanbanColumn[]
  assignable: KanbanUser[]
  onClose: () => void
  onUpdated: (task: KanbanTask) => void
  onDeleted: (id: string) => void
}) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [comments, setComments] = useState<KanbanComment[]>([])
  const [activity, setActivity] = useState<KanbanActivity[]>([])
  const [commentText, setCommentText] = useState('')
  const [tab, setTab] = useState<'comments' | 'activity'>('comments')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/kanban/tasks/${task.id}/comments`)
      .then((r) => (r.ok ? r.json() : { comments: [], activity: [] }))
      .then((d) => {
        if (!cancelled) {
          setComments(d.comments ?? [])
          setActivity(d.activity ?? [])
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [task.id])

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/kanban/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const { task: fresh } = await res.json()
      onUpdated(fresh)
    }
  }

  async function toggleAssignee(userId: string) {
    const has = task.assignees.some((a) => a.id === userId)
    const ids = has
      ? task.assignees.filter((a) => a.id !== userId).map((a) => a.id)
      : [...task.assignees.map((a) => a.id), userId]
    await patch({ assigneeIds: ids })
  }

  async function addComment() {
    const text = commentText.trim()
    if (!text) return
    const res = await fetch(`/api/kanban/tasks/${task.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text }),
    })
    if (res.ok) {
      const { comment } = await res.json()
      setComments((prev) => [...prev, comment])
      setCommentText('')
    }
  }

  async function deleteTask() {
    if (!confirm('Delete this task?')) return
    const res = await fetch(`/api/kanban/tasks/${task.id}`, { method: 'DELETE' })
    if (res.ok) onDeleted(task.id)
  }

  const column = columns.find((c) => c.id === task.column_id)
  const label =
    'font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
      />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.35, ease }}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
        data-testid="task-drawer"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0 flex-1">
            <p className={label}>
              {column?.name ?? '—'} · created {timeAgo(task.created_at)}
            </p>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim() && title !== task.title) void patch({ title })
              }}
              rows={2}
              className="mt-1 w-full resize-none bg-transparent text-lg font-semibold leading-snug text-card-foreground outline-none"
            />
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground transition-colors hover:border-medship-danger hover:text-medship-danger"
          >
            esc
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className={`${label} mb-1.5`}>Status</p>
              <select
                value={task.column_id}
                onChange={(e) => void patch({ columnId: e.target.value })}
                className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm text-card-foreground outline-none focus:border-medship-primary"
                data-testid="move-select"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className={`${label} mb-1.5`}>Due</p>
              <input
                type="date"
                defaultValue={task.due_date?.slice(0, 10) ?? ''}
                onChange={(e) => void patch({ dueDate: e.target.value || null })}
                className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm text-card-foreground outline-none focus:border-medship-primary"
              />
            </div>
          </div>

          <p className={`${label} mt-4 mb-1.5`}>Priority</p>
          <div className="flex gap-1.5">
            {(Object.keys(KANBAN_PRIORITY_META) as KanbanPriority[]).map((p) => (
              <button
                key={p}
                onClick={() => void patch({ priority: p })}
                className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[10px] font-semibold uppercase transition-all ${
                  task.priority === p
                    ? 'border-current bg-muted'
                    : 'border-border text-muted-foreground hover:border-medship-primary/40'
                }`}
                style={
                  task.priority === p
                    ? { color: KANBAN_PRIORITY_META[p].color }
                    : undefined
                }
              >
                {KANBAN_PRIORITY_META[p].label}
              </button>
            ))}
          </div>

          <p className={`${label} mt-4 mb-1.5`}>Description</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description !== (task.description ?? '')) void patch({ description })
            }}
            rows={3}
            placeholder="Add details…"
            className="w-full resize-none rounded-md border border-input bg-card p-2.5 text-sm leading-relaxed text-card-foreground outline-none placeholder:text-muted-foreground focus:border-medship-primary"
          />

          <p className={`${label} mt-4 mb-1.5`}>Assignees</p>
          <div className="flex flex-col gap-1">
            {assignable.map((u) => {
              const on = task.assignees.some((a) => a.id === u.id)
              return (
                <button
                  key={u.id}
                  onClick={() => void toggleAssignee(u.id)}
                  className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                    on
                      ? 'border-medship-primary/60 bg-medship-primary/5'
                      : 'border-border hover:border-medship-primary/40'
                  }`}
                  data-testid={`assignee-${u.full_name}`}
                >
                  <KanbanAvatar name={u.full_name} color={u.avatar_color} size={22} />
                  <span className="flex-1 text-sm font-medium text-card-foreground">
                    {u.full_name}
                  </span>
                  <span className="font-mono text-[9px] uppercase text-muted-foreground">
                    {KANBAN_ROLE_LABELS[u.job_role]}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      on ? 'text-medship-primary' : 'text-muted-foreground'
                    }`}
                  >
                    {on ? '✓' : '+'}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-5 flex gap-4 border-b border-border">
            {(['comments', 'activity'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  tab === t
                    ? 'text-medship-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t} [{t === 'comments' ? comments.length : activity.length}]
                {tab === t && (
                  <motion.span
                    layoutId="kanban-drawer-tab"
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-medship-primary"
                  />
                )}
              </button>
            ))}
          </div>

          {tab === 'comments' ? (
            <div className="mt-3 flex flex-col gap-3">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  {c.author && (
                    <KanbanAvatar
                      name={c.author.full_name}
                      color={c.author.avatar_color}
                      size={24}
                    />
                  )}
                  <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <p className="font-mono text-[9px] uppercase text-muted-foreground">
                      {c.author?.full_name ?? '—'} · {timeAgo(c.created_at)}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-card-foreground">
                      {c.body}
                    </p>
                  </div>
                </div>
              ))}
              {comments.length === 0 && (
                <p className="py-2 font-mono text-[10px] uppercase text-muted-foreground">
                  no comments yet
                </p>
              )}
              <div className="flex gap-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void addComment()}
                  placeholder="Write a comment…"
                  className="flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none placeholder:text-muted-foreground focus:border-medship-primary"
                  data-testid="comment-input"
                />
                <button
                  onClick={() => void addComment()}
                  disabled={!commentText.trim()}
                  className="rounded-md bg-medship-primary px-3 font-mono text-[10px] font-semibold uppercase text-white transition-colors hover:bg-medship-primary-light disabled:opacity-40"
                >
                  send
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {activity.map((a) => (
                <div key={a.id} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 font-mono text-[9px] font-semibold uppercase text-medship-primary">
                    {a.verb}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {a.actor?.full_name ?? '—'}
                    {a.verb === 'moved' || a.verb === 'completed'
                      ? ` · ${String(a.detail?.from ?? '')} → ${String(a.detail?.to ?? '')}`
                      : ''}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                    {timeAgo(a.created_at)}
                  </span>
                </div>
              ))}
              {activity.length === 0 && (
                <p className="py-2 font-mono text-[10px] uppercase text-muted-foreground">
                  no activity
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="border-t border-border p-4">
          <button
            onClick={() => void deleteTask()}
            className="rounded-md border border-border px-3 py-2 font-mono text-[10px] font-semibold uppercase text-muted-foreground transition-colors hover:border-medship-danger hover:text-medship-danger"
          >
            delete task
          </button>
        </footer>
      </motion.aside>
    </>
  )
}
