import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const { buildKitImportPreview, parseKitImportDate, parseKitImportTable } = await import(
  new URL('../import.ts', import.meta.url).href
)
const { shipDeadline } = await import(
  new URL('../workdays.ts', import.meta.url).href
)

function known(status = 'Issued') {
  return new Map([
    ['123-KIT', { so_number: '123-KIT', status }],
  ])
}

function existing(notes = 'keep this note') {
  return new Map([
    ['123-KIT', {
      so_number: '123-KIT',
      earliest_need_by: '2026-08-07',
      absolute_need_by: '2026-08-10',
      transit_days: 2,
      rep: 'AB',
      table_location: 'T1',
      notes,
    }],
  ])
}

describe('Nursing Kit Report import preview', () => {
  it('maps only the exact Notes column and ignores Backorder Sub Notes', () => {
    const text = [
      'Order#,Backorder Items / Sub Notes,Notes',
      '123-KIT,do not import this,',
    ].join('\n')
    const preview = buildKitImportPreview({
      text,
      knownOrders: known(),
      existingOverlays: existing(),
      defaultYear: 2026,
    })

    assert.equal(preview.recognizedColumns.notes, 'Notes')
    assert.equal(preview.summary.unchanged, 1)
    assert.equal(preview.summary.changes, 0)
  })

  it('preserves existing fields when a column is missing or a cell is blank', () => {
    const text = [
      'Order#,Earliest Need By,Absolute Need By,Days for Transit,REP',
      '123-KIT,8/8/2026,,,',
    ].join('\n')
    const preview = buildKitImportPreview({
      text,
      knownOrders: known(),
      existingOverlays: existing('669PA | bags'),
      defaultYear: 2026,
    })

    assert.equal(preview.summary.updates, 1)
    assert.deepEqual(preview.changes[0].changedFields, ['earliest_need_by'])
    assert.equal(preview.changes[0].after.notes, '669PA | bags')
    assert.equal(preview.changes[0].after.absolute_need_by, '2026-08-10')
    assert.equal(preview.changes[0].after.transit_days, 2)
  })

  it('accepts tab-delimited tables copied directly from Excel', () => {
    const table = parseKitImportTable('Order#\tNotes\r\n123-KIT\tready')
    assert.deepEqual(table.headers, ['Order#', 'Notes'])
    assert.deepEqual(table.rows[0].values, ['123-KIT', 'ready'])
  })

  it('blocks invalid calendar dates and invalid transit values', () => {
    const text = [
      'Order#,Absolute Need By,Days for Transit',
      '123-KIT,2/30/2026,31',
    ].join('\n')
    const preview = buildKitImportPreview({
      text,
      knownOrders: known(),
      existingOverlays: new Map(),
      defaultYear: 2026,
    })

    assert.equal(preview.summary.invalid, 1)
    assert.equal(preview.blockingErrors.length, 2)
    assert.equal(preview.summary.changes, 0)
  })

  it('skips fulfilled history using the canonical Fishbowl status', () => {
    const preview = buildKitImportPreview({
      text: 'Order#,Notes\n123-KIT,historical',
      knownOrders: known('Fulfilled'),
      existingOverlays: new Map(),
      defaultYear: 2026,
    })

    assert.equal(preview.summary.eligible, 0)
    assert.equal(preview.summary.skippedIneligible, 1)
    assert.equal(preview.summary.changes, 0)
  })

  it('blocks duplicate order rows', () => {
    const preview = buildKitImportPreview({
      text: 'Order#,Notes\n123-KIT,one\n123-KIT,two',
      knownOrders: known(),
      existingOverlays: new Map(),
      defaultYear: 2026,
    })

    assert.equal(preview.summary.duplicates, 1)
    assert.equal(preview.blockingErrors.length, 2)
    assert.equal(preview.summary.changes, 0)
  })

  it('produces a deterministic digest for the same source and live state', () => {
    const options = {
      text: 'Order#,Notes\n123-KIT,new note',
      knownOrders: known(),
      existingOverlays: existing(),
      defaultYear: 2026,
    }
    assert.equal(
      buildKitImportPreview(options).digest,
      buildKitImportPreview(options).digest
    )
  })
})

describe('kit date rules', () => {
  it('rejects impossible dates instead of normalizing them', () => {
    assert.equal(parseKitImportDate('2/29/2025', 2025), null)
    assert.equal(parseKitImportDate('2/29/2028', 2028), '2028-02-29')
  })

  it('subtracts transit in business days, skipping the weekend', () => {
    assert.equal(shipDeadline('2026-08-10', 2), '2026-08-06')
  })
})
