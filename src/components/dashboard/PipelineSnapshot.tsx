'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { SeedPipelineStage } from '@/lib/seed-data'

interface PipelineSnapshotProps {
  stages: SeedPipelineStage[]
}

export function PipelineSnapshot({ stages }: PipelineSnapshotProps) {
  const openStages = stages.filter(s => s.stage !== 'Closed Won' && s.stage !== 'Closed Lost')
  const totalValue = openStages.reduce((sum, s) => sum + s.value, 0)
  const closedWon = stages.find(s => s.stage === 'Closed Won')
  const closedLost = stages.find(s => s.stage === 'Closed Lost')

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Pipeline Snapshot</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between">
        {/* Pipeline funnel bars */}
        <div className="space-y-3">
          {openStages.map((stage) => {
            const pct = totalValue > 0 ? (stage.value / totalValue) * 100 : 0
            return (
              <div key={stage.stage}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[0.75rem] font-medium text-card-foreground">{stage.stage}</span>
                  <span className="text-[0.7rem] tabular-nums text-muted-foreground">
                    {stage.count} deals &middot; ${(stage.value / 1000).toFixed(0)}k
                  </span>
                </div>
                <div className="h-4 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max(pct, 4)}%`,
                      backgroundColor: stage.color,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* Total pipeline + outcomes */}
        <div className="mt-6 space-y-2 border-t border-border/50 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-[0.8rem] font-semibold text-card-foreground">Open Pipeline</span>
            <span className="text-[0.9rem] font-bold tabular-nums text-medship-primary">
              ${(totalValue / 1000).toFixed(0)}k
            </span>
          </div>
          <div className="flex gap-4">
            {closedWon && (
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: closedWon.color }} />
                <span className="text-[0.7rem] text-muted-foreground">Won: <span className="font-semibold text-emerald-600">${(closedWon.value / 1000).toFixed(0)}k</span> ({closedWon.count})</span>
              </div>
            )}
            {closedLost && (
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: closedLost.color }} />
                <span className="text-[0.7rem] text-muted-foreground">Lost: <span className="font-semibold text-red-500">${(closedLost.value / 1000).toFixed(0)}k</span> ({closedLost.count})</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
