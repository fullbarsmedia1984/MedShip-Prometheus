import envPkg from '@next/env'
import { createClient } from '@supabase/supabase-js'
import jsforce from 'jsforce'

const { loadEnvConfig } = envPkg
loadEnvConfig(process.cwd())

const PAGE_SIZE = 100
const FISHBOWL_APP_ID = Number(process.env.FISHBOWL_APP_ID ?? 20260505)
const FISHBOWL_APP_NAME = process.env.FISHBOWL_APP_NAME ?? 'MedShip Prometheus'
const FISHBOWL_APP_DESCRIPTION =
  process.env.FISHBOWL_APP_DESCRIPTION ?? 'Medical Shipment internal Zeus integration'

const args = new Set(process.argv.slice(2))
const writeSnapshot = args.has('--write-fishbowl-snapshot')
const skipFishbowl = args.has('--skip-fishbowl')
const skipSalesforce = args.has('--skip-salesforce-health')
const skipStatus = args.has('--skip-status')

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function redact(input) {
  let text = String(input)
  for (const name of [
    'FISHBOWL_PASSWORD',
    'FISHBOWL_CF_ACCESS_CLIENT_ID',
    'FISHBOWL_CF_ACCESS_CLIENT_SECRET',
    'SF_PASSWORD',
    'SF_SECURITY_TOKEN',
    'SF_CLIENT_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'INNGEST_EVENT_KEY',
    'INNGEST_SIGNING_KEY',
  ]) {
    const value = process.env[name]
    if (value && value.length > 2) {
      text = text.split(value).join('[REDACTED]')
    }
  }
  return text
}

function logJson(label, value) {
  console.log(`${label}: ${JSON.stringify(value, null, 2)}`)
}

function fishbowlHeaders(includeJson = true) {
  const headers = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  if (process.env.FISHBOWL_CF_ACCESS_CLIENT_ID && process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = process.env.FISHBOWL_CF_ACCESS_CLIENT_ID
    headers['CF-Access-Client-Secret'] = process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET
  }
  return headers
}

async function fishbowlRequest(path, token) {
  const baseUrl = requireEnv('FISHBOWL_API_URL').replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      ...fishbowlHeaders(false),
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    throw new Error(`Fishbowl ${path} failed with HTTP ${response.status}: ${await response.text()}`)
  }

  return response.json()
}

async function authenticateFishbowl() {
  const baseUrl = requireEnv('FISHBOWL_API_URL').replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: fishbowlHeaders(),
    body: JSON.stringify({
      appName: FISHBOWL_APP_NAME,
      appDescription: FISHBOWL_APP_DESCRIPTION,
      appId: FISHBOWL_APP_ID,
      username: requireEnv('FISHBOWL_USERNAME'),
      password: requireEnv('FISHBOWL_PASSWORD'),
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    throw new Error(`Fishbowl login failed with HTTP ${response.status}: ${await response.text()}`)
  }

  const data = await response.json()
  if (!data.token) throw new Error('Fishbowl login response did not include a token')
  return {
    token: data.token,
    version: data.serverVersion ?? data.user?.serverVersion ?? null,
  }
}

async function pullFishbowlInventory() {
  const auth = await authenticateFishbowl()
  const firstPage = await fishbowlRequest(
    `/api/parts/inventory?pageNumber=1&pageSize=${PAGE_SIZE}`,
    auth.token
  )

  const totalPages = Number(firstPage.totalPages ?? 1)
  const items = [...(firstPage.results ?? [])]

  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
    const page = await fishbowlRequest(
      `/api/parts/inventory?pageNumber=${pageNumber}&pageSize=${PAGE_SIZE}`,
      auth.token
    )
    items.push(...(page.results ?? []))
  }

  const qtyOnHand = items.reduce((sum, item) => sum + (Number.parseFloat(item.quantity) || 0), 0)
  logJson('fishbowl.pull', {
    connected: true,
    version: auth.version,
    pages: totalPages,
    records: items.length,
    qtyOnHand,
    samplePartNumbers: items.slice(0, 5).map((item) => item.partNumber),
  })

  return items
}

