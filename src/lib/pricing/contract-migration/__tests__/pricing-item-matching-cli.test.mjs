import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { describe, it } from 'node:test'

const SCRIPT = 'scripts/pricing-item-matching.mjs'

function runCli(args, env = {}) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

describe('pricing item matching CLI', () => {
  it('blocks sync-spine when Supabase credentials are missing', () => {
    assert.throws(
      () => runCli(['sync-spine'], { NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
      /Supabase service credentials are required/
    )
  })

  it('rejects suggest without a valid batch id', () => {
    assert.throws(
      () => runCli(['suggest', '--batch', 'not-a-uuid'], { NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
      /suggest --batch/
    )
  })

  it('keeps approval out of the CLI', () => {
    assert.throws(() => runCli(['approve']), /intentionally not implemented/)
  })
})
