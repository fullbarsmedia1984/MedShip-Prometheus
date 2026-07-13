import { createHash } from 'node:crypto'

export const KIT_IMPORT_ELIGIBLE_STATUSES = new Set([
  'Estimate',
  'Issued',
  'In Progress',
])

export type KitImportField =
  | 'earliest_need_by'
  | 'absolute_need_by'
  | 'transit_days'
  | 'rep'
  | 'table_location'
  | 'notes'

export type KitImportOverlay = {
  so_number: string
  earliest_need_by: string | null
  absolute_need_by: string | null
  transit_days: number | null
  rep: string | null
  table_location: string | null
  notes: string | null
}

export type KitImportKnownOrder = {
  so_number: string
  status: string | null
}

export type KitImportIssue = {
  row: number
  soNumber: string | null
  field: string
  message: string
}

export type KitImportSkipped = {
  row: number
  soNumber: string
  reason: 'not_found' | 'ineligible_status' | 'duplicate'
  status?: string | null
}

export type KitImportChange = {
  row: number
  soNumber: string
  operation: 'insert' | 'update'
  changedFields: KitImportField[]
  before: KitImportOverlay | null
  after: KitImportOverlay
}

export type KitImportPreview = {
  digest: string
  recognizedColumns: {
    order: string | null
    earliestNeedBy: string | null
    absoluteNeedBy: string | null
    transitDays: string | null
    rep: string | null
    tableLocation: string | null
    notes: string | null
  }
  summary: {
    inputRows: number
    kitRows: number
    eligible: number
    inserts: number
    updates: number
    unchanged: number
    changes: number
    needsDates: number
    estimates: number
    skippedNotFound: number
    skippedIneligible: number
    duplicates: number
    invalid: number
  }
  blockingErrors: KitImportIssue[]
  skipped: KitImportSkipped[]
  changes: KitImportChange[]
}

type ParsedTable = {
  headers: string[]
  normalizedHeaders: string[]
  rows: Array<{ sourceRow: number; values: string[] }>
}

type ImportColumn = keyof KitImportPreview['recognizedColumns']

const HEADER_ALIASES: Record<ImportColumn, string[]> = {
  order: ['order#', 'order #', 'order number', 'so #', 'so number'],
  earliestNeedBy: ['earliest need by'],
  absoluteNeedBy: ['absolute need by'],
  transitDays: ['days for transit', 'transit days'],
  rep: ['rep'],
  tableLocation: ['table location'],
  notes: ['notes'],
}

const IMPORT_FIELDS: KitImportField[] = [
  'earliest_need_by',
  'absolute_need_by',
  'transit_days',
  'rep',
  'table_location',
  'notes',
]

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseDelimited(text: string, delimiter: ',' | '\t'): ParsedTable {
  const rawRows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index++
      } else if (character === '"') {
        inQuotes = false
      } else {
        cell += character
      }
    } else if (character === '"') {
      inQuotes = true
    } else if (character === delimiter) {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++
      row.push(cell)
      cell = ''
      rawRows.push(row)
      row = []
    } else {
      cell += character
    }
  }

  row.push(cell)
  rawRows.push(row)

  const nonEmptyRows = rawRows.filter((candidate) =>
    candidate.some((value) => value.trim() !== '')
  )
  const headers = (nonEmptyRows[0] ?? []).map((header) => header.trim())

  return {
    headers,
    normalizedHeaders: headers.map(normalizeHeader),
    rows: nonEmptyRows.slice(1).map((values, index) => ({
      sourceRow: index + 2,
      values: values.map((value) => value.trim()),
    })),
  }
}

export function parseKitImportTable(text: string): ParsedTable {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  const delimiter = firstLine.includes('\t') ? '\t' : ','
  return parseDelimited(text, delimiter)
}

export function extractKitImportOrderNumbers(text: string): string[] {
  const table = parseKitImportTable(text)
  const orderColumn = findColumn(table, 'order')
  if (orderColumn < 0) return []
  return [...new Set(
    table.rows
      .map((row) => cellAt(row.values, orderColumn)?.toUpperCase() ?? '')
      .filter((soNumber) => /-KIT$/i.test(soNumber))
  )]
}

function findColumn(table: ParsedTable, column: ImportColumn): number {
  const aliases = HEADER_ALIASES[column]
  return table.normalizedHeaders.findIndex((header) => aliases.includes(header))
}

function cellAt(values: string[], columnIndex: number): string | undefined {
  if (columnIndex < 0) return undefined
  return values[columnIndex]?.trim() ?? ''
}

function validIsoParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function parseKitImportDate(value: string, defaultYear: number): string | null {
  const normalized = value.trim()
  if (!normalized) return null

  let year: number
  let month: number
  let day: number
  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    year = Number(isoMatch[1])
    month = Number(isoMatch[2])
    day = Number(isoMatch[3])
  } else {
    const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/)
    if (!slashMatch) return null
    month = Number(slashMatch[1])
    day = Number(slashMatch[2])
    year = slashMatch[3]
      ? slashMatch[3].length === 2
        ? 2000 + Number(slashMatch[3])
        : Number(slashMatch[3])
      : defaultYear
  }

  if (!validIsoParts(year, month, day)) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function emptyOverlay(soNumber: string): KitImportOverlay {
  return {
    so_number: soNumber,
    earliest_need_by: null,
    absolute_need_by: null,
    transit_days: null,
    rep: null,
    table_location: null,
    notes: null,
  }
}

function canonicalOverlay(row: KitImportOverlay): KitImportOverlay {
  return {
    so_number: row.so_number,
    earliest_need_by: row.earliest_need_by ?? null,
    absolute_need_by: row.absolute_need_by ?? null,
    transit_days: row.transit_days ?? null,
    rep: row.rep ?? null,
    table_location: row.table_location ?? null,
    notes: row.notes ?? null,
  }
}

function changedFields(before: KitImportOverlay | null, after: KitImportOverlay): KitImportField[] {
  if (!before) return IMPORT_FIELDS.filter((field) => after[field] !== null)
  return IMPORT_FIELDS.filter((field) => before[field] !== after[field])
}

