'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { HelpCircle } from 'lucide-react'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-card-foreground">{title}</h3>
      <div className="space-y-1.5 text-[0.82rem] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

export function ReportingMethodologyDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="How these numbers are calculated"
          >
            <HelpCircle className="h-4 w-4" />
            Methodology
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>How sales reporting is calculated</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Section title="Revenue source & timing">
            <p>
              Revenue comes from <b>Fishbowl issued Sales Orders</b> only (quotes and voided
              orders are excluded; Salesforce is the source for pipeline). An order counts in the
              month its SO was <b>issued</b> — an SO issued May 25 is May revenue even if it ships
              in June. When an issue date isn&apos;t recorded yet, the completion date (then creation
              date) stands in until it arrives. Months follow America/Chicago time. Data syncs
              from Fishbowl every 15 minutes.
            </p>
          </Section>

          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[0.82rem] leading-relaxed text-muted-foreground">
            <b className="text-amber-700">One-time restatement (July 2026):</b> issue dates were
            backfilled for nearly all historical orders, which re-assigned past revenue from the
            month an order was <i>completed</i> to the month it was <i>issued</i>. Individual
            months shifted (revenue generally moved earlier — orders are issued a median of 13
            days before completion); company totals are unchanged to the dollar. Numbers from
            reports exported before July 2026 will not match month-for-month.
          </div>

          <Section title="New vs. Recurring business (order labels)">
            <p>
              Every order is labeled at sync time: an order from a customer with <b>no issued
              order in the prior 365 days</b> starts a new-business window, and all of that
              customer&apos;s orders in the following 365 days count as <b>New Business</b>. After the
              window, orders are <b>Recurring</b> as long as the customer keeps buying at least
              once every 365 days.
            </p>
          </Section>

          <Section title="Revenue cohorts (New / Winback / Recurring)">
            <p>The Revenue Cohorts section refines the labels above by distinguishing true first-time customers from returning ones:</p>
            <p>
              <Badge variant="outline" className="mr-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700">New</Badge>
              the customer has <b>never bought from us before, ever</b> (duplicate customer records
              are merged first, so a duplicate account can&apos;t look &quot;new&quot;). Their first SO opens a
              365-day New period; everything they buy inside it is New revenue.
            </p>
            <p>
              <Badge variant="outline" className="mr-1 border-amber-500/30 bg-amber-500/10 text-amber-700">Winback</Badge>
              the customer bought before but went <b>365+ days without a purchase</b>. The
              returning SO opens a 365-day Winback period. A customer re-enters Winback on every
              fresh 365-day lapse.
            </p>
            <p>
              <Badge variant="outline" className="mr-1 border-sky-500/30 bg-sky-500/10 text-sky-700">Recurring</Badge>
              everything else — steady business outside any New or Winback period. Customers with
              no purchase in 365+ days show as <b>Lapsed</b> (their next order will be a Winback).
            </p>
          </Section>

          <Section title="Rep attribution">
            <p>
              Each order credits the salesperson on the SO, resolved through the Fishbowl alias
              map. The leaderboard and rep charts show the <b>selected roster</b>; house-account
              and system aliases are tracked separately and never appear as reps. Orders whose
              salesperson isn&apos;t mapped yet are flagged in the alias panel below.
            </p>
          </Section>

          <Section title="Commissions are separate">
            <p>
              Incentive payouts (see the Incentives page) use their own engine built on the cohorts
              above: New-cohort revenue pays 6% and Winback 5% for 365 days, while the Recurring
              rate rides on each rep&apos;s monthly new-customer enrollment quota (4% at quota, 3% at
              one, 2% at zero), with eligibility exclusions. Changing how revenue displays here
              never changes commission math, and vice versa.
            </p>
          </Section>

          <p className="border-t pt-3 text-xs text-muted-foreground">
            Full technical reference: <code className="font-mono">docs/revenue-cohorts.md</code> in
            the Prometheus repo. Classifications recompute automatically within ~15 minutes of any
            data change.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
