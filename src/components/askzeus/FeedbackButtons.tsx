'use client'

// Thumbs up/down under each completed assistant reply. Ratings land in
// askzeus_feedback — the QA signal for improving tools and prompts.

import { useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FeedbackButtons({
  conversationId,
  question,
  answerPreview,
}: {
  conversationId: string | null
  question: string
  answerPreview: string
}) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')
  const [commentSent, setCommentSent] = useState(false)

  const submit = (nextRating: 'up' | 'down', withComment?: string) => {
    void fetch('/api/askzeus/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: conversationId ?? undefined,
        rating: nextRating,
        comment: withComment || undefined,
        question,
        answerPreview,
      }),
    }).catch(() => null)
  }

  const rate = (nextRating: 'up' | 'down') => {
    if (rating) return
    setRating(nextRating)
    if (nextRating === 'down') {
      setShowComment(true)
      return // recorded on comment submit (or skip)
    }
    submit(nextRating)
  }

  const sendComment = (text: string) => {
    submit('down', text)
    setCommentSent(true)
    setShowComment(false)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => rate('up')}
          disabled={rating !== null}
          aria-label="Good answer"
          className={cn(
            'rounded p-1 transition-colors',
            rating === 'up'
              ? 'text-medship-success'
              : 'text-muted-foreground/60 hover:text-medship-success'
          )}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => rate('down')}
          disabled={rating !== null}
          aria-label="Bad answer"
          className={cn(
            'rounded p-1 transition-colors',
            rating === 'down'
              ? 'text-medship-danger'
              : 'text-muted-foreground/60 hover:text-medship-danger'
          )}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
        {rating === 'up' && (
          <span className="text-[11px] text-muted-foreground">Thanks!</span>
        )}
        {commentSent && (
          <span className="text-[11px] text-muted-foreground">
            Thanks — this helps improve AskZeus.
          </span>
        )}
      </div>
      {showComment && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            sendComment(comment.trim())
          }}
        >
          <input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1000}
            autoFocus
            placeholder="What was wrong? (optional)"
            className="w-64 rounded-md border border-border bg-card px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:border-medship-primary/60"
          />
          <button
            type="submit"
            className="rounded-md bg-medship-primary px-2 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            Send
          </button>
        </form>
      )}
    </div>
  )
}
