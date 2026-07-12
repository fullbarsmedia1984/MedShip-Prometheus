import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'

// POST /api/kits/import — one-time seeding from the SharePoint
// "Nursing Kit Report" workbook (paste as CSV). Recognizes the workbook's
// column headers; only touches ops-overlay fields, never Fishbowl facts.
// Rows whose Order# doesn't match a cached -KIT SO are reported back.

type ParsedRow = Record<string, string>

function parseCsv(text: string): ParsedRow[] {
  const rows: string[][] = []
  let cur: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') inQuotes = false
      else cell += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      cur.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      cur.push(cell)
      cell = ''
      if (cur.some((c) => c.trim() !== '')) rows.push(cur)
      cur = []
    } else cell += ch
  }
  cur.push(cell)
  if (cur.some((c) => c.trim() !== '')) rows.push(cur)
  if (rows.length < 2) return []

  const headers = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => {
    const obj: ParsedRow = {}
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim()
    })
    return obj
  })
}

function findKey(row: ParsedRow, ...needles: string[]): string | null {
  for (const key of Object.keys(row)) {
    if (needles.some((n) => key.includes(n))) return key
  }
  return null
}

/** Accepts 8/14, 8/14/2026, 2026-08-14 → YYYY-MM-DD (assumes current year
 *  when omitted). */
function toIsoDate(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const m = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (!m) return null
  const year = m[3]
    ? m[3].length === 2
      ? 2000 + Number(m[3])
      : Number(m[3])
    : new Date().getFullYear()
  return `${year}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
}

export async function POST(request: Request) {
  const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
  if (!auth.authorized) return auth.response

  const body = await request.json().catch(() => null)
  const csv = body?.csv ? String(body.csv) : ''
  if (!csv.trim()) {
    return NextResponse.json({ error: 'csv required' }, { status: 400 })
  }

  const rows = parseCsv(csv)
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data rows found' }, { status: 400 })
  }

  const sample = rows[0]
  const orderKey = findKey(sample, 'order')
  if (!orderKey) {
    return NextResponse.json(
      { error: 'Could not find an "Order#" column in the CSV headers' },
      { status: 400 }
    )
  }
  const earliestKey = findKey(sample, 'earliest need')
  const absoluteKey = findKey(sample, 'absolute need')
  const transitKey = findKey(sample, 'transit')
  const repKey = findKey(sample, 'rep')
  const tableKey = findKey(sample, 'table')
  const notesKey = findKey(sample, 'note')

  const supabase = createAdminClient()
  // Verify only the SOs present in the CSV (the full -KIT history exceeds
  // PostgREST's 1,000-row response cap).
  const csvSos = [
    ...new Set(
      rows
        .map((r) => r[orderKey]?.trim())
        .filter((s): s is string => Boolean(s && /-KIT/i.test(s)))
    ),
  ]
  const known = new Set<string>()
  for (let i = 0; i < csvSos.length; i += 200) {
    const batch = csvSos.slice(i, i + 200)
    const { data, error } = await supabase
      .from('fb_sales_orders')
      .select('so_number')
      .in('so_number', batch)
    if (error) {
      return NextResponse.json({ error: 'SO lookup failed' }, { status: 500 })
    }
    for (const r of data ?? []) known.add(r.so_number as string)
  }

  let imported = 0
  const skipped: string[] = []
  const nowIso = new Date().toISOString()

  for (const row of rows) {
    const soNumber = row[orderKey]?.trim()
    if (!soNumber || !/-KIT/i.test(soNumber)) continue
    if (!known.has(soNumber)) {
      skipped.push(soNumber)
      continue
    }
    const transitRaw = transitKey ? row[transitKey] : ''
    const transit = transitRaw && /^\d+$/.test(transitRaw) ? Number(transitRaw) : null
    const { error } = await supabase.from('kit_orders').upsert(
      {
        so_number: soNumber,
        earliest_need_by: earliestKey ? toIsoDate(row[earliestKey]) : null,
        absolute_need_by: absoluteKey ? toIsoDate(row[absoluteKey]) : null,
        transit_days: transit !== null && transit <= 30 ? transit : null,
        rep: repKey && row[repKey] ? row[repKey].toUpperCase().slice(0, 8) : null,
        table_location: tableKey && row[tableKey] ? row[tableKey].slice(0, 16) : null,
        notes: notesKey && row[notesKey] ? row[notesKey].slice(0, 2000) : null,
        updated_at: nowIso,
        updated_by: auth.user?.id ?? null,
      },
      { onConflict: 'so_number' }
    )
    if (!error) imported++
  }

  return NextResponse.json({
    imported,
    skipped,
    recognizedColumns: {
      order: orderKey,
      earliestNeedBy: earliestKey,
      absoluteNeedBy: absoluteKey,
      transitDays: transitKey,
      rep: repKey,
      tableLocation: tableKey,
      notes: notesKey,
    },
  })
}
