'use client'

import { motion } from 'motion/react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatActivity } from './useAskZeusChat'

export function ToolActivityChip({ activity }: { activity: ChatActivity }) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        !activity.done &&
          'border-medship-primary/40 bg-medship-primary/10 text-medship-primary',
        activity.done &&
          activity.ok !== false &&
          'border-border bg-muted/60 text-muted-foreground',
        activity.done &&
          activity.ok === false &&
          'border-medship-danger/40 bg-medship-danger/10 text-medship-danger'
      )}
    >
      {!activity.done ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : activity.ok === false ? (
        <TriangleAlert className="h-3 w-3" />
      ) : (
        <Check className="h-3 w-3 text-medship-success" />
      )}
      <span>
        {activity.done && activity.resultSummary
          ? activity.resultSummary
          : activity.label}
      </span>
    </motion.span>
  )
}
