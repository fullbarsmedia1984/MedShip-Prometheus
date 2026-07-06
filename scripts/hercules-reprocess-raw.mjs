// Re-derive normalized Hercules catalog rows from the preserved raw
// payloads — no Hercules API calls. Use after a normalizer fix so rows
// ingested under the old mapping pick up the correction (e.g. the
// populated vendorId/manufacturerId references the first import missed).
//
// Usage:
//   node scripts/hercules-reprocess-raw.mjs [--batch-size N] [--limit N]
//
// Safe to run while the API import is active: upserts are idempotent by
// source key, and per-item failures are retried once then logged without
// stopping the sweep.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const jiti = require('jiti')(fileURLToPath(import.meta.url), {
  alias: {
    '@': path.join(path.dirname(fileURLToPath(import.meta.url)), '../src'),
    'server-only': require.resolve('next/dist/compiled/server-only/empty.js'),
  },
  interopDefault: true,
})

const { normalizeHerculesApiPart } = jiti('../src/lib/hercules/api-source.ts')
const { emptyImportCounters, importHerculesSupplierItemsBatch } = jiti('../src/lib/hercules/importer.ts')
const { SupabaseHerculesPricingRepository } = jiti('../src/lib/hercules/supabase-repository.ts')
const { createAdminClient } = jiti('../src/lib/supabase/admin.ts')

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

async function main() {
  const batchSize = Number(argValue('--batch-size', '200'))
  const concurrency = Number(argValue('--concurrency', '12'))
  const limit = Number(argValue('--limit', String(Number.MAX_SAFE_INTEGER)))

  const supabase = createAdminClient()
  const repository = new SupabaseHerculesPricingRepository()
  const counters = emptyImportCounters()
  const job = await repository.createImportJob({ sourceMode: 'direct_db', supplierCode: null })
  console.log(JSON.stringify({ reprocessJobId: job.id, batchSize }))

  let cursor = ''
  let processed = 0
  let failed = 0
  const startedAt = Date.now()

  while (processed < limit) {
    let query = supabase
      .from('hercules_catalog_items')
      .select('id, raw_payload')
      .order('id', { ascending: true })
      .limit(batchSize)
    if (cursor) query = query.gt('id', cursor)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    const normalizedItems = data
      .map((row) => normalizeHerculesApiPart(row.raw_payload, { useLegacyCostFallback: false }))
      .filter(Boolean)

    const results = await importHerculesSupplierItemsBatch(normalizedItems, {
      repository,
      jobId: job.id,
      counters,
      concurrency,
    })

    for (const result of results) {
      if (!result.error) continue
      // One sequential retry absorbs upsert races with the concurrent
      // API import; a second failure is logged and skipped.
      const retryResults = await importHerculesSupplierItemsBatch([result.item], {
        repository,
        jobId: job.id,
        counters,
        concurrency: 1,
      })
      // Undo the retry's duplicate rowsSeen and the now-superseded first
      // rejection; a failed retry has its own rowsRejected increment.
      counters.rowsSeen -= 1
      counters.rowsRejected -= 1

      const retryError = retryResults[0]?.error
      if (retryError) {
        failed += 1
        console.log(
          JSON.stringify({
            status: 'item_failed',
            itemId: result.item.supplierItemId,
            message: retryError.message,
          })
        )
      }
    }

    cursor = data[data.length - 1].id
    processed += data.length

    if (processed % 5000 < batchSize) {
      const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1)
      console.log(
        JSON.stringify({ status: 'progress', processed, failed, elapsedMin, cursor })
      )
    }
  }

  await repository.completeImportJob(job.id, {
    status: failed > 0 ? 'partial' : 'success',
    counters,
    errors: failed > 0 ? [`${failed} item(s) failed reprocessing`] : [],
  })

  console.log(
    JSON.stringify({ status: 'done', processed, failed, minutes: ((Date.now() - startedAt) / 60000).toFixed(1) })
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
