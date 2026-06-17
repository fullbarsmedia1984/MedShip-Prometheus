import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const jiti = require('jiti')(path.join(process.cwd(), 'scripts/hercules-api-smoke.mjs'), {
  alias: {
    '@': path.join(process.cwd(), 'src'),
    'server-only': path.join(
      process.cwd(),
      'node_modules/next/dist/compiled/server-only/empty.js'
    ),
  },
  interopDefault: true,
})

const { HerculesApiClient } = jiti('../src/lib/hercules/api-client.ts')
const { ApiHerculesPricingSource } = jiti('../src/lib/hercules/api-source.ts')
const { importHerculesPricing } = jiti('../src/lib/hercules/importer.ts')
const {
  SupabaseHerculesPricingRepository,
} = jiti('../src/lib/hercules/supabase-repository.ts')

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function booleanEnv(name) {
  return process.env[name]?.toLowerCase() === 'true'
}

async function main() {
  const pageSize = Number(process.env.HERCULES_API_SMOKE_LIMIT ?? '1')
  const client = new HerculesApiClient({
    baseUrl: process.env.HERCULES_API_BASE_URL,
    appId: requireEnv('HERCULES_API_APP_ID'),
    accessToken: requireEnv('HERCULES_API_ACCESS_TOKEN'),
    timeoutMs: Number(process.env.HERCULES_API_TIMEOUT_MS ?? '30000'),
  })

  const source = new ApiHerculesPricingSource({
    client,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 1,
    costIsConfirmedContractCost: booleanEnv('HERCULES_API_COST_IS_CONTRACT_COST'),
  })

  const result = await importHerculesPricing(
    source,
    new SupabaseHerculesPricingRepository()
  )

  console.log(
    JSON.stringify(
      {
        endpoint: '/api/v1/parts/list',
        baseUrl: client.baseUrl,
        pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 1,
        rateLimit: client.lastRateLimit,
        importJob: result,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
