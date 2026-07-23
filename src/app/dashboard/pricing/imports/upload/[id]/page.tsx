'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FileSpreadsheet, Play, Rows3, Save } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchJson } from '@/lib/client-api'

const CANONICAL_FIELD_OPTIONS = [
  { field: 'price', label: 'Price (cost)', requiredAlways: true },
  { field: 'distributor_sku', label: 'Distributor SKU / Item #' },
  { field: 'manufacturer_part_number', label: 'Manufacturer part number' },
  { field: 'model_number', label: 'Model number' },
  { field: 'gtin', label: 'GTIN / UPC' },
  { field: 'ndc', label: 'NDC' },
  { field: 'manufacturer_name', label: 'Manufacturer name' },
  { field: 'item_description_raw', label: 'Item description' },
  { field: 'raw_price_uom', label: 'Price UOM' },
  { field: 'pack_size', label: 'Pack size' },
  { field: 'minimum_quantity', label: 'Minimum quantity' },
  { field: 'effective_date', label: 'Line effective date' },
  { field: 'expiration_date', label: 'Line expiration date' },
]

type Upload = {
  id: string
  file_name: string
  distributor_name: string
  contract_number: string
  effective_date: string
  status: string
  discovery_json?: {
    sheets?: Array<{
      name: string
      row_count: number
      detected_header_row: number | null
      headers: Array<{ column_letter: string; header: string }>
      suggested_mappings: Array<{ canonical_field: string; column_letter: string; header: string; confidence: number }>
    }>
  }
  last_dry_run_json?: Record<string, unknown>
  profile_id: string | null
  staged_batch_id: string | null
  error_message: string | null
}

type Profile = {
  id: string
  profile_name: string
  profile_version: string
  status: string
}

type DryRun = {
  dryRunId: string
  summary: {
    rows_scanned: number
    proposed_rows: number
    valid_rows: number
    warning_rows: number
    blocking_exception_rows: number
    exception_counts: Record<string, number>
  }
  excludedRows: number
  canStage: boolean
  blockingReasons: Array<{ code: string; count: number; message: string }>
}

type PageProps = { params: Promise<{ id: string }> }

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

