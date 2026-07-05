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

const {
  HerculesApiClient,
  HerculesMissingCredentialsError,
} = jiti('../src/lib/hercules/api-client.ts')
const { ApiHerculesPricingSource } = jiti('../src/lib/hercules/api-source.ts')
const { importHerculesPricing } = jiti('../src/lib/hercules/importer.ts')
const {
  SupabaseHerculesPricingRepository,
} = jiti('../src/lib/hercules/supabase-repository.ts')

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new HerculesMissingCredentialsError(`${name} is required`)
  return value
}

async function main() {
  const pageSize = Number(process.env.HERCULES_API_SMOKE_LIMIT ?? '1')
  const client = new HerculesApiClient({
    baseUrl: requireEnv('HERCULES_API_BASE_URL'),
    appId: requireEnv('HERCULES_API_APP_ID'),
    accessToken: requireEnv('HERCULES_API_ACCESS_TOKEN'),
    timeoutMs: Number(process.env.HERCULES_API_TIMEOUT_MS ?? '30000'),
  })

  const source = new ApiHerculesPricingSource({
    client,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 1,
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
  if (error instanceof Error) {
    console.error(
      JSON.stringify(
        {
          name: error.name,
          message: error.message,
        },
        null,
        2
      )
    )
  } else {
    console.error('Unknown Hercules API smoke script error')
  }
  process.exitCode = 1
})
