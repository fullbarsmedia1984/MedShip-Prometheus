'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowLeft, Users } from 'lucide-react'
import { KanbanAvatar } from './KanbanAvatar'
import { ColumnView } from './Column'
import { CardBody } from './TaskCard'
import { TaskDrawer } from './TaskDrawer'
import { MembersDialog } from './MembersDialog'
import { KANBAN_ROLE_LABELS } from '@/lib/kanban/roles'
import type {
  KanbanBoard,
  KanbanBoardMember,
  KanbanColumn,
  KanbanPriority,
  KanbanTask,
  KanbanUser,
} from '@/lib/kanban/types'

const ease = [0.22, 1, 0.36, 1] as const

export function BoardClient({
  board,
  columns,
  initialTasks,
  members,
  assignable,
  directory,
  canManage,
}: {
  board: KanbanBoard
  columns: KanbanColumn[]
  initialTasks: KanbanTask[]
  members: KanbanBoardMember[]
  assignable: KanbanUser[]
  directory: KanbanUser[]
  canManage: boolean
}) {
  const router = useRouter()
  const [tasks, setTasks] = useState<KanbanTask[]>(initialTasks)
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null)
  const [openTask, setOpenTask] = useState<KanbanTask | null>(null)
  const [membersOpen, setMembersOpen] = useState(false)
  const [filterUser, setFilterUser] = useState<string | null>(null)
  const dragSnapshot = useRef<KanbanTask[] | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const byColumn = useMemo(() => {
    const map: Record<string, KanbanTask[]> = {}
    for (const c of columns) map[c.id] = []
    const visible = filterUser
      ? tasks.filter((t) => t.assignees.some((a) => a.id === filterUser))
      : tasks
    for (const t of visible) (map[t.column_id] ??= []).push(t)
    for (const id of Object.keys(map)) map[id].sort((a, b) => a.position - b.position)
    return map
  }, [tasks, columns, filterUser])

  const doneColumn = columns.find((c) => c.is_done_column)
  const openCount = tasks.filter((t) => !t.completed_at).length
  const doneCount = tasks.length - openCount

  function findColumnOf(id: string): string | null {
    if (columns.some((c) => c.id === id)) return id
    return tasks.find((t) => t.id === id)?.column_id ?? null
  }

  function handleDragStart(e: DragStartEvent) {
    dragSnapshot.current = tasks
    const t = tasks.find((x) => x.id === e.active.id)
    setActiveTask(t ?? null)
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over) return
    const activeCol = findColumnOf(String(active.id))
    const overCol = findColumnOf(String(over.id))
    if (!activeCol || !overCol || activeCol === overCol) return

    setTasks((prev) => {
      const moving = prev.find((t) => t.id === active.id)
      if (!moving) return prev
      const colTasks = prev
        .filter((t) => t.column_id === overCol && t.id !== moving.id)
        .sort((a, b) => a.position - b.position)
      let pos: number
      if (over.id !== overCol) {
        const overTask = colTasks.find((t) => t.id === over.id)
        pos = overTask
          ? overTask.position - 0.5
          : (colTasks.at(-1)?.position ?? 0) + 1024
      } else {
        pos = (colTasks.at(-1)?.position ?? 0) + 1024
      }
      return prev.map((t) =>
        t.id === moving.id ? { ...t, column_id: overCol, position: pos } : t
      )
    })
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    setActiveTask(null)
    if (!over) {
      if (dragSnapshot.current) setTasks(dragSnapshot.current)
      return
    }

    const taskId = String(active.id)
    const targetCol = findColumnOf(String(over.id))
    if (!targetCol) return

    let next = tasks
    const current = tasks.find((t) => t.id === taskId)
    if (!current) return

    if (String(over.id) !== targetCol && String(over.id) !== taskId) {
      const colList = tasks
        .filter((t) => t.column_id === targetCol)
        .sort((a, b) => a.position - b.position)
      const from = colList.findIndex((t) => t.id === taskId)
      const to = colList.findIndex((t) => t.id === String(over.id))
      if (from >= 0 && to >= 0 && from !== to) {
        const reordered = arrayMove(colList, from, to)
        const idx = reordered.findIndex((t) => t.id === taskId)
        const prev = reordered[idx - 1]?.position
        const after = reordered[idx + 1]?.position
        const pos =
          prev !== undefined && after !== undefined
            ? (prev + after) / 2
            : prev !== undefined
              ? prev + 1024
              : after !== undefined
                ? after - 1024
                : 1024
        next = tasks.map((t) => (t.id === taskId ? { ...t, position: pos } : t))
        setTasks(next)
      }
    }

    const finalTask = next.find((t) => t.id === taskId)!
    const colList = next
      .filter((t) => t.column_id === finalTask.column_id)
      .sort((a, b) => a.position - b.position)
    const idx = colList.findIndex((t) => t.id === taskId)
    const prevPos = colList[idx - 1]?.position
    const nextPos = colList[idx + 1]?.position
    const position =
      prevPos !== undefined && nextPos !== undefined
        ? (prevPos + nextPos) / 2
        : prevPos !== undefined
          ? prevPos + 1024
          : nextPos !== undefined
            ? nextPos - 1024
            : 1024

    try {
      const res = await fetch(`/api/kanban/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: finalTask.column_id, position }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const { task } = await res.json()
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...task } : t)))
    } catch {
      if (dragSnapshot.current) setTasks(dragSnapshot.current)
    }
    dragSnapshot.current = null
  }

  async function createTask(columnId: string, title: string, priority: KanbanPriority) {
    const res = await fetch('/api/kanban/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: board.id, columnId, title, priority }),
    })
    if (res.ok) {
      const { task } = await res.json()
      setTasks((prev) => [...prev, task])
    }
  }

  function applyTaskUpdate(task: KanbanTask) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...task } : t)))
    setOpenTask((cur) => (cur && cur.id === task.id ? { ...cur, ...task } : cur))
  }

  function removeTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    setOpenTask(null)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
        className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3"
      >
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/dashboard/kanban"
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-medship-primary hover:text-medship-primary"
          >
            <ArrowLeft className="h-3 w-3" />
            boards
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: board.accent }}
              />
              <h1 className="truncate text-lg font-semibold text-card-foreground">
                {board.name}
              </h1>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {board.kind}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {openCount} open · {doneCount} done
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {members.length > 0 && (
            <div className="flex items-center -space-x-1.5">
              {members.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setFilterUser(filterUser === m.id ? null : m.id)}
                  className={`rounded-full transition-transform hover:-translate-y-0.5 ${
                    filterUser === m.id ? 'ring-2 ring-medship-primary' : ''
                  }`}
                  title={`${m.full_name} — ${KANBAN_ROLE_LABELS[m.job_role]}${
                    m.member_role === 'manager' ? ' (manager)' : ''
                  }`}
                >
                  <KanbanAvatar
                    name={m.full_name}
                    color={m.avatar_color}
                    size={26}
                    ring
                  />
                </button>
              ))}
            </div>
          )}
          {filterUser && (
            <button
              onClick={() => setFilterUser(null)}
              className="font-mono text-[10px] font-semibold uppercase text-medship-danger hover:underline"
            >
              clear filter
            </button>
          )}
          {canManage && board.kind === 'department' && (
            <button
              onClick={() => setMembersOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-medship-primary hover:text-medship-primary"
            >
              <Users className="h-3 w-3" />
              members
            </button>
          )}
        </div>
      </motion.header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveTask(null)
          if (dragSnapshot.current) setTasks(dragSnapshot.current)
        }}
      >
        <main className="flex flex-1 gap-4 overflow-x-auto overflow-y-hidden px-5 py-4">
          {columns.map((c, i) => (
            <ColumnView
              key={c.id}
              column={c}
              index={i}
              tasks={byColumn[c.id] ?? []}
              accent={board.accent}
              onOpen={(t) => setOpenTask(t)}
              onCreate={createTask}
            />
          ))}
        </main>

        <DragOverlay
          dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
        >
          {activeTask ? (
            <div style={{ rotate: '3deg', scale: '1.04' }}>
              <CardBody
                task={activeTask}
                done={activeTask.column_id === doneColumn?.id}
                overlay
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <AnimatePresence>
        {openTask && (
          <TaskDrawer
            key={openTask.id}
            task={openTask}
            columns={columns}
            assignable={assignable}
            onClose={() => setOpenTask(null)}
            onUpdated={applyTaskUpdate}
            onDeleted={removeTask}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {membersOpen && (
          <MembersDialog
            board={board}
            members={members}
            directory={directory}
            onClose={() => {
              setMembersOpen(false)
              router.refresh()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
