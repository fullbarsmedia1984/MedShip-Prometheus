'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import {
  CHANGELOG,
  getUnseenChangelogEntries,
  markChangelogSeen,
  OPEN_CHANGELOG_EVENT,
  type ChangelogEntry,
} from '@/lib/help/changelog'

function formatDate(iso: string) {
  const date = new Date(`${iso}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/**
 * Auto-opens once per user when new deployment changelog entries exist
 * (seen-state in localStorage). Can be reopened from anywhere by dispatching
 * OPEN_CHANGELOG_EVENT — reopening shows the full history.
 */
export function ChangelogDialog() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<ChangelogEntry[]>([])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const unseen = getUnseenChangelogEntries()
      if (unseen.length > 0) {
        setEntries(unseen)
        setOpen(true)
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const reopen = () => {
      setEntries(CHANGELOG)
      setOpen(true)
    }
    window.addEventListener(OPEN_CHANGELOG_EVENT, reopen)
    return () => window.removeEventListener(OPEN_CHANGELOG_EVENT, reopen)
  }, [])

  const dismiss = useCallback(() => {
    markChangelogSeen(entries.map((entry) => entry.id))
    setOpen(false)
  }, [entries])

  if (entries.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-lg"
        aria-label="What's new in Zeus"
      >
        {/* Brand header band: MedShip dark blue with a faint cross-motif grid */}
        <div
          className="relative px-6 py-5 text-white"
          style={{
            backgroundColor: '#1C3C6E',
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.14) 1px, transparent 0), linear-gradient(135deg, rgba(30,152,213,0.35), transparent 60%)',
            backgroundSize: '14px 14px, 100% 100%',
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#0FA62C]" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">Zeus update</p>
          </div>
          <h2 className="mt-1 text-xl font-semibold">What&apos;s new</h2>
          <p className="mt-1 text-sm text-white/75">
            {entries.length === 1 ? 'One change' : `${entries.length} changes`} since your last visit.
          </p>
        </div>

        {/* Entry timeline */}
        <div className="max-h-[55vh] overflow-y-auto px-6 py-5">
          <ol className="relative space-y-6 border-l border-border pl-5">
            {entries.map((entry, index) => (
              <motion.li
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + index * 0.12, duration: 0.35, ease: 'easeOut' }}
                className="relative"
              >
                <span
                  className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-medship-success ring-4 ring-medship-success/15"
                  aria-hidden
                />
                <p className="text-xs text-muted-foreground">{formatDate(entry.date)}</p>
                <h3 className="mt-0.5 text-sm font-semibold text-popover-foreground">{entry.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{entry.summary}</p>
                {entry.details && entry.details.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                    {entry.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                )}
                {entry.areas.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.areas.map((area) => (
                      <Link key={area.href + area.label} href={area.href} onClick={dismiss}>
                        <Badge
                          variant="outline"
                          className="border-medship-primary/30 bg-medship-primary/10 text-medship-primary hover:bg-medship-primary/20"
                        >
                          {area.label}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                )}
              </motion.li>
            ))}
          </ol>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-4">
          <p className="text-xs text-muted-foreground">
            Reopen any time from the page-guide (?) menu.
          </p>
          <Button size="sm" onClick={dismiss}>
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
