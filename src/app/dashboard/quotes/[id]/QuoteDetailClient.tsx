'use client'

import { useEffect, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, CalendarDays, Clock3, DollarSign, FileText, UserRound } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { QuoteStatusBadge } from '@/components/dashboard/QuoteStatusBadge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchJson } from '@/lib/client-api'
import type { SeedQuote } from '@/lib/seed-data'
import { cn } from '@/lib/utils'

type QuoteDetailResponse = {
  quote: SeedQuote
}

type QuoteDetailClientProps = {
  quoteId: string
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(dateStr: string): string {
  if (!dateStr) return 'Not available'

  const date = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 'Not available'

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className={mono ? 'mt-1 truncate font-mono text-sm text-foreground' : 'mt-1 truncate text-sm text-foreground'}>
        {value}
      </dd>
    </div>
  )
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: ElementType
  label: string
  value: ReactNode
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-[0.625rem] bg-medship-primary/10 text-medship-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <div className="mt-1 truncate text-lg font-semibold text-foreground">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

export function QuoteDetailClient({ quoteId }: QuoteDetailClientProps) {
  const [quote, setQuote] = useState<SeedQuote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function fetchQuote() {
      setLoading(true)
      setError(null)

      try {
        const data = await fetchJson<QuoteDetailResponse>(
          `/api/dashboard/quotes/${encodeURIComponent(quoteId)}`
        )

        if (active) setQuote(data.quote)
      } catch (err) {
        if (active) {
          setQuote(null)
          setError(err instanceof Error ? err.message : 'Unable to load quote')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchQuote()

    return () => {
      active = false
    }
  }, [quoteId])

  return (
    <>
      <Header title="Quote Details" />
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/quotes"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            <ArrowLeft className="h-4 w-4" />
            Quotes
          </Link>
        </div>

        {loading ? (
          <Card className="shadow-sm">
            <CardContent>
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-medship-primary border-t-transparent" />
                <span className="ml-2 text-sm text-muted-foreground">Loading live quote...</span>
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="shadow-sm">
            <CardContent>
              <EmptyState
                icon={FileText}
                title="Quote not found"
                description={error}
                action={
                  <Link
                    href="/dashboard/quotes"
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  >
                    Back to quotes
                  </Link>
                }
              />
            </CardContent>
          </Card>
        ) : quote ? (
          <div className="space-y-6">
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryMetric
                icon={FileText}
                label="Quote"
                value={<span className="font-mono">{quote.id}</span>}
              />
              <SummaryMetric
                icon={DollarSign}
                label="Amount"
                value={formatCurrency(quote.amount)}
              />
              <SummaryMetric
                icon={Clock3}
                label="Days Open"
                value={`${quote.daysOpen}d`}
              />
              <SummaryMetric
                icon={CalendarDays}
                label="Quote Date"
                value={formatDate(quote.date)}
              />
            </section>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Quote Summary</CardTitle>
                <CardDescription>Live canonical Fishbowl quote header fields.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailField label="Quote Number" value={quote.id} mono />
                  <DetailField label="Customer" value={quote.customerName} />
                  <DetailField label="Sales Rep" value={quote.repName} />
                  <DetailField label="Status" value={<QuoteStatusBadge status={quote.status} />} />
                  <DetailField label="Amount" value={formatCurrency(quote.amount)} />
                  <DetailField label="Created" value={formatDate(quote.date)} />
                  <DetailField label="Age" value={`${quote.daysOpen.toLocaleString('en-US')} days`} />
                  <DetailField label="Source" value="Fishbowl canonical quote feed" />
                  <DetailField label="Owner" value={<span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{quote.repName}</span>} />
                </dl>
              </CardContent>
            </Card>

            <ComingSoonPanel
              title="Quote line items"
              description="Line-item detail, tax, freight, discounts, and document history will appear here once those live quote fields are exposed by the canonical helper."
            />
          </div>
        ) : null}
      </main>
    </>
  )
}
