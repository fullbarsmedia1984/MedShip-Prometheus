'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { TriangleAlert, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FeedbackButtons } from './FeedbackButtons'
import { Markdown } from './Markdown'
import { ToolActivityChip } from './ToolActivityChip'
import type { AssistantTurn, ChatTurn } from './useAskZeusChat'

function ZeusAvatar({ active }: { active: boolean }) {
  return (
    <div
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-medship-primary to-medship-primary-dark text-white shadow-sm',
        active && 'animate-pulse'
      )}
    >
      <Zap className="h-3.5 w-3.5" fill="currentColor" />
    </div>
  )
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      Thinking
      <span className="inline-flex gap-0.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1 w-1 animate-bounce rounded-full bg-medship-primary"
            style={{ animationDelay: `${index * 150}ms` }}
          />
        ))}
      </span>
    </span>
  )
}

function AssistantBubble({
  turn,
  conversationId,
  question,
}: {
  turn: AssistantTurn
  conversationId: string | null
  question: string
}) {
  const showThinking = turn.streaming && turn.thinking && !turn.text
  const showWaiting =
    turn.streaming && !turn.thinking && !turn.text && turn.activities.every((a) => a.done)

  return (
    <div className="flex items-start gap-3">
      <ZeusAvatar active={turn.streaming} />
      <div className="min-w-0 flex-1 space-y-2">
        {turn.activities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {turn.activities.map((activity) => (
              <ToolActivityChip key={activity.toolUseId} activity={activity} />
            ))}
          </div>
        )}
        {(showThinking || showWaiting) && <ThinkingDots />}
        {turn.text && (
          <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-card-foreground shadow-sm">
            <Markdown text={turn.text} />
            {turn.streaming && (
              <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse rounded bg-medship-primary align-text-bottom" />
            )}
          </div>
        )}
        {turn.error && (
          <div className="flex items-start gap-2 rounded-xl border border-medship-danger/30 bg-medship-danger/5 px-3 py-2 text-xs text-medship-danger">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{turn.error}</span>
          </div>
        )}
        {!turn.streaming && turn.text && (
          <FeedbackButtons
            conversationId={conversationId}
            question={question}
            answerPreview={turn.text.slice(0, 1000)}
          />
        )}
      </div>
    </div>
  )
}

export function MessageList({
  turns,
  conversationId,
}: {
  turns: ChatTurn[]
  conversationId: string | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  // Auto-scroll while pinned to the bottom; release when the user scrolls up.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      setPinned(distance < 80)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (el && pinned) {
      el.scrollTop = el.scrollHeight
    }
  }, [turns, pinned])

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
        {turns.map((turn, index) =>
          turn.kind === 'user' ? (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="flex justify-end"
            >
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-medship-primary px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
                {turn.text}
              </div>
            </motion.div>
          ) : (
            <AssistantBubble
              key={index}
              turn={turn}
              conversationId={conversationId}
              question={(() => {
                for (let i = index - 1; i >= 0; i--) {
                  const prev = turns[i]
                  if (prev.kind === 'user') return prev.text
                }
                return ''
              })()}
            />
          )
        )}
      </div>
    </div>
  )
}
