// Backfill (or top up) semantic embeddings for the Hercules catalog.
// Re-runnable: only touches rows where embedding IS NULL, so it doubles
// as the top-up sweep after delta imports add or refresh items.
//
// Usage:
//   node scripts/hercules-embed-catalog.mjs [--batch-size N] [--limit N]
//
// Requires OPENAI_API_KEY and DG_URL (direct Postgres) in the environment.
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

const { embedTexts, catalogEmbeddingText, toVectorLiteral } = jiti(
  '../src/lib/hercules/embeddings.ts'
)
const { Client } = require('pg')

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

async function main() {
  const batchSize = Number(argValue('--batch-size', '500'))
  const limit = Number(argValue('--limit', String(Number.MAX_SAFE_INTEGER)))

  const client = new Client({
    connectionString: process.env.DG_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120000,
  })
  await client.connect()

  let processed = 0
  let failures = 0
  const startedAt = Date.now()

  while (processed < limit) {
    const { rows } = await client.query(
      `SELECT id, description, brand, manufacturer_name, category, subcategory
       FROM hercules_catalog_items
       WHERE embedding IS NULL
       LIMIT $1`,
      [batchSize]
    )
    if (rows.length === 0) break

    const texts = rows.map((row) =>
      catalogEmbeddingText({
        description: row.description,
        brand: row.brand,
        manufacturerName: row.manufacturer_name,
        category: row.category,
        subcategory: row.subcategory,
      })
    )

    let vectors
    try {
      vectors = await embedTexts(texts)
    } catch (error) {
      failures += 1
      console.log(
        JSON.stringify({
          status: 'embed_error',
          attempt: failures,
          message: error instanceof Error ? error.message : String(error),
        })
      )
      if (failures >= 8) throw error
      await new Promise((resolve) => setTimeout(resolve, Math.min(15000 * failures, 60000)))
      continue
    }
    failures = 0

    await client.query(
      `UPDATE hercules_catalog_items i
       SET embedding = v.emb::halfvec(512), embedded_at = now()
       FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS emb) v
       WHERE i.id = v.id`,
      [rows.map((row) => row.id), vectors.map(toVectorLiteral)]
    )

    processed += rows.length
    if (processed % 10000 < batchSize) {
      console.log(
        JSON.stringify({
          status: 'progress',
          processed,
          elapsedMin: ((Date.now() - startedAt) / 60000).toFixed(1),
        })
      )
    }
  }

  console.log(
    JSON.stringify({
      status: 'done',
      processed,
      minutes: ((Date.now() - startedAt) / 60000).toFixed(1),
    })
  )
  await client.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