function digestPreview(value: Omit<KitImportPreview, 'digest'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function buildKitImportPreview(options: {
  text: string
  knownOrders: Map<string, KitImportKnownOrder>
  existingOverlays: Map<string, KitImportOverlay>
  defaultYear?: number
}): KitImportPreview {
  const table = parseKitImportTable(options.text)
  const defaultYear = options.defaultYear ?? new Date().getFullYear()
  const columnIndexes = {
    order: findColumn(table, 'order'),
    earliestNeedBy: findColumn(table, 'earliestNeedBy'),
    absoluteNeedBy: findColumn(table, 'absoluteNeedBy'),
    transitDays: findColumn(table, 'transitDays'),
    rep: findColumn(table, 'rep'),
    tableLocation: findColumn(table, 'tableLocation'),
    notes: findColumn(table, 'notes'),
  }
  const recognizedColumns = Object.fromEntries(
    Object.entries(columnIndexes).map(([key, index]) => [
      key,
      index >= 0 ? table.headers[index] : null,
    ])
  ) as KitImportPreview['recognizedColumns']

  const blockingErrors: KitImportIssue[] = []
  const skipped: KitImportSkipped[] = []
  const changes: KitImportChange[] = []
  let kitRows = 0
  let eligible = 0
  let unchanged = 0
  let needsDates = 0
  let estimates = 0

  if (columnIndexes.order < 0) {
    blockingErrors.push({
      row: 1,
      soNumber: null,
      field: 'order',
      message: 'Required Order# column was not found.',
    })
  }

  const kitCandidates = table.rows
    .map((row) => ({
      ...row,
      soNumber: cellAt(row.values, columnIndexes.order)?.toUpperCase() ?? '',
    }))
    .filter((row) => /-KIT$/i.test(row.soNumber))
  kitRows = kitCandidates.length

  const occurrences = new Map<string, number>()
  for (const row of kitCandidates) {
    occurrences.set(row.soNumber, (occurrences.get(row.soNumber) ?? 0) + 1)
  }

  for (const row of kitCandidates) {
    const soNumber = row.soNumber
    if ((occurrences.get(soNumber) ?? 0) > 1) {
      skipped.push({ row: row.sourceRow, soNumber, reason: 'duplicate' })
      blockingErrors.push({
        row: row.sourceRow,
        soNumber,
        field: 'order',
        message: `Duplicate Order# ${soNumber}; remove duplicate rows before applying.`,
      })
      continue
    }

    const knownOrder = options.knownOrders.get(soNumber)
    if (!knownOrder) {
      skipped.push({ row: row.sourceRow, soNumber, reason: 'not_found' })
      continue
    }
    if (!knownOrder.status || !KIT_IMPORT_ELIGIBLE_STATUSES.has(knownOrder.status)) {
      skipped.push({
        row: row.sourceRow,
        soNumber,
        reason: 'ineligible_status',
        status: knownOrder.status,
      })
      continue
    }

    const before = options.existingOverlays.get(soNumber)
      ? canonicalOverlay(options.existingOverlays.get(soNumber)!)
      : null
    const after = before ? { ...before } : emptyOverlay(soNumber)
    const rowErrors: KitImportIssue[] = []

    const earliestRaw = cellAt(row.values, columnIndexes.earliestNeedBy)
    if (earliestRaw) {
      const parsed = parseKitImportDate(earliestRaw, defaultYear)
      if (parsed) after.earliest_need_by = parsed
      else rowErrors.push({
        row: row.sourceRow,
        soNumber,
        field: 'earliest_need_by',
        message: `Invalid Earliest Need By date: ${earliestRaw}`,
      })
    }

    const absoluteRaw = cellAt(row.values, columnIndexes.absoluteNeedBy)
    if (absoluteRaw) {
      const parsed = parseKitImportDate(absoluteRaw, defaultYear)
      if (parsed) after.absolute_need_by = parsed
      else rowErrors.push({
        row: row.sourceRow,
        soNumber,
        field: 'absolute_need_by',
        message: `Invalid Absolute Need By date: ${absoluteRaw}`,
      })
    }

    const transitRaw = cellAt(row.values, columnIndexes.transitDays)
    if (transitRaw) {
      if (/^\d+$/.test(transitRaw) && Number(transitRaw) <= 30) {
        after.transit_days = Number(transitRaw)
      } else {
        rowErrors.push({
          row: row.sourceRow,
          soNumber,
          field: 'transit_days',
          message: `Days for Transit must be a whole number from 0 to 30: ${transitRaw}`,
        })
      }
    }

    const repRaw = cellAt(row.values, columnIndexes.rep)
    if (repRaw) {
      if (repRaw.length <= 8) after.rep = repRaw.toUpperCase()
      else rowErrors.push({
        row: row.sourceRow,
        soNumber,
        field: 'rep',
        message: 'REP must be 8 characters or fewer.',
      })
    }

    const tableRaw = cellAt(row.values, columnIndexes.tableLocation)
    if (tableRaw) {
      if (tableRaw.length <= 16) after.table_location = tableRaw
      else rowErrors.push({
        row: row.sourceRow,
        soNumber,
        field: 'table_location',
        message: 'Table Location must be 16 characters or fewer.',
      })
    }

    const notesRaw = cellAt(row.values, columnIndexes.notes)
    if (notesRaw) {
      if (notesRaw.length <= 2000) after.notes = notesRaw
      else rowErrors.push({
        row: row.sourceRow,
        soNumber,
        field: 'notes',
        message: 'Notes must be 2,000 characters or fewer.',
      })
    }

    if (rowErrors.length > 0) {
      blockingErrors.push(...rowErrors)
      continue
    }

    eligible++
    if (!after.earliest_need_by || !after.absolute_need_by || after.transit_days === null) {
      needsDates++
    }
    if (knownOrder.status === 'Estimate') estimates++

    const fields = changedFields(before, after)
    if (before && fields.length === 0) {
      unchanged++
      continue
    }

    changes.push({
      row: row.sourceRow,
      soNumber,
      operation: before ? 'update' : 'insert',
      changedFields: fields,
      before,
      after,
    })
  }

  const duplicateOrders = new Set(
    skipped.filter((row) => row.reason === 'duplicate').map((row) => row.soNumber)
  )
  const previewWithoutDigest: Omit<KitImportPreview, 'digest'> = {
    recognizedColumns,
    summary: {
      inputRows: table.rows.length,
      kitRows,
      eligible,
      inserts: changes.filter((change) => change.operation === 'insert').length,
      updates: changes.filter((change) => change.operation === 'update').length,
      unchanged,
      changes: changes.length,
      needsDates,
      estimates,
      skippedNotFound: skipped.filter((row) => row.reason === 'not_found').length,
      skippedIneligible: skipped.filter((row) => row.reason === 'ineligible_status').length,
      duplicates: duplicateOrders.size,
      invalid: new Set(
        blockingErrors
          .filter((error) => error.row > 1)
          .map((error) => `${error.row}|${error.soNumber ?? ''}`)
      ).size,
    },
    blockingErrors,
    skipped,
    changes,
  }

  return {
    digest: digestPreview(previewWithoutDigest),
    ...previewWithoutDigest,
  }
}
