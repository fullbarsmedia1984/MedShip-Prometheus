'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const INPUT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function WorkbookUploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState({
    distributorName: '',
    contractNumber: '',
    effectiveDate: '',
    expirationDate: '',
    accountNumber: '',
    locationScope: '',
    notes: '',
  })

  const setField = (name: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setFields((current) => ({ ...current, [name]: event.target.value }))

  const submit = useCallback(async () => {
    if (!file) {
      setError('Choose an .xlsx workbook to upload.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      for (const [key, value] of Object.entries(fields)) form.set(key, value)
      const response = await fetch('/api/pricing/workbook-uploads', { method: 'POST', body: form })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Upload failed')
      router.push(`/dashboard/pricing/imports/upload/${payload.upload.uploadId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setSubmitting(false)
    }
  }, [file, fields, router])

  return (
    <>
      <Header title="Upload Pricing Workbook" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <Card className="shadow-sm max-w-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" /> Upload a distributor pricing workbook
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <Link href="/dashboard/pricing/imports" className="text-medship-primary hover:underline">
                Back to imports
              </Link>
              {' — '}The workbook is stored privately and analyzed automatically. Contract number and effective
              date are required before any rows can stage. Buy-side supplier costs only.
            </p>

            <div>
              <label className="text-sm font-medium">Workbook file (.xlsx)</label>
              <input
                type="file"
                accept=".xlsx,.xlsm"
                className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Distributor name <Badge variant="outline" className="ml-1">required</Badge></label>
                <input className={INPUT_CLASS} value={fields.distributorName} onChange={setField('distributorName')} />
              </div>
              <div>
                <label className="text-sm font-medium">Contract number <Badge variant="outline" className="ml-1">required</Badge></label>
                <input className={INPUT_CLASS} value={fields.contractNumber} onChange={setField('contractNumber')} />
              </div>
              <div>
                <label className="text-sm font-medium">Effective date <Badge variant="outline" className="ml-1">required</Badge></label>
                <input type="date" className={INPUT_CLASS} value={fields.effectiveDate} onChange={setField('effectiveDate')} />
              </div>
              <div>
                <label className="text-sm font-medium">Expiration date</label>
                <input type="date" className={INPUT_CLASS} value={fields.expirationDate} onChange={setField('expirationDate')} />
              </div>
              <div>
                <label className="text-sm font-medium">Account number</label>
                <input className={INPUT_CLASS} value={fields.accountNumber} onChange={setField('accountNumber')} />
              </div>
              <div>
                <label className="text-sm font-medium">Location scope</label>
                <input className={INPUT_CLASS} value={fields.locationScope} onChange={setField('locationScope')} />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Notes</label>
              <input className={INPUT_CLASS} value={fields.notes} onChange={setField('notes')} />
            </div>

            {error && (
              <p className="rounded-md border border-medship-warning/25 bg-medship-warning/5 p-3 text-sm text-muted-foreground">
                {error}
              </p>
            )}

            <Button onClick={submit} disabled={submitting}>
              {submitting ? 'Uploading and analyzing...' : 'Upload and Analyze'}
            </Button>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
