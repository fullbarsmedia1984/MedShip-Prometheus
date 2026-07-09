import type { KanbanPriority } from './types'

export const KANBAN_PRIORITY_META: Record<
  KanbanPriority,
  { label: string; color: string; rank: number }
> = {
  urgent: { label: 'URGENT', color: '#D93025', rank: 3 },
  high: { label: 'HIGH', color: '#E89C0C', rank: 2 },
  medium: { label: 'MED', color: '#1E98D5', rank: 1 },
  low: { label: 'LOW', color: '#8A9BA5', rank: 0 },
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function formatDue(dateStr: string): {
  text: string
  overdue: boolean
  soon: boolean
} {
  const due = new Date(dateStr + (dateStr.length === 10 ? 'T23:59:59' : ''))
  const now = new Date()
  const days = Math.ceil((due.getTime() - now.getTime()) / 86400000)
  const text = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return { text, overdue: days < 0, soon: days >= 0 && days <= 2 }
}

export function timeAgo(dateStr: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
