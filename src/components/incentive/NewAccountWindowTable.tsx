'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatUsd } from '@/lib/incentive/calculator'
import type { RepNewAccount } from '@/lib/incentive/types'

function daysLeftClass(daysLeft: number): string {
  if (daysLeft <= 7) return 'text-red-600 font-semibold'
  if (daysLeft <= 30) return 'text-amber-600 font-medium'
  return 'text-muted-foreground'
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function NewAccountWindowTable({ accounts }: { accounts: RepNewAccount[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-info/10">
            <Users className="h-4 w-4 text-medship-info" />
          </span>
          New-Customer Accounts (365-Day Window)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Every completed order inside a customer&apos;s 365-day window earns the premium new-business rate.
        </p>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No new-customer accounts in an active window yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>First order</TableHead>
                <TableHead>Window ends</TableHead>
                <TableHead className="text-right">Days left</TableHead>
                <TableHead className="text-right">Window revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.canonicalKey}>
                  <TableCell className="font-medium">{account.institution ?? account.canonicalKey}</TableCell>
                  <TableCell>{formatDate(account.firstOrderAt)}</TableCell>
                  <TableCell>{formatDate(account.windowEnd)}</TableCell>
                  <TableCell className={cn('text-right', daysLeftClass(account.daysLeft))}>
                    {account.daysLeft}
                  </TableCell>
                  <TableCell className="text-right">{formatUsd(account.revenueInWindow)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
