import { initials } from '@/lib/kanban/ui'

export function KanbanAvatar({
  name,
  color,
  size = 24,
  ring = false,
}: {
  name: string
  color: string
  size?: number
  ring?: boolean
}) {
  return (
    <span
      title={name}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-mono font-semibold text-white ${
        ring ? 'ring-2 ring-card' : ''
      }`}
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.max(9, size * 0.38),
      }}
    >
      {initials(name)}
    </span>
  )
}
