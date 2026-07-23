'use client'

import { motion } from 'motion/react'
import {
  Boxes,
  LineChart,
  PackageSearch,
  Receipt,
  Trophy,
  Truck,
  Users,
  Zap,
} from 'lucide-react'
import type { AppRole } from '@/lib/auth'
import type { LucideIcon } from 'lucide-react'

interface StarterPrompt {
  icon: LucideIcon
  title: string
  prompt: string
}

const STAFF_PROMPTS: StarterPrompt[] = [
  {
    icon: LineChart,
    title: 'Revenue check',
    prompt: 'How is revenue this month compared to the same point last year?',
  },
  {
    icon: Users,
    title: 'Customer history',
    prompt: 'Summarize our biggest customers by revenue this year.',
  },
  {
    icon: Boxes,
    title: 'Stock alerts',
    prompt: 'Which items are at or below their reorder point right now?',
  },
  {
    icon: Trophy,
    title: 'Rep leaderboard',
    prompt: 'Who are the top sales reps this month, and how do they compare YTD?',
  },
]

const SALES_REP_PROMPTS: StarterPrompt[] = [
  {
    icon: Receipt,
    title: 'My open quotes',
    prompt: 'Show my open quotes and how long each has been waiting.',
  },
  {
    icon: Users,
    title: 'My customers',
    prompt: 'Summarize my top customers by revenue and when they last ordered.',
  },
  {
    icon: PackageSearch,
    title: 'Order lookup',
    prompt: 'What are my most recent orders and their statuses?',
  },
  {
    icon: Boxes,
    title: 'Source a product',
    prompt: 'Search the supplier catalog for nitrile exam gloves and compare vendor pricing.',
  },
]

const WAREHOUSE_PROMPTS: StarterPrompt[] = [
  {
    icon: Truck,
    title: 'Receiving today',
    prompt: 'What was received today, and are any parts needed by open orders?',
  },
  {
    icon: PackageSearch,
    title: 'Ready to pick',
    prompt: 'Which orders are ready to pick right now, oldest first?',
  },
  {
    icon: Boxes,
    title: 'Stock check',
    prompt: 'Which items are low or out of stock?',
  },
  {
    icon: Zap,
    title: 'Late orders',
    prompt: 'Which orders are past their scheduled date, and what is blocking them?',
  },
]

function promptsForRole(role: AppRole): StarterPrompt[] {
  if (role === 'warehouse') return WAREHOUSE_PROMPTS
  if (role === 'sales_rep') return SALES_REP_PROMPTS
  return STAFF_PROMPTS
}

export function StarterPrompts({
  role,
  onPick,
}: {
  role: AppRole
  onPick: (prompt: string) => void
}) {
  const prompts = promptsForRole(role)
  return (
    <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
      {prompts.map((prompt, index) => (
        <motion.button
          key={prompt.title}
          type="button"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 + index * 0.07, duration: 0.3, ease: 'easeOut' }}
          onClick={() => onPick(prompt.prompt)}
          className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-medship-primary/50 hover:bg-medship-primary/5"
        >
          <span className="mt-0.5 rounded-lg bg-medship-primary/10 p-2 text-medship-primary transition-colors group-hover:bg-medship-primary/15">
            <prompt.icon className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-foreground">
              {prompt.title}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              {prompt.prompt}
            </span>
          </span>
        </motion.button>
      ))}
    </div>
  )
}
