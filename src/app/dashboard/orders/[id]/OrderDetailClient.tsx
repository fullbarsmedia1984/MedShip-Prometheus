'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CalendarDays,
  CircleDollarSign,
  FileText,
  PackageCheck,
  ShoppingCart,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchJson } from '@/lib/client-api'
import type { Order } from '@/lib/seed-data'
import { cn } from '@/lib/utils'

type OrderDetailResponse = {
  order: Order
}

interface OrderDetailClientProps {
  orderId: string
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

  const date = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`)
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

export function OrderDetailClient({ orderId }: OrderDetailClientProps) {
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function fetchOrder() {
      setLoading(true)
      setError(null)

      try {
        const data = await fetchJson<OrderDetailResponse>(
          `/api/dashboard/orders/${encodeURIComponent(orderId)}`
        )

        if (active) setOrder(data.order)
      } catch (err) {
        if (active) {
          setOrder(null)
          setError(err instanceof Error ? err.message : 'Unable to load order')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchOrder()

    return () => {
      active = false
    }
  }, [orderId])

  const itemCount = useMemo(
    () => order?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
    [order]
  )

  const lineItemsTotal = useMemo(
    () => order?.items.reduce((sum, item) => sum + item.total, 0) ?? 0,
    [order]
  )

  return (
    <>
      <Header title="Order Details" />
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/orders"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            <ArrowLeft className="h-4 w-4" />
            Orders
          </Link>
        </div>

        {loading ? (
          <Card className="shadow-sm">
            <CardContent>
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-medship-primary border-t-transparent" />
                <span className="ml-2 text-sm text-muted-foreground">Loading live order...</span>
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="shadow-sm">
            <CardContent>
              <EmptyState
                icon={FileText}
                title="Order not found"
                description={error}
                action={
                  <Link
                    href="/dashboard/orders"
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  >
                    Back to orders
                  </Link>
                }
              />
            </CardContent>
          </Card>
        ) : order ? (
          <div className="space-y-6">
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryMetric
                icon={ShoppingCart}
                label="Order"
                value={<span className="font-mono">{order.orderNumber}</span>}
              />
              <SummaryMetric
                icon={CircleDollarSign}
                label="Subtotal"
                value={formatCurrency(order.subtotal)}
              />
              <SummaryMetric
                icon={PackageCheck}
                label="Fulfillment"
                value={<StatusBadge status={order.fulfillmentStatus} variant="dot" />}
              />
              <SummaryMetric
                icon={CalendarDays}
                label="Order Date"
                value={formatDate(order.date)}
              />
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Order Summary</CardTitle>
                  <CardDescription>Live Salesforce and Fishbowl-linked order fields.</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <DetailField label="Customer" value={order.customerName} />
                    <DetailField label="Customer ID" value={order.customerId || 'Not available'} mono />
                    <DetailField label="Sales Rep" value={order.salesRepName} />
                    <DetailField label="Sales Rep ID" value={order.salesRepId || 'Not available'} mono />
                    <DetailField label="Status" value={<StatusBadge status={order.status} />} />
                    <DetailField label="Fulfillment State" value={<StatusBadge status={order.fulfillmentStatus} variant="dot" />} />
                    <DetailField label="Opportunity ID" value={order.id} mono />
                    <DetailField label="Tracking Number" value={order.trackingNumber ?? 'Not available'} mono />
                    <DetailField label="Line Units" value={itemCount.toLocaleString('en-US')} />
                  </dl>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Totals</CardTitle>
                  <CardDescription>Only live totals currently exposed by the order feed.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-muted-foreground">Line items total</span>
                      <span className="font-medium tabular-nums">{formatCurrency(lineItemsTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-muted-foreground">Order subtotal</span>
                      <span className="font-medium tabular-nums">{formatCurrency(order.subtotal)}</span>
                    </div>
                    <div className="border-t pt-3">
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-medium text-foreground">Current total</span>
                        <span className="text-lg font-semibold tabular-nums text-foreground">
                          {formatCurrency(order.subtotal)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Tax, freight, discounts, payments, and invoice balances are not yet available in the live dashboard order feed.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Line Items</CardTitle>
                <CardDescription>{order.items.length.toLocaleString('en-US')} live item rows on this order.</CardDescription>
              </CardHeader>
              <CardContent>
                {order.items.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.items.map((item, index) => (
                        <TableRow key={`${item.productId}-${index}`}>
                          <TableCell className="font-medium whitespace-normal">{item.productName}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{item.sku || '-'}</TableCell>
                          <TableCell className="text-right tabular-nums">{item.quantity.toLocaleString('en-US')}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(item.unitPrice)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatCurrency(item.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4} className="text-right">Subtotal</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(order.subtotal)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                ) : (
                  <EmptyState
                    icon={ShoppingCart}
                    title="No live line items"
                    description="This order exists in the live feed, but no Salesforce opportunity line items are available yet."
                  />
                )}
              </CardContent>
            </Card>

            <ComingSoonPanel
              title="Additional order sections coming soon"
              description="Shipment events, invoice/payment history, tax and freight breakdowns, customer contacts, and fulfillment documents will appear here once those live fields are connected."
            />
          </div>
        ) : null}
      </main>
    </>
  )
}
