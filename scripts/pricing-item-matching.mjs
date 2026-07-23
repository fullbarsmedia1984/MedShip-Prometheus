#!/usr/bin/env node
// Headless runner for contract-pricing item matching (Phase B).
// Output is aggregate-safe: counts and statuses only, never identifiers or prices.
//
//   node scripts/pricing-item-matching.mjs sync-spine
//   node scripts/pricing-item-matching.mjs suggest --batch <batch-uuid>
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// Approval of suggestions is dashboard-only so every link is attributed
// to a reviewer.

import { createClient } from '@supabase/supabase-js'

function parseArgs(argv) {
  const args = { command: argv[0] }
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--batch') {
      args.batch = argv[index + 1]
      index += 1
    }
  }
  return args
}

function supabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service credentials are required (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === 'sync-spine') {
    const supabase = supabaseClient()
    const { data, error } = await supabase.rpc('pricing_sync_products_from_inventory')
    if (error) throw new Error(error.message)
    console.log(JSON.stringify(data, null, 2))
    return
  }

  if (args.command === 'suggest') {
    if (!/^[0-9a-f-]{36}$/i.test(String(args.batch ?? ''))) {
      throw new Error('Usage: node scripts/pricing-item-matching.mjs suggest --batch <batch-uuid>')
    }
    const supabase = supabaseClient()
    const { data, error } = await supabase.rpc('pricing_suggest_cost_line_item_matches', {
      p_batch_id: args.batch,
    })
    if (error) throw new Error(error.message)
    console.log(JSON.stringify(data, null, 2))
    return
  }

  if (args.command === 'approve' || args.command === 'reject') {
    throw new Error(`${args.command} is intentionally not implemented in the CLI. Review suggestions in the dashboard so the decision is attributed to a reviewer.`)
  }

  throw new Error('Usage: node scripts/pricing-item-matching.mjs <sync-spine|suggest --batch <id>>')
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }))
  process.exitCode = 1
})
