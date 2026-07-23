'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { KanbanAvatar } from './KanbanAvatar'
import { KANBAN_PRIORITY_META, formatDue } from '@/lib/kanban/ui'
import type { KanbanTask } from '@/lib/kanban/types'

export function CardBody({
  task,
  done,
  overlay = false,
}: {
  task: KanbanTask
  done: boolean
  overlay?: boolean
}) {
  const prio = KANBAN_PRIORITY_META[task.priority]
  const due = task.due_date ? formatDue(task.due_date) : null
  return (
    <div
      className={`relative rounded-lg border bg-card p-3 transition-shadow ${
        overlay
          ? 'border-medship-primary shadow-xl ring-1 ring-medship-primary/30'
          : 'border-border shadow-sm hover:shadow-[var(--shadow-card-hover)]'
      } ${done ? 'opacity-60' : ''}`}
      style={{ borderLeftColor: prio.color, borderLeftWidth: 3 }}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={`text-[13px] font-medium leading-snug text-card-foreground ${
            done ? 'line-through decoration-muted-foreground' : ''
          }`}
        >
          {task.title}
        </p>
        <span
          className="mt-0.5 shrink-0 font-mono text-[9px] font-semibold uppercase tracking-wider"
          style={{ color: prio.color }}
        >
          {prio.label}
        </span>
      </div>

      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <span
              key={l}
              className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
            >
              {l}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex -space-x-1">
          {task.assignees.map((u) => (
            <KanbanAvatar
              key={u.id}
              name={u.full_name}
              color={u.avatar_color}
              size={20}
              ring
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {done && (
            <span className="font-mono text-[9px] font-semibold uppercase text-medship-success">
              ✓ done
            </span>
          )}
          {due && !done && (
            <span
              className={`rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${
                due.overdue
                  ? 'bg-medship-danger/10 text-medship-danger'
                  : due.soon
                    ? 'bg-medship-warning/10 text-medship-warning'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {due.overdue ? '⚠ ' : ''}
              {due.text}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function TaskCard({
  task,
  done,
  onOpen,
}: {
  task: KanbanTask
  done: boolean
  onOpen: (task: KanbanTask) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { type: 'task', task } })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
      }}
      className={`cursor-grab touch-none select-none active:cursor-grabbing ${
        isDragging ? 'opacity-40 saturate-50' : ''
      }`}
      onClick={() => onOpen(task)}
      data-task-title={task.title}
      {...attributes}
      {...listeners}
    >
      <CardBody task={task} done={done} />
    </div>
  )
}
