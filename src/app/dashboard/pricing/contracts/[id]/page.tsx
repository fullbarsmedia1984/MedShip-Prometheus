'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PencilLine, Plus, Rows3 } from 'lucide-react'
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

type Contract = {
  id: string
  supplier_name: string
  contract_name: string | null
  contract_number: string | null
  account_number: string | null
  status: string
  effective_date: string | null
  expiration_date: string | null
}

type CostLine = {
  id: string
  distributor_sku: string | null
  manufacturer_name: string | null
  manufacturer_part_number: string | null
  model_number: string | null
  gtin: string | null
  item_description_raw: string | null
  cost: number
  currency: string
  raw_price_uom: string | null
  normalized_price_uom: string | null
  pack_size: number | null
  minimum_quantity: number | null
  effective_date: string | null
  expiration_date: string | null
  active: boolean
  approval_status: string
  internal_item_id: string | null
  hercules_catalog_item_id: string | null
  source_batch_id: string | null
  source_file_name: string | null
  source_row_number: number | null
}

type StatusFilter = 'active' | 'pending' | 'superseded' | 'all'

type PageProps = { params: Promise<{ id: string }> }

const INPUT = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

const EMPTY_LINE_FORM = {
  itemDescription: '',
  distributorSku: '',
  manufacturerPartNumber: '',
  modelNumber: '',
  gtin: '',
  manufacturerName: '',
  cost: '',
  priceUom: 'EA',
  effectiveDate: '',
  expirationDate: '',
}

function lineIdentifier(line: CostLine) {
  return line.distributor_sku ?? line.manufacturer_part_number ?? line.model_number ?? line.gtin ?? '-'
}

function sourceLabel(line: CostLine) {
  if (!line.source_batch_id) return 'Manual'
  return line.source_file_name
    ? `Import (${line.source_file_name}${line.source_row_number ? ` row ${line.source_row_number}` : ''})`
    : 'Import'
}

