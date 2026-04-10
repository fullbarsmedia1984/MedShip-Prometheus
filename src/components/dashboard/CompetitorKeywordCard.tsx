'use client'

import { cn } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Radar, Phone } from 'lucide-react'

interface KeywordData {
  keyword: string
  mentions: number
  calls: number
  type: 'competitor' | 'budget' | 'objection' | 'product'
}

interface CompetitorKeywordCardProps {
  keywords: KeywordData[]
  onKeywordClick?: (keyword: string) => void
}

const typeConfig: Record<KeywordData['type'], {
  bar: string
  badge: string
  text: string
  label: string
  glow: string
}> = {
  competitor: {
    bar: 'from-red-500/80 to-orange-400/60',
    badge: 'bg-red-500/12 text-red-600 border-red-500/15',
    text: 'text-red-600',
    label: 'Competitor',
    glow: 'shadow-red-500/10',
  },
  budget: {
    bar: 'from-emerald-500/80 to-green-400/60',
    badge: 'bg-emerald-500/12 text-emerald-600 border-emerald-500/15',
    text: 'text-emerald-600',
    label: 'Budget Signal',
    glow: 'shadow-emerald-500/10',
  },
  objection: {
    bar: 'from-amber-500/80 to-yellow-400/60',
    badge: 'bg-amber-500/12 text-amber-600 border-amber-500/15',
    text: 'text-amber-600',
    label: 'Objection',
    glow: 'shadow-amber-500/10',
  },
  product: {
    bar: 'from-blue-500/80 to-sky-400/60',
    badge: 'bg-blue-500/12 text-blue-600 border-blue-500/15',
    text: 'text-blue-600',
    label: 'Product',
    glow: 'shadow-blue-500/10',
  },
}

export function CompetitorKeywordCard({ keywords, onKeywordClick }: CompetitorKeywordCardProps) {
  const maxMentions = keywords.length > 0 ? keywords[0].mentions : 1
  const totalMentions = keywords.reduce((s, k) => s + k.mentions, 0)
  const totalCalls = new Set(keywords.flatMap((k) => Array.from({ length: k.calls }, (_, i) => `${k.keyword}-${i}`))).size

  return (
    <Card className="overflow-hidden border-medship-danger/20 shadow-lg">
      <CardHeader className="border-b border-border/50 bg-gradient-to-r from-medship-danger/[0.06] via-medship-danger/[0.02] to-transparent pb-4">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-danger/10">
                <Radar className="h-4 w-4 text-medship-danger" />
              </span>
              Competitor Intelligence
            </CardTitle>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Top keywords from RingDNA call recordings
            </p>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <p className="text-lg font-bold tabular-nums text-card-foreground">{totalMentions}</p>
              <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">Mentions</p>
            </div>
            <div className="h-8 w-px bg-border/50" />
            <div>
              <p className="text-lg font-bold tabular-nums text-card-foreground">{keywords.length}</p>
              <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">Keywords</p>
            </div>
          </div>
        </div>

        {/* Type legend */}
        <div className="mt-3 flex flex-wrap gap-2">
          {(['competitor', 'budget', 'product', 'objection'] as const).map((type) => {
            const config = typeConfig[type]
            return (
              <span
                key={type}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider',
                  config.badge
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full bg-current')} />
                {config.label}
              </span>
            )
          })}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="divide-y divide-border/30">
          {keywords.map((kw, i) => {
            const config = typeConfig[kw.type]
            const barWidth = (kw.mentions / maxMentions) * 100

            return (
              <div
                key={kw.keyword}
                className={cn(
                  'group flex items-center gap-3 px-5 py-2.5 transition-colors',
                  onKeywordClick && 'cursor-pointer hover:bg-muted/40'
                )}
                onClick={() => onKeywordClick?.(kw.keyword)}
              >
                {/* Rank */}
                <span className="w-5 shrink-0 text-center text-[0.65rem] font-semibold tabular-nums text-muted-foreground/60">
                  {i + 1}
                </span>

                {/* Keyword + type badge */}
                <div className="w-[140px] shrink-0">
                  <span className={cn(
                    'text-sm font-semibold text-card-foreground transition-colors',
                    onKeywordClick && 'group-hover:text-medship-primary'
                  )}>
                    {kw.keyword}
                  </span>
                </div>

                {/* Bar */}
                <div className="relative flex-1">
                  <div className="h-5 w-full overflow-hidden rounded bg-muted/30">
                    <div
                      className={cn(
                        'h-full rounded bg-gradient-to-r transition-all duration-700',
                        config.bar
                      )}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>

                {/* Stats */}
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <span className="text-sm font-bold tabular-nums text-card-foreground">{kw.mentions}</span>
                    <span className="ml-1 text-[0.6rem] text-muted-foreground">mentions</span>
                  </div>
                  <div className="flex items-center gap-1 text-right">
                    <Phone className="h-3 w-3 text-muted-foreground/50" />
                    <span className="text-xs tabular-nums text-muted-foreground">{kw.calls}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {keywords.length === 0 && (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No keyword data available
          </div>
        )}
      </CardContent>
    </Card>
  )
}
