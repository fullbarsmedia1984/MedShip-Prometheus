'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatUsd } from '@/lib/incentive/calculator'
import type { ExceptionsPayload } from '@/lib/incentive/queries'

interface SectionProps {
  title: string
  count: number
  children: React.ReactNode
  action?: { label: string; href: string }
}

function Section({ title, count, children, action }: SectionProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 py-3 text-left text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {title}
        </span>
        <Badge
          variant="outline"
          className={
            count > 0
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
          }
        >
          {count}
        </Badge>
      </button>
      {open && (
        <div className="pb-3 pl-6 text-sm">
          {children}
          {action && (
            <Link href={action.href} className="mt-2 inline-block text-xs font-medium text-medship-primary underline underline-offset-2">
              {action.label} →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

export function ExceptionsPanel({ exceptions }: { exceptions: ExceptionsPayload }) {
  const inPeriodUnmapped = exceptions.unmappedReps.filter((rep) => rep.order_count_in_period > 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-warning/10">
            <AlertTriangle className="h-4 w-4 text-medship-warning" />
          </span>
          Exceptions
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Data-quality items accounting reviews before any payout is trusted.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <Section
          title="Unmapped rep strings"
          count={exceptions.unmappedReps.length}
          action={{ label: 'Resolve in admin', href: '/dashboard/incentives/admin#aliases' }}
        >
          {exceptions.unmappedReps.length === 0 ? (
            <p className="text-muted-foreground">All salesperson strings are mapped.</p>
          ) : (
            <ul className="space-y-1">
              {exceptions.unmappedReps.slice(0, 10).map((rep) => (
                <li key={rep.fishbowl_salesperson} className="flex justify-between gap-3">
                  <span className="font-mono text-xs">{rep.fishbowl_salesperson}</span>
                  <span className="text-xs text-muted-foreground">
                    {rep.order_count_in_period} in-period / {rep.order_count_all_time} all-time
                  </span>
                </li>
              ))}
              {exceptions.unmappedReps.length > 10 && (
                <li className="text-xs text-muted-foreground">
                  +{exceptions.unmappedReps.length - 10} more ({inPeriodUnmapped.length} blocking)
                </li>
              )}
            </ul>
          )}
        </Section>

        <Section title="No-rep orders" count={exceptions.noRepOrders.count}>
          <p className="text-muted-foreground">
            {exceptions.noRepOrders.count} orders ({formatUsd(exceptions.noRepOrders.amount)}) have a blank
            salesperson — excluded from all rep incentive math.
          </p>
        </Section>

        <Section title="House / system orders" count={exceptions.houseOrders.count}>
          <p className="text-muted-foreground">
            {exceptions.houseOrders.count} orders ({formatUsd(exceptions.houseOrders.amount)}) belong to house or
            system identities — excluded from all rep incentive math.
          </p>
        </Section>

        <Section title="Header vs line-item divergences" count={exceptions.reconciliationCount}>
          {exceptions.reconciliationExceptions.length === 0 ? (
            <p className="text-muted-foreground">All order headers reconcile to their line items.</p>
          ) : (
            <ul className="space-y-1">
              {exceptions.reconciliationExceptions.slice(0, 10).map((row) => (
                <li key={row.so_number} className="flex justify-between gap-3">
                  <span className="truncate">
                    <span className="font-mono text-xs">{row.so_number}</span>{' '}
                    <span className="text-xs text-muted-foreground">{row.customer_name ?? ''}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Δ {formatUsd(row.divergence)}
                  </span>
                </li>
              ))}
              {exceptions.reconciliationCount > 10 && (
                <li className="text-xs text-muted-foreground">+{exceptions.reconciliationCount - 10} more</li>
              )}
            </ul>
          )}
        </Section>

        <Section
          title="Suspected new duplicates"
          count={exceptions.suspectedDuplicates.length}
          action={{ label: 'Review in admin', href: '/dashboard/incentives/admin#merge-map' }}
        >
          {exceptions.suspectedDuplicates.length === 0 ? (
            <p className="text-muted-foreground">No unreviewed duplicate candidates.</p>
          ) : (
            <ul className="space-y-1">
              {exceptions.suspectedDuplicates.slice(0, 10).map((pair) => (
                <li key={`${pair.key_a}|${pair.key_b}`} className="text-xs">
                  <span className="font-medium">{pair.name_a}</span> ↔{' '}
                  <span className="font-medium">{pair.name_b}</span>{' '}
                  <span className="text-muted-foreground">
                    ({pair.exact_normalized_match ? 'exact normalized match' : `similarity ${(pair.name_similarity ?? 0).toFixed(2)}`})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </CardContent>
    </Card>
  )
}
