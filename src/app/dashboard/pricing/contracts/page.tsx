'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FileText, Search } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchJson } from '@/lib/client-api'

type ContractRow = {
  id: string
  supplier_name: string
  contract_name: string | null
  contract_number: string | null
  status: string
  effective_date: string | null
  expiration_date: string | null
  updated_at: string
  active_line_count: number
  pending_line_count: number
}

const EXPIRING_SOON_DAYS = 60

function daysUntil(dateText: string | null): number | null {
  if (!dateText) return null
  const target = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function expirationBadge(expirationDate: string | null) {
  const days = daysUntil(expirationDate)
  if (days === null) return null
  if (days < 0) {
    return (
      <Badge variant="outline" className="ml-2 border-medship-danger/30 bg-medship-danger/10 text-medship-danger">
        Expired
      </Badge>
    )
  }
  if (days <= EXPIRING_SOON_DAYS) {
    return (
      <Badge variant="outline" className="ml-2 border-medship-warning/30 bg-medship-warning/10 text-medship-warning">
        {days === 0 ? 'Expires today' : `Expires in ${days}d`}
      </Badge>
    )
  }
  return null
}

function contractStatusBadge(status: string) {
  const className =
    status === 'active'
      ? 'border-medship-success/30 bg-medship-success/10 text-medship-success'
      : status === 'expired' || status === 'superseded'
        ? 'border-medship-warning/30 bg-medship-warning/10 text-medship-warning'
        : 'border-border bg-muted/60 text-muted-foreground'
  return <Badge variant="outline" className={className}>{status}</Badge>
}

export default function SupplierContractsPage() {
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<{ contracts: ContractRow[] }>('/api/pricing/supplier-contracts')
      setContracts(data.contracts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load supplier contracts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const totalActiveLines = contracts.reduce((sum, contract) => sum + contract.active_line_count, 0)
  const expiringSoonCount = contracts.filter((contract) => {
    const days = daysUntil(contract.expiration_date)
    return days !== null && days <= EXPIRING_SOON_DAYS
  }).length

  const visibleContracts = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return contracts
    return contracts.filter(
      (contract) =>
        contract.supplier_name.toLowerCase().includes(query) ||
        (contract.contract_number ?? '').toLowerCase().includes(query) ||
        (contract.contract_name ?? '').toLowerCase().includes(query)
    )
  }, [contracts, search])

  return (
    <>
      <Header title="Supplier Contracts" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-card-foreground">Contract Price Manager</h1>
                  <Badge variant="outline" className="border-medship-primary/30 bg-medship-primary/10 text-medship-primary">
                    Buy-Side Costs
                  </Badge>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  The system of record for negotiated supplier costs. Open a contract to view, add, correct,
                  or expire cost lines — every change is versioned and audited. Customer sell pricing is never touched.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="shadow-sm"><CardContent className="p-4"><p className="text-2xl font-semibold">{contracts.length.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Contracts</p></CardContent></Card>
          <Card className="shadow-sm"><CardContent className="p-4"><p className="text-2xl font-semibold">{contracts.filter((contract) => contract.status === 'active').length.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Active Contracts</p></CardContent></Card>
          <Card className="shadow-sm"><CardContent className="p-4"><p className="text-2xl font-semibold">{totalActiveLines.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Active Cost Lines</p></CardContent></Card>
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <p className={`text-2xl font-semibold ${expiringSoonCount > 0 ? 'text-medship-warning' : ''}`}>{expiringSoonCount.toLocaleString()}</p>
              <p className="text-xs uppercase text-muted-foreground">Expiring ≤ {EXPIRING_SOON_DAYS}d / Expired</p>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Contracts</CardTitle>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search supplier or contract #"
                  className="h-9 w-72 rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {error && (
              <p className="mb-4 rounded-md border border-medship-warning/25 bg-medship-warning/5 p-3 text-sm text-muted-foreground">{error}</p>
            )}
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading contracts...</p>
            ) : contracts.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No supplier contracts yet. Contracts are created when an imported price list is prepared for publish.
              </p>
            ) : visibleContracts.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No contracts match your search.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Contract #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Active Lines</TableHead>
                      <TableHead className="text-right">Pending Lines</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead>Expires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleContracts.map((contract) => (
                      <TableRow key={contract.id}>
                        <TableCell>
                          <Link href={`/dashboard/pricing/contracts/${contract.id}`} className="font-medium text-medship-primary hover:underline">
                            {contract.supplier_name}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{contract.contract_number ?? '-'}</TableCell>
                        <TableCell>{contractStatusBadge(contract.status)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{contract.active_line_count.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{contract.pending_line_count.toLocaleString()}</TableCell>
                        <TableCell className="text-sm">{contract.effective_date ?? '-'}</TableCell>
                        <TableCell className="text-sm">
                          {contract.expiration_date ?? '-'}
                          {expirationBadge(contract.expiration_date)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  )
}
