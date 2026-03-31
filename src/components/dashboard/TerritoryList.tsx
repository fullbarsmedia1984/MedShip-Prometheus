'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusBadge } from './StatusBadge'
import type { Customer } from '@/lib/seed-data'

interface TerritoryListProps {
  customers: Customer[]
  onCustomerClick?: (customer: Customer) => void
  selectedCustomerId?: string
}

const REP_COLORS: Record<string, string> = {
  'Sarah Mitchell': '#452B90',
  'James Thornton': '#3A9B94',
  'Maria Gonzalez': '#F8B940',
  'David Kim': '#58BAD7',
  'Lisa Chen': '#FF9F00',
}

type FilterStatus = 'all' | 'active' | 'inactive' | 'prospect'

export function TerritoryList({ customers, onCustomerClick, selectedCustomerId }: TerritoryListProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterStatus>('all')

  let filtered = [...customers]

  if (filter !== 'all') {
    filtered = filtered.filter((c) => c.customerStatus === filter)
  }
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(
      (c) => c.name.toLowerCase().includes(q) || c.state.toLowerCase().includes(q) || c.city.toLowerCase().includes(q)
    )
  }

  filtered.sort((a, b) => b.totalRevenue - a.totalRevenue)

  const filterButtons: { label: string; value: FilterStatus }[] = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Prospect', value: 'prospect' },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, city, state..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-[0.8rem] placeholder:text-muted-foreground/60 focus:border-medship-primary focus:outline-none focus:ring-1 focus:ring-medship-primary/30"
        />
      </div>

      {/* Filter buttons */}
      <div className="mb-3 flex gap-1">
        {filterButtons.map((btn) => (
          <button
            key={btn.value}
            onClick={() => setFilter(btn.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[0.7rem] font-medium transition-colors',
              filter === btn.value
                ? 'bg-medship-primary text-white'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted'
            )}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1">
          {filtered.map((customer) => {
            const repColor = REP_COLORS[customer.assignedRep] || '#888'
            const isSelected = customer.id === selectedCustomerId

            return (
              <button
                key={customer.id}
                onClick={() => onCustomerClick?.(customer)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors',
                  isSelected
                    ? 'bg-medship-primary/8 ring-1 ring-medship-primary/20'
                    : 'hover:bg-muted/50'
                )}
              >
                {/* Rep initial circle */}
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.55rem] font-bold text-white"
                  style={{ backgroundColor: repColor }}
                >
                  {customer.assignedRep.split(' ').map(n => n[0]).join('')}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.78rem] font-medium leading-tight text-card-foreground">
                    {customer.name}
                  </p>
                  <p className="text-[0.65rem] text-muted-foreground">
                    {customer.city}, {customer.state}
                  </p>
                </div>

                {/* Revenue + status */}
                <div className="shrink-0 text-right">
                  <p className="text-[0.75rem] font-semibold tabular-nums text-card-foreground">
                    {customer.totalRevenue > 0 ? `$${Math.round(customer.totalRevenue / 1000)}k` : '—'}
                  </p>
                  <StatusBadge status={customer.customerStatus === 'active' ? 'connected' : customer.customerStatus === 'prospect' ? 'pending' : 'disconnected'} />
                </div>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No customers match your search.</p>
          )}
        </div>
      </div>
    </div>
  )
}
