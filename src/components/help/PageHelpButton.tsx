'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { motion } from 'motion/react'
import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { OPEN_CHANGELOG_EVENT } from '@/lib/help/changelog'
import { findGuideForPath } from '@/lib/help/user-guides'

/**
 * Question-mark button in the page header. Shows the current page's guide
 * when one exists in the registry; hidden otherwise.
 */
export function PageHelpButton() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const guide = findGuideForPath(pathname ?? '')

  if (!guide) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-[0.625rem] text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        aria-label="Open page guide"
        title="Page guide"
      >
        <CircleHelp className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-xl"
          aria-label={`Guide: ${guide.title}`}
        >
          <div className="border-b border-border px-6 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-medship-primary">Page guide</p>
            <h2 className="mt-1 text-lg font-semibold text-popover-foreground">{guide.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{guide.intro}</p>
          </div>

          <div className="max-h-[55vh] space-y-5 overflow-y-auto px-6 py-5">
            {guide.sections.map((section, index) => (
              <motion.section
                key={section.heading}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + index * 0.08, duration: 0.3, ease: 'easeOut' }}
              >
                <h3 className="flex items-center gap-2 text-sm font-semibold text-popover-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1C3C6E] text-[0.65rem] font-bold text-white">
                    {index + 1}
                  </span>
                  {section.heading}
                </h3>
                {section.text && <p className="mt-1.5 pl-7 text-sm text-muted-foreground">{section.text}</p>}
                {section.steps && (
                  <ul className="mt-1.5 space-y-1.5 pl-7 text-sm text-muted-foreground">
                    {section.steps.map((step) => (
                      <li key={step} className="relative pl-4">
                        <span className="absolute left-0 top-[0.5em] h-1.5 w-1.5 rounded-full bg-medship-primary/60" aria-hidden />
                        {step}
                      </li>
                    ))}
                  </ul>
                )}
              </motion.section>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOpen(false)
                window.dispatchEvent(new Event(OPEN_CHANGELOG_EVENT))
              }}
            >
              What&apos;s new
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
