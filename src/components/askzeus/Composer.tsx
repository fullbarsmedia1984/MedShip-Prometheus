'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatStatus } from './useAskZeusChat'

export function Composer({
  status,
  onSend,
  onStop,
}: {
  status: ChatStatus
  onSend: (message: string) => void
  onStop: () => void
}) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const streaming = status === 'streaming'

  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [])

  useEffect(() => {
    resize()
  }, [value, resize])

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || streaming) return
    setValue('')
    onSend(trimmed)
  }, [onSend, streaming, value])

  return (
    <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder="Ask about orders, customers, inventory, the warehouse…"
            aria-label="Message AskZeus"
            className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 pr-12 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-medship-primary/60 focus:ring-2 focus:ring-medship-primary/20"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
            >
              <Square className="h-3.5 w-3.5" fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim()}
              aria-label="Send message"
              className={cn(
                'absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-full transition-all',
                value.trim()
                  ? 'bg-gradient-to-br from-medship-primary to-medship-primary-dark text-white shadow-md hover:shadow-lg'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <p className="mx-auto mt-1.5 w-full max-w-3xl text-center text-[11px] text-muted-foreground">
        AskZeus answers from live Zeus data. Verify important numbers before acting —
        Enter to send, Shift+Enter for a new line.
      </p>
    </div>
  )
}
