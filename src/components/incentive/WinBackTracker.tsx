'use client'

import { RotateCcw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatUsd } from '@/lib/incentive/calculator'
import type { OrderIncentiveDetailRow } from '@/lib/incentive/types'

interface WinBackTrackerProps {
  count: number
  revenue: number
  orders: OrderIncentiveDetailRow[]
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function WinBackTracker({ count, revenue, orders }: WinBackTrackerProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2.5 text-base">
          <span className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-warning/10">
              <RotateCcw className="h-4 w-4 text-medship-warning" />
            </span>
            Win-Backs (Promo Period)
          </span>
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700">
            Pays 5% for 365 days
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Customers who lapsed 365+ days and reordered: {count} orders, {formatUsd(revenue)} revenue. Winback
          revenue pays the 5% rate for 365 days after re-entry (does not count toward the enrollment quota).
        </p>
      </CardHeader>
      <CardContent>
        {orders.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No win-back orders in the promo period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SO</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Rep</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Gap (days)</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.slice(0, 15).map((order) => (
                <TableRow key={order.so_number}>
                  <TableCell className="font-mono text-xs">{order.so_number}</TableCell>
                  <TableCell className="font-medium">{order.customer_name ?? '—'}</TableCell>
                  <TableCell>{order.rep_display_name ?? order.salesperson_raw ?? '—'}</TableCell>
                  <TableCell>{formatDate(order.order_at)}</TableCell>
                  <TableCell className="text-right">{order.prior_gap_days ?? '—'}</TableCell>
                  <TableCell className="text-right">{formatUsd(order.net_amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
