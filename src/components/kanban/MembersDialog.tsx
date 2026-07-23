'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { KanbanAvatar } from './KanbanAvatar'
import { KANBAN_ROLE_LABELS, isExecutiveJobRole } from '@/lib/kanban/roles'
import type {
  KanbanBoard,
  KanbanBoardMember,
  KanbanMemberRole,
  KanbanUser,
} from '@/lib/kanban/types'

const ease = [0.22, 1, 0.36, 1] as const

export function MembersDialog({
  board,
  members: initialMembers,
  directory,
  onClose,
}: {
  board: KanbanBoard
  members: KanbanBoardMember[]
  directory: KanbanUser[]
  onClose: () => void
}) {
  const [members, setMembers] = useState<KanbanBoardMember[]>(initialMembers)
  const [busy, setBusy] = useState<string | null>(null)

  const candidates = directory.filter(
    (u) => !members.some((m) => m.id === u.id) && !isExecutiveJobRole(u.job_role)
  )

  async function add(user: KanbanUser, memberRole: KanbanMemberRole = 'member') {
    setBusy(user.id)
    const res = await fetch(`/api/kanban/boards/${board.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, memberRole }),
    })
    if (res.ok) {
      setMembers((prev) => [...prev, { ...user, member_role: memberRole }])
    }
    setBusy(null)
  }

  async function remove(userId: string) {
    setBusy(userId)
    const res = await fetch(
      `/api/kanban/boards/${board.id}/members?userId=${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    )
    if (res.ok) setMembers((prev) => prev.filter((m) => m.id !== userId))
    setBusy(null)
  }

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
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.25, ease }}
        className="fixed inset-x-0 top-[10vh] z-50 mx-auto flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl"
        data-testid="members-dialog"
      >
        <header className="flex items-center justify-between border-b border-border p-5">
          <div>
            <p className={label}>Board membership</p>
            <h2 className="text-lg font-semibold text-card-foreground">{board.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground transition-colors hover:border-medship-danger hover:text-medship-danger"
          >
            esc
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <p className={`${label} mb-2`}>Members [{members.length}]</p>
          <div className="flex flex-col gap-1.5">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2"
              >
                <KanbanAvatar name={m.full_name} color={m.avatar_color} size={24} />
                <span className="flex-1 text-sm font-medium text-card-foreground">
                  {m.full_name}
                </span>
                <span className="font-mono text-[9px] uppercase text-muted-foreground">
                  {KANBAN_ROLE_LABELS[m.job_role]}
                </span>
                {m.member_role === 'manager' && (
                  <span className="rounded bg-medship-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-medship-primary">
                    mgr
                  </span>
                )}
                <button
                  onClick={() => void remove(m.id)}
                  disabled={busy === m.id}
                  className="font-mono text-[10px] uppercase text-muted-foreground transition-colors hover:text-medship-danger disabled:opacity-40"
                  data-testid={`remove-${m.full_name}`}
                >
                  remove
                </button>
              </div>
            ))}
            {members.length === 0 && (
              <p className="py-2 font-mono text-[10px] uppercase text-muted-foreground">
                no members yet
              </p>
            )}
          </div>

          <p className={`${label} mt-5 mb-2`}>
            Add people ({candidates.length} available — command roles always have access)
          </p>
          <div className="flex flex-col gap-1.5">
            {candidates.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-2.5 rounded-md border border-border/60 px-3 py-2"
              >
                <KanbanAvatar name={u.full_name} color={u.avatar_color} size={24} />
                <span className="flex-1 text-sm font-medium text-card-foreground">
                  {u.full_name}
                </span>
                <span className="font-mono text-[9px] uppercase text-muted-foreground">
                  {KANBAN_ROLE_LABELS[u.job_role]}
                </span>
                <button
                  onClick={() => void add(u, 'member')}
                  disabled={busy === u.id}
                  className="rounded-md bg-medship-primary px-2 py-1 font-mono text-[10px] font-semibold uppercase text-white transition-colors hover:bg-medship-primary-light disabled:opacity-40"
                  data-testid={`add-${u.full_name}`}
                >
                  + add
                </button>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </>
  )
}