export default function SupplierContractDetailPage({ params }: PageProps) {
  const { id } = use(params)
  const [contract, setContract] = useState<Contract | null>(null)
  const [lines, setLines] = useState<CostLine[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [panel, setPanel] = useState<'add' | 'edit' | null>(null)
  const [editLineId, setEditLineId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_LINE_FORM })
  const [expireConfirmId, setExpireConfirmId] = useState<string | null>(null)

  const setField = (name: keyof typeof EMPTY_LINE_FORM) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [name]: event.target.value }))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<{ contract: Contract; costLines: CostLine[] }>(
        `/api/pricing/supplier-contracts/${id}?status=${statusFilter}`
      )
      setContract(data.contract)
      setLines(data.costLines)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load contract')
    } finally {
      setLoading(false)
    }
  }, [id, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  const openAdd = () => {
    setForm({ ...EMPTY_LINE_FORM })
    setEditLineId(null)
    setPanel('add')
    setNotice(null)
    setError(null)
  }

  const openEdit = (line: CostLine) => {
    setForm({
      ...EMPTY_LINE_FORM,
      itemDescription: line.item_description_raw ?? '',
      distributorSku: line.distributor_sku ?? '',
      manufacturerPartNumber: line.manufacturer_part_number ?? '',
      modelNumber: line.model_number ?? '',
      gtin: line.gtin ?? '',
      manufacturerName: line.manufacturer_name ?? '',
      cost: String(line.cost),
      priceUom: line.raw_price_uom ?? line.normalized_price_uom ?? 'EA',
      effectiveDate: line.effective_date ?? '',
      expirationDate: line.expiration_date ?? '',
    })
    setEditLineId(line.id)
    setPanel('edit')
    setNotice(null)
    setError(null)
  }

  const submitPanel = useCallback(async () => {
    setBusy('panel')
    setError(null)
    try {
      if (panel === 'add') {
        await fetchJson(`/api/pricing/supplier-contracts/${id}/cost-lines`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cost: Number(form.cost),
            priceUom: form.priceUom,
            itemDescription: form.itemDescription || null,
            distributorSku: form.distributorSku || null,
            manufacturerPartNumber: form.manufacturerPartNumber || null,
            modelNumber: form.modelNumber || null,
            gtin: form.gtin || null,
            manufacturerName: form.manufacturerName || null,
            effectiveDate: form.effectiveDate || null,
            expirationDate: form.expirationDate || null,
            notes: 'Added manually from Contract Price Manager.',
          }),
        })
        setNotice('Cost line added and active.')
      } else if (panel === 'edit' && editLineId) {
        await fetchJson(`/api/pricing/cost-lines/${editLineId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cost: form.cost === '' ? null : Number(form.cost),
            priceUom: form.priceUom || null,
            itemDescription: form.itemDescription || null,
            effectiveDate: form.effectiveDate || null,
            expirationDate: form.expirationDate || '',
            notes: 'Corrected from Contract Price Manager.',
          }),
        })
        setNotice('Cost line updated. The previous version is kept as history (superseded).')
      }
      setPanel(null)
      setEditLineId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }, [panel, editLineId, id, form, load])

  const expireLine = useCallback(async (lineId: string) => {
    setBusy(lineId)
    setError(null)
    try {
      await fetchJson(`/api/pricing/cost-lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deactivate', notes: 'Expired from Contract Price Manager.' }),
      })
      setNotice('Cost line expired. It is kept in history and no longer counts as an active cost.')
      setExpireConfirmId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Expire failed')
    } finally {
      setBusy(null)
    }
  }, [load])

  return (
    <>
      <Header title="Supplier Contract" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <Link href="/dashboard/pricing/contracts" className="text-sm text-medship-primary hover:underline">
              Back to contracts
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-card-foreground">{contract?.supplier_name ?? 'Contract'}</h1>
              {contract && (
                <Badge variant="outline" className="border-medship-primary/30 bg-medship-primary/10 text-medship-primary">
                  {contract.status}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {contract
                ? `Contract ${contract.contract_number ?? '(no number)'} — effective ${contract.effective_date ?? 'n/a'}${contract.expiration_date ? `, expires ${contract.expiration_date}` : ''}. Edits create a new version and keep the old one; expiring keeps history.`
                : 'Loading...'}
            </p>
            {notice && (
              <p className="mt-3 rounded-md border border-medship-success/25 bg-medship-success/5 p-3 text-sm text-muted-foreground">{notice}</p>
            )}
            {error && (
              <p className="mt-3 rounded-md border border-medship-warning/25 bg-medship-warning/5 p-3 text-sm text-muted-foreground">{error}</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2"><Rows3 className="h-4 w-4" /> Cost Lines</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {(['active', 'pending', 'superseded', 'all'] as StatusFilter[]).map((filter) => (
                  <Button
                    key={filter}
                    variant={statusFilter === filter ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatusFilter(filter)}
                    disabled={loading}
                  >
                    {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </Button>
                ))}
                <Button size="sm" onClick={openAdd} disabled={busy !== null}>
                  <Plus className="h-3.5 w-3.5" /> Add Line
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {panel && (
              <div className="mb-4 rounded-md border border-medship-primary/25 bg-medship-primary/5 p-4">
                <p className="text-sm font-medium text-card-foreground">
                  {panel === 'add'
                    ? 'Add a negotiated cost line (no workbook needed)'
                    : 'Correct this cost line — the current version will be kept as history'}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium uppercase text-muted-foreground">Description</label>
                    <input className={INPUT} value={form.itemDescription} onChange={setField('itemDescription')} />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase text-muted-foreground">Cost (required)</label>
                    <input className={INPUT} type="number" min="0" step="0.01" value={form.cost} onChange={setField('cost')} />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase text-muted-foreground">Price UOM (required)</label>
                    <input className={INPUT} value={form.priceUom} onChange={setField('priceUom')} placeholder="EA" />
                  </div>
                  {panel === 'add' && (
                    <>
                      <div>
                        <label className="text-xs font-medium uppercase text-muted-foreground">Distributor SKU</label>
                        <input className={INPUT} value={form.distributorSku} onChange={setField('distributorSku')} />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase text-muted-foreground">Manufacturer part #</label>
                        <input className={INPUT} value={form.manufacturerPartNumber} onChange={setField('manufacturerPartNumber')} />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase text-muted-foreground">Model #</label>
                        <input className={INPUT} value={form.modelNumber} onChange={setField('modelNumber')} />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase text-muted-foreground">GTIN / UPC</label>
                        <input className={INPUT} value={form.gtin} onChange={setField('gtin')} />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase text-muted-foreground">Manufacturer</label>
                        <input className={INPUT} value={form.manufacturerName} onChange={setField('manufacturerName')} />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="text-xs font-medium uppercase text-muted-foreground">Effective date</label>
                    <input className={INPUT} type="date" value={form.effectiveDate} onChange={setField('effectiveDate')} />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase text-muted-foreground">Expiration date</label>
                    <input className={INPUT} type="date" value={form.expirationDate} onChange={setField('expirationDate')} />
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={submitPanel} disabled={busy !== null || !form.cost || !form.priceUom}>
                    {busy === 'panel' ? 'Saving...' : panel === 'add' ? 'Add Cost Line' : 'Save New Version'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPanel(null)} disabled={busy !== null}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading cost lines...</p>
            ) : lines.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No {statusFilter === 'all' ? '' : `${statusFilter} `}cost lines on this contract.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Identifier</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>UOM</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Item Link</TableHead>
                      {statusFilter === 'active' && <TableHead>Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono text-xs">{lineIdentifier(line)}</TableCell>
                        <TableCell className="max-w-[320px] text-sm">
                          <span className="line-clamp-2 whitespace-normal">{line.item_description_raw ?? '-'}</span>
                        </TableCell>
                        <TableCell className="text-sm">{line.normalized_price_uom ?? line.raw_price_uom ?? '-'}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {line.cost.toLocaleString('en-US', { style: 'currency', currency: line.currency || 'USD' })}
                        </TableCell>
                        <TableCell className="text-sm">{line.effective_date ?? '-'}</TableCell>
                        <TableCell className="text-sm">{line.expiration_date ?? '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{sourceLabel(line)}</TableCell>
                        <TableCell className="text-xs">
                          {line.internal_item_id ? (
                            <Badge variant="outline" className="border-medship-success/30 bg-medship-success/10 text-medship-success">Internal</Badge>
                          ) : line.hercules_catalog_item_id ? (
                            <Badge variant="outline" className="border-medship-primary/30 bg-medship-primary/10 text-medship-primary">Hercules</Badge>
                          ) : (
                            <span className="text-muted-foreground">Unmatched</span>
                          )}
                        </TableCell>
                        {statusFilter === 'active' && (
                          <TableCell>
                            {expireConfirmId === line.id ? (
                              <div className="flex gap-2">
                                <Button variant="outline" size="sm" className="border-medship-warning/40 text-medship-warning" onClick={() => expireLine(line.id)} disabled={busy !== null}>
                                  Confirm Expire
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setExpireConfirmId(null)} disabled={busy !== null}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => openEdit(line)} disabled={busy !== null}>
                                  <PencilLine className="h-3.5 w-3.5" /> Edit
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setExpireConfirmId(line.id)} disabled={busy !== null}>
                                  Expire
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        )}
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
