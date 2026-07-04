'use client'

import { useEffect, useRef, useState } from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SummaryCardOption = {
  id: string
  label: string
}

type SummaryCardPickerProps = {
  options: SummaryCardOption[]
  visibleIds: string[]
  defaultIds: string[]
  onChange: (ids: string[]) => void
}

/**
 * Compact "customize" popover for the dashboard summary card row. Selection
 * order always follows the registry order, so toggling never reshuffles cards.
 */
export function SummaryCardPicker({ options, visibleIds, defaultIds, onChange }: SummaryCardPickerProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const toggle = (id: string) => {
    const next = visibleIds.includes(id)
      ? visibleIds.filter((current) => current !== id)
      : options.map((option) => option.id).filter((optionId) => optionId === id || visibleIds.includes(optionId))
    if (next.length === 0) return
    onChange(next)
  }

  const isDefault =
    visibleIds.length === defaultIds.length && defaultIds.every((id) => visibleIds.includes(id))

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="gap-1.5 text-muted-foreground hover:text-card-foreground"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Customize
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums text-muted-foreground">
          {visibleIds.length}/{options.length}
        </span>
      </Button>

      {open && (
        <>
          {/* Click-outside catcher */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Choose summary cards"
            className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[0.625rem] border border-border bg-popover shadow-lg"
          >
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-popover-foreground">Summary cards</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Choose which KPIs appear at the top of this page.
              </p>
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {options.map((option) => {
                const checked = visibleIds.includes(option.id)
                const isLastChecked = checked && visibleIds.length === 1
                return (
                  <label
                    key={option.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 px-4 py-2 text-sm transition-colors hover:bg-muted/50',
                      isLastChecked && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isLastChecked}
                      onChange={() => toggle(option.id)}
                      className="h-4 w-4 shrink-0 accent-medship-primary"
                    />
                    <span className="min-w-0 truncate text-popover-foreground">{option.label}</span>
                  </label>
                )
              })}
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
              <span className="text-xs text-muted-foreground">
                {visibleIds.length} of {options.length} shown
              </span>
              <button
                type="button"
                onClick={() => onChange(defaultIds)}
                disabled={isDefault}
                className={cn(
                  'inline-flex items-center gap-1 text-xs font-medium transition-colors',
                  isDefault
                    ? 'cursor-default text-muted-foreground/50'
                    : 'text-medship-primary hover:text-medship-primary/80'
                )}
              >
                <RotateCcw className="h-3 w-3" />
                Reset to default
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
