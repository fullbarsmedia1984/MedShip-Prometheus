import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it } from 'node:test'

const SCRIPT = 'scripts/pricing-contract-migration.mjs'

function writeFixture(root, overrides = {}) {
  const dryRun = join(root, 'synthetic_dry_run')
  void overrides
  return dryRun
}

function createDryRun(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pricing-migration-'))
  const dryRun = writeFixture(root, overrides)
  mkdirSync(dryRun, { recursive: true })
  const summary = {
    rows_scanned: 1,
    proposed_rows: 1,
    valid_rows: overrides.validation_status === 'blocking' ? 0 : 1,
    warning_rows: 0,
    blocking_exception_rows: overrides.validation_status === 'blocking' ? 1 : 0,
    exception_counts: overrides.validation_status === 'blocking' ? { MISSING_PRICE: 1 } : {},
  }
  writeFileSync(join(dryRun, 'dry_run_summary.json'), JSON.stringify(summary))
  const row = {
    ingestion_row_id: 'synthetic:row:1',
    profile_name: 'synthetic_v2',
    profile_version: '2.0.0',
    distributor_name: 'Fictional Distributor',
    distributor_id: '',
    contract_number: 'FICTIONAL-CONTRACT',
    effective_date: '2026-01-01',
    source_file: 'fictional.xlsx',
    source_file_hash: 'abc123',
    source_sheet_name: 'Pricing',
    source_row_number: '2',
    source_column_map: JSON.stringify({ price: 'D', raw_price_uom: 'C' }),
    source_cell_map: JSON.stringify({ price: 'D2', raw_price_uom: 'C2' }),
    formula_fields: '[]',
    validation_status: 'valid',
    exception_codes: '[]',
    warning_codes: '[]',
    raw_price_uom: 'EA',
    normalized_price_uom: 'EA',
    price: '1.23',
    ...overrides,
  }
  writeFileSync(join(dryRun, 'proposed_rows.csv'), `${Object.keys(row).join(',')}\n${Object.values(row).map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')}\n`)
  writeFileSync(join(dryRun, 'exceptions.csv'), 'exception_code,severity,source_file,source_sheet,source_row,source_cell,canonical_field,raw_value_summary,message\n')
  writeFileSync(join(dryRun, 'excluded_rows.csv'), 'source_file,source_sheet,source_row,reason,message,decision_id\n')
  writeFileSync(join(dryRun, 'mapping_review.md'), '# Mapping Review\n')
  return dryRun
}

function runCli(args, env = {}) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

describe('pricing contract migration CLI', () => {
  it('preflights a sanitized dry-run fixture with aggregate output', () => {
    const dryRun = createDryRun()
    const output = JSON.parse(runCli(['preflight', '--dry-run', dryRun]))
    assert.equal(output.rowsFound, 1)
    assert.equal(output.canStage, true)
    assert.equal(output.metadataGaps, 0)
    assert.equal(output.lineageGaps, 0)
  })

  it('blocks staging when Supabase credentials are missing', () => {
    const dryRun = createDryRun()
    assert.throws(
      () => runCli(['stage', '--dry-run', dryRun], { NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
      /Supabase service credentials are required/
    )
  })

  it('reports disabled publish command', () => {
    assert.throws(() => runCli(['publish', '--dry-run', 'unused']), /intentionally not implemented/)
  })
})