function statusBadge(status: string) {
  const success = ['discovered', 'dry_run', 'staged'].includes(status)
  return (
    <Badge
      variant="outline"
      className={
        success
          ? 'border-medship-success/30 bg-medship-success/10 text-medship-success'
          : status === 'failed'
            ? 'border-medship-danger/30 bg-medship-danger/10 text-medship-danger'
            : 'border-border bg-muted/60 text-muted-foreground'
      }
    >
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

export default function WorkbookUploadDetailPage({ params }: PageProps) {
  const { id } = use(params)
  const [upload, setUpload] = useState<Upload | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedSheet, setSelectedSheet] = useState<string>('')
  const [headerRow, setHeaderRow] = useState<number>(1)
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [defaultUom, setDefaultUom] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [dryRun, setDryRun] = useState<DryRun | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ upload: Upload; profiles: Profile[] }>(`/api/pricing/workbook-uploads/${id}`)
      setUpload(data.upload)
      setProfiles(data.profiles)
      if (data.upload.profile_id) setSelectedProfileId((current) => current || data.upload.profile_id!)
      const sheets = data.upload.discovery_json?.sheets ?? []
      if (sheets.length > 0) {
        setSelectedSheet((current) => current || sheets[0].name)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load upload')
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const sheet = useMemo(
    () => (upload?.discovery_json?.sheets ?? []).find((candidate) => candidate.name === selectedSheet) ?? null,
    [upload, selectedSheet]
  )

  useEffect(() => {
    if (!sheet) return
    setHeaderRow(sheet.detected_header_row ?? 1)
    const suggested: Record<string, string> = {}
    for (const suggestion of sheet.suggested_mappings) {
      suggested[suggestion.canonical_field] = suggestion.column_letter
    }
    setMappings(suggested)
  }, [sheet])

  const saveProfile = useCallback(async () => {
    if (!sheet) return
    setBusy('profile')
    setError(null)
    setNotice(null)
    try {
      const columnMappings = Object.entries(mappings)
        .filter(([, letter]) => letter)
        .map(([canonicalField, columnLetter]) => ({
          canonicalField,
          columnLetter,
          required: canonicalField === 'price',
        }))
      const data = await fetchJson<{ profile: Profile }>(`/api/pricing/workbook-uploads/${id}/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetName: sheet.name,
          headerRow,
          defaultPriceUom: defaultUom || null,
          columnMappings,
        }),
      })
      setSelectedProfileId(data.profile.id)
      setNotice(`Profile saved: ${data.profile.profile_name} v${data.profile.profile_version}. Run the dry run next.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile')
    } finally {
      setBusy(null)
    }
  }, [id, sheet, headerRow, mappings, defaultUom, load])

  const runDryRun = useCallback(async () => {
    if (!selectedProfileId) return
    setBusy('dry-run')
    setError(null)
    setNotice(null)
    try {
      const data = await fetchJson<{ dryRun: DryRun }>(`/api/pricing/workbook-uploads/${id}/dry-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: selectedProfileId }),
      })
      setDryRun(data.dryRun)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dry run failed')
    } finally {
      setBusy(null)
    }
  }, [id, selectedProfileId, load])

  const stage = useCallback(async () => {
    if (!selectedProfileId) return
    setBusy('stage')
    setError(null)
    setNotice(null)
    try {
      const data = await fetchJson<{ stage: { batchId: string; rowsInserted: number } }>(
        `/api/pricing/workbook-uploads/${id}/stage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: selectedProfileId }),
        }
      )
      setNotice(`Staged ${data.stage.rowsInserted.toLocaleString()} rows into batch review.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Staging failed')
    } finally {
      setBusy(null)
    }
  }, [id, selectedProfileId, load])

  const sheets = upload?.discovery_json?.sheets ?? []

  return (
    <>
      <Header title="Workbook Upload" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <Link href="/dashboard/pricing/imports" className="text-sm text-medship-primary hover:underline">
              Back to imports
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-medship-primary" />
              <h1 className="text-xl font-semibold text-card-foreground">{upload?.file_name ?? 'Workbook'}</h1>
              {upload && statusBadge(upload.status)}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {upload
                ? `${upload.distributor_name} — contract metadata captured at upload. Confirm the column mapping, dry-run, then stage into the governed review flow.`
                : 'Loading...'}
            </p>
            {upload?.error_message && (
              <p className="mt-3 rounded-md border border-medship-danger/25 bg-medship-danger/5 p-3 text-sm text-muted-foreground">
                {upload.error_message}
              </p>
            )}
            {notice && (
              <p className="mt-3 rounded-md border border-medship-success/25 bg-medship-success/5 p-3 text-sm text-muted-foreground">
                {notice}
              </p>
            )}
            {error && (
              <p className="mt-3 rounded-md border border-medship-warning/25 bg-medship-warning/5 p-3 text-sm text-muted-foreground">
                {error}
              </p>
            )}
            {upload?.staged_batch_id && (
              <p className="mt-3 text-sm">
                <Link href={`/dashboard/pricing/imports/${upload.staged_batch_id}`} className="text-medship-primary hover:underline">
                  Open the staged batch for review, matching, and publish
                </Link>
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Rows3 className="h-4 w-4" /> Column Mapping (Profile Builder)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sheets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No discovery data available for this upload.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="w-full min-w-0 max-w-full sm:w-auto">
                    <label className="text-sm font-medium">Sheet</label>
                    <div>
                      <select className={`${SELECT_CLASS} w-full max-w-full sm:w-auto`} value={selectedSheet} onChange={(event) => setSelectedSheet(event.target.value)}>
                        {sheets.map((candidate) => (
                          <option key={candidate.name} value={candidate.name}>
                            {candidate.name} ({candidate.row_count.toLocaleString()} rows)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Header row</label>
                    <div>
                      <input
                        type="number"
                        min={1}
                        className={`${SELECT_CLASS} w-24`}
                        value={headerRow}
                        onChange={(event) => setHeaderRow(Number(event.target.value))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Default price UOM (if no UOM column)</label>
                    <div>
                      <input
                        className={`${SELECT_CLASS} w-32`}
                        placeholder="e.g. EA"
                        value={defaultUom}
                        onChange={(event) => setDefaultUom(event.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {CANONICAL_FIELD_OPTIONS.map(({ field, label, requiredAlways }) => (
                    <div key={field} className="rounded-md border p-3">
                      <label className="text-sm font-medium">
                        {label}
                        {requiredAlways ? <span className="ml-1 text-medship-danger">*</span> : null}
                      </label>
                      <div className="mt-1">
                        <select
                          className={`${SELECT_CLASS} w-full`}
                          value={mappings[field] ?? ''}
                          onChange={(event) =>
                            setMappings((current) => ({ ...current, [field]: event.target.value }))
                          }
                        >
                          <option value="">Not mapped</option>
                          {(sheet?.headers ?? []).map(({ column_letter, header }) => (
                            <option key={column_letter} value={column_letter}>
                              {column_letter}: {header}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={saveProfile} disabled={busy !== null || !mappings.price}>
                    <Save className="h-3.5 w-3.5" /> {busy === 'profile' ? 'Saving...' : 'Save Profile'}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Suggestions are deterministic header matches — confirm every field. Price is required.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Play className="h-4 w-4" /> Dry Run & Stage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full min-w-0 max-w-full sm:w-auto">
                <label className="text-sm font-medium">Profile</label>
                <div>
                  <select
                    className={`${SELECT_CLASS} w-full max-w-full sm:w-auto sm:min-w-64`}
                    value={selectedProfileId}
                    onChange={(event) => setSelectedProfileId(event.target.value)}
                  >
                    <option value="">Select a saved profile</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.profile_name} v{profile.profile_version} ({profile.status.replace(/_/g, ' ')})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button variant="outline" onClick={runDryRun} disabled={busy !== null || !selectedProfileId}>
                {busy === 'dry-run' ? 'Running...' : 'Run Dry Run'}
              </Button>
              <Button onClick={stage} disabled={busy !== null || !selectedProfileId || !dryRun?.canStage}>
                {busy === 'stage' ? 'Staging...' : 'Stage Batch'}
              </Button>
            </div>

            {dryRun && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{dryRun.summary.rows_scanned.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Scanned</p></div>
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{dryRun.summary.proposed_rows.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Proposed</p></div>
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{dryRun.summary.valid_rows.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Valid</p></div>
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{dryRun.summary.warning_rows.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Warnings</p></div>
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{dryRun.summary.blocking_exception_rows.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Blocking</p></div>
                  <div className="rounded-md border p-3"><p className="text-lg font-semibold">{dryRun.excludedRows.toLocaleString()}</p><p className="text-xs uppercase text-muted-foreground">Excluded</p></div>
                </div>
                {dryRun.blockingReasons.length > 0 ? (
                  <div className="rounded-md border border-medship-warning/25 bg-medship-warning/5 p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-card-foreground">Cannot stage yet:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {dryRun.blockingReasons.map((reason) => (
                        <li key={reason.code}>
                          {reason.code} ({reason.count.toLocaleString()}) — {reason.message}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2">Adjust the column mapping (or fix the workbook) and save a new profile version, then re-run.</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Dry run is clean. Staging creates a review batch — nothing publishes without the existing
                    approve → prepare → publish gates.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  )
}