function createSupabaseAdmin() {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function writeInventorySnapshot(items) {
  const supabase = createSupabaseAdmin()
  let written = 0

  for (let index = 0; index < items.length; index += PAGE_SIZE) {
    const rows = items.slice(index, index + PAGE_SIZE).map((item) => ({
      part_number: item.partNumber,
      part_description: item.partDescription || null,
      qty_on_hand: Number.parseFloat(item.quantity) || 0,
      qty_allocated: 0,
      qty_available: Number.parseFloat(item.quantity) || 0,
      uom: item.uom?.abbreviation || 'ea',
      fishbowl_part_id: item.id,
      last_synced_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('inventory_snapshot')
      .upsert(rows, { onConflict: 'part_number' })

    if (error) throw new Error(`Supabase inventory_snapshot upsert failed: ${error.message}`)
    written += rows.length
  }

  logJson('fishbowl.snapshot', { written })
}

async function checkSalesforceLogin() {
  const loginUrl = process.env.SF_LOGIN_URL || 'https://login.salesforce.com'
  const conn = new jsforce.Connection({
    loginUrl,
    oauth2:
      process.env.SF_CLIENT_ID &&
      process.env.SF_CLIENT_SECRET &&
      process.env.SF_CLIENT_ID.length > 10 &&
      process.env.SF_CLIENT_SECRET.length > 10
        ? {
            loginUrl,
            clientId: process.env.SF_CLIENT_ID,
            clientSecret: process.env.SF_CLIENT_SECRET,
          }
        : undefined,
  })

  await conn.login(
    requireEnv('SF_USERNAME'),
    `${requireEnv('SF_PASSWORD')}${requireEnv('SF_SECURITY_TOKEN')}`
  )

  const identity = await conn.identity()
  logJson('salesforce.health', {
    connected: true,
    orgId: identity.organization_id,
  })
  await conn.logout().catch(() => {})
}

async function readStatus() {
  const supabase = createSupabaseAdmin()
  const [snapshotCount, snapshotFreshness, sfState, recentP2] = await Promise.all([
    supabase.from('inventory_snapshot').select('*', { count: 'exact', head: true }),
    supabase
      .from('inventory_snapshot')
      .select('last_synced_at')
      .order('last_synced_at', { ascending: false })
      .limit(1),
    supabase
      .from('sf_sync_state')
      .select('table_name, record_count, last_full_sync_at, last_incremental_sync_at, last_error')
      .order('table_name'),
    supabase
      .from('sync_events')
      .select('created_at, automation, status, error_message, retry_count')
      .eq('automation', 'P2_INVENTORY_SYNC')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  if (snapshotCount.error) throw new Error(snapshotCount.error.message)
  if (snapshotFreshness.error) throw new Error(snapshotFreshness.error.message)
  if (sfState.error) throw new Error(sfState.error.message)
  if (recentP2.error) throw new Error(recentP2.error.message)

  logJson('supabase.status', {
    inventorySnapshotCount: snapshotCount.count,
    inventorySnapshotLatest: snapshotFreshness.data?.[0]?.last_synced_at ?? null,
    sfSyncState: sfState.data,
    recentP2Events: recentP2.data,
  })
}

async function main() {
  try {
    let inventory = []

    if (!skipFishbowl) {
      inventory = await pullFishbowlInventory()
      if (writeSnapshot) await writeInventorySnapshot(inventory)
    }

    if (!skipSalesforce) {
      try {
        await checkSalesforceLogin()
      } catch (error) {
        logJson('salesforce.health', {
          connected: false,
          error: redact(error instanceof Error ? error.message : error),
        })
      }
    }

    if (!skipStatus) await readStatus()
  } catch (error) {
    console.error(redact(error instanceof Error ? error.stack || error.message : error))
    process.exitCode = 1
  }
}

main()
