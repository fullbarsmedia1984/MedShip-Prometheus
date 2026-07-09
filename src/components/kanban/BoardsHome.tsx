'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import { ShieldCheck } from 'lucide-react'
import { KanbanAvatar } from './KanbanAvatar'
import type {
  KanbanBoard,
  KanbanBoardStat,
  KanbanUser,
} from '@/lib/kanban/types'

const ease = [0.22, 1, 0.36, 1] as const

export function BoardsHome({
  identity,
  isExec,
  boards,
  stats,
  members,
}: {
  identity: KanbanUser | null
  isExec: boolean
  boards: KanbanBoard[]
  stats: Record<string, KanbanBoardStat>
  members: Record<string, KanbanUser[]>
}) {
  const departments = boards.filter((b) => b.kind === 'department')
  const personal = boards.filter((b) => b.kind === 'personal')
  const mine = identity ? personal.find((b) => b.owner_id === identity.id) : null
  const others = personal.filter((b) => b.owner_id !== identity?.id)

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Department boards [{departments.length}]
          </h2>
          {isExec && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-medship-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              command access — all boards visible
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {departments.map((b, i) => {
            const s = stats[b.id]
            const m = members[b.id] ?? []
            const pct = s && s.total > 0 ? Math.round((s.done / s.total) * 100) : 0
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.05, duration: 0.45, ease }}
                whileHover={{ y: -4, transition: { duration: 0.15 } }}
              >
                <Link
                  href={`/dashboard/kanban/${b.slug}`}
                  className="group block overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
                >
                  <div className="h-1 w-full" style={{ background: b.accent }} />
                  <div className="p-5">
                    <div className="flex items-start justify-between">
                      <h3 className="text-base font-semibold text-card-foreground transition-colors group-hover:text-medship-primary">
                        {b.name}
                      </h3>
                      {s && s.urgent > 0 && (
                        <span className="rounded bg-medship-danger/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-medship-danger">
                          {s.urgent} urgent
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-8 text-xs text-muted-foreground">
                      {b.description}
                    </p>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex -space-x-1.5">
                        {m.slice(0, 5).map((u) => (
                          <KanbanAvatar
                            key={u.id}
                            name={u.full_name}
                            color={u.avatar_color}
                            size={22}
                            ring
                          />
                        ))}
                        {m.length > 5 && (
                          <span className="ml-2 self-center font-mono text-[10px] text-muted-foreground">
                            +{m.length - 5}
                          </span>
                        )}
                        {m.length === 0 && (
                          <span className="font-mono text-[10px] uppercase text-muted-foreground">
                            unstaffed
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {s ? `${s.done}/${s.total}` : '0/0'}
                      </span>
                    </div>
                    <div className="mt-3 h-1 overflow-hidden rounded bg-muted">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.35 + i * 0.05, duration: 0.7, ease }}
                        className="h-full rounded"
                        style={{ background: b.accent }}
                      />
                    </div>
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </section>

      {mine && (
        <section>
          <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            My board
          </h2>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.45, ease }}
          >
            <Link
              href={`/dashboard/kanban/${mine.slug}`}
              className="group flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
            >
              <div className="flex items-center gap-3">
                {identity && (
                  <KanbanAvatar
                    name={identity.full_name}
                    color={identity.avatar_color}
                    size={30}
                  />
                )}
                <div>
                  <p className="font-semibold text-card-foreground transition-colors group-hover:text-medship-primary">
                    {mine.name}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    private — visible to you and command
                  </p>
                </div>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                {stats[mine.id] ? `${stats[mine.id].done}/${stats[mine.id].total}` : '0/0'}
              </span>
            </Link>
          </motion.div>
        </section>
      )}

      {isExec && others.length > 0 && (
        <section>
          <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Individual boards [{others.length}]
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {others.map((b, i) => {
              const s = stats[b.id]
              return (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.03, duration: 0.4, ease }}
                >
                  <Link
                    href={`/dashboard/kanban/${b.slug}`}
                    className="group flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-medship-primary/50"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: b.accent }}
                      />
                      <span className="truncate text-sm font-medium text-card-foreground transition-colors group-hover:text-medship-primary">
                        {b.name}
                      </span>
                    </span>
                    <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">
                      {s ? `${s.done}/${s.total}` : '0/0'}
                    </span>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
