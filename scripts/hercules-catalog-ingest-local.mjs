// Run (or resume) the P10 Hercules catalog ingestion from a local shell.
// The checkpoint lives in the shared hercules_ingestion_runs table, so a
// run started here is picked up seamlessly by the deployed Inngest
// pipeline (and vice versa).
//
// Usage:
//   node scripts/hercules-catalog-ingest-local.mjs [--run-type full|delta] [--max-pages N] [--page-size N]
//
// Requires HERCULES_API_* and Supabase env vars (see .env.example).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const jiti = require('jiti')(fileURLToPath(import.meta.url), {
  alias: {
    '@': path.join(scriptDir, '../src'),
    'server-only': require.resolve('next/dist/compiled/server-only/empty.js'),
  },
  interopDefault: true,
})

const { startOrResumeCatalogIngestion, ingestCatalogPages } = jiti(
  '../src/lib/hercules/catalog-ingestion.ts'
)
const { createHerculesApiClientFromEnv } = jiti('../src/lib/hercules/env.ts')
const { SupabaseHerculesPricingRepository } = jiti('../src/lib/hercules/supabase-repository.ts')
const { SupabaseHerculesIngestionRepository } = jiti('../src/lib/hercules/ingestion-repository.ts')

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

async function main() {
  const runType = argValue('--run-type', 'full') === 'delta' ? 'delta' : 'full'
  const maxPages = Number(argValue('--max-pages', '20'))
  const pageSize = Number(argValue('--page-size', '500'))
  const pagesPerBatch = 1

  const deps = {
    client: createHerculesApiClientFromEnv(),
    importRepository: new SupabaseHerculesPricingRepository(),
    ingestionRepository: new SupabaseHerculesIngestionRepository(),
  }

  const { run, resumed } = await startOrResumeCatalogIngestion(deps, {
    runType,
    pageSize,
    triggeredBy: 'local-script',
  })
  console.log(
    JSON.stringify({
      runId: run.id,
      resumed,
      runType: run.runType,
      nextOffset: run.nextOffset,
      totalRemote: run.totalRemote,
    })
  )

  // Unlike the Inngest pipeline (which gets step retries from the
  // platform), this script must survive transient network errors itself.
  const MAX_CONSECUTIVE_FAILURES = 10
  let consecutiveFailures = 0

  for (let processed = 0; processed < maxPages; processed += pagesPerBatch) {
    const startedAt = Date.now()
    let result
    try {
      result = await ingestCatalogPages(deps, {
        runId: run.id,
        maxPages: pagesPerBatch,
      })
      consecutiveFailures = 0
    } catch (error) {
      consecutiveFailures += 1
      const waitMs = Math.min(30_000 * consecutiveFailures, 5 * 60_000)
      console.log(
        JSON.stringify({
          status: 'transient_error',
          attempt: consecutiveFailures,
          retryInMs: waitMs,
          message: error instanceof Error ? error.message : String(error),
        })
      )
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw error
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      processed -= pagesPerBatch
      continue
    }
    console.log(
      JSON.stringify({
        status: result.status,
        nextOffset: result.nextOffset,
        totalRemote: result.totalRemote,
        rowsSeen: result.counters.rowsSeen,
        rowsRejected: result.counters.rowsRejected,
        pageMs: Date.now() - startedAt,
        resumeAt: result.resumeAt,
      })
    )

    if (result.status === 'completed') return
    if (result.status === 'rate_limited') {
      console.log(`Rate limited; resume after ${result.resumeAt}. Exiting.`)
      return
    }
  }

  console.log('Page budget reached; run is checkpointed and resumable.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
