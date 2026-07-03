import envPkg from '@next/env'

const { loadEnvConfig } = envPkg
loadEnvConfig(process.cwd())

const PAGE_SIZE = Number(process.env.FISHBOWL_SO_PROBE_PAGE_SIZE ?? 5)

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function cfHeaders(includeJson = false) {
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    ...(process.env.FISHBOWL_CF_ACCESS_CLIENT_ID
      ? { 'CF-Access-Client-Id': process.env.FISHBOWL_CF_ACCESS_CLIENT_ID }
      : {}),
    ...(process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET
      ? { 'CF-Access-Client-Secret': process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET }
      : {}),
  }
}

function rows(page) {
  return page?.results ?? page?.salesOrders ?? page?.data ?? []
}

function pick(order) {
  return {
    id: order?.id ?? null,
    number: order?.number ?? order?.soNumber ?? order?.salesOrderNumber ?? null,
    status: order?.status ?? order?.statusName ?? null,
    customer: order?.customerName ?? order?.customer?.name ?? null,
    salesperson: order?.salesperson?.name ?? order?.salesPerson?.name ?? order?.salesperson ?? order?.salesPerson ?? null,
    dateCreated: order?.dateCreated ?? order?.createdDate ?? order?.createdAt ?? null,
    dateIssued: order?.dateIssued ?? order?.issuedDate ?? null,
    dateCompleted: order?.dateCompleted ?? order?.completedDate ?? null,
  }
}

function metricDate(order) {
  const values = [order.dateIssued, order.dateCompleted, order.dateCreated]
    .filter(Boolean)
    .map((value) => new Date(String(value)).getTime())
    .filter(Number.isFinite)
  return values.length ? new Date(Math.max(...values)).toISOString() : null
}

function summarize(path, response, bodyText) {
  let json = null
  try {
    json = JSON.parse(bodyText)
  } catch {
    // Keep non-JSON bodies visible in bodyPrefix.
  }

  const resultRows = rows(json)
  const samples = resultRows.slice(0, PAGE_SIZE).map(pick)
  const newestMetricAt = samples
    .map(metricDate)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null

  return {
    path,
    status: response.status,
    ok: response.ok,
    totalPages: json?.totalPages ?? null,
    totalCount: json?.totalCount ?? null,
    count: resultRows.length,
    newestMetricAt,
    samples,
    bodyPrefix: response.ok ? undefined : bodyText.slice(0, 300),
  }
}

async function fishbowlGet(baseUrl, token, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      ...cfHeaders(false),
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  return summarize(path, response, text)
}

async function main() {
  const baseUrl = requireEnv('FISHBOWL_API_URL').replace(/\/+$/, '')
  const explicitPaths = process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('/api/'))

  let token = null
  try {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: cfHeaders(true),
      body: JSON.stringify({
        appName: process.env.FISHBOWL_APP_NAME ?? 'MedShip Prometheus',
        appDescription:
          process.env.FISHBOWL_APP_DESCRIPTION ?? 'Medical Shipment internal Zeus integration',
        appId: Number(process.env.FISHBOWL_APP_ID ?? 20260505),
        username: requireEnv('FISHBOWL_USERNAME'),
        password: requireEnv('FISHBOWL_PASSWORD'),
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!login.ok) {
      throw new Error(`Fishbowl login failed ${login.status}: ${await login.text()}`)
    }

    token = (await login.json()).token
    if (!token) throw new Error('Fishbowl login response did not include a token')

    const paths = explicitPaths.length > 0
      ? explicitPaths
      : [
          `/api/sales-orders?pageNumber=1&pageSize=${PAGE_SIZE}`,
          `/api/sales-orders?pageNumber=326&pageSize=${PAGE_SIZE}`,
          `/api/sales-orders?pageNumber=652&pageSize=${PAGE_SIZE}`,
          `/api/sales-orders?pageNumber=1&pageSize=${PAGE_SIZE}&sortBy=dateCreated&sortOrder=DESC`,
          `/api/sales-orders?pageNumber=1&pageSize=${PAGE_SIZE}&sortBy=dateIssued&sortOrder=DESC`,
          `/api/sales-orders?pageNumber=1&pageSize=${PAGE_SIZE}&orderBy=dateCreated&direction=DESC`,
          `/api/sales-orders?pageNumber=1&pageSize=${PAGE_SIZE}&orderBy=dateIssued&direction=DESC`,
          `/api/sales-orders?pageNumber=1&pageSize=${PAGE_SIZE}&dateCreatedFrom=2026-06-01`,
          `/api/sales-orders?pageNumber=1&pageSize=${PAGE_SIZE}&dateIssuedFrom=2026-06-01`,
          '/api/sales-orders?number=137497-REP',
          '/api/sales-orders/182154',
          '/api/sales-orders/182155',
        ]

    for (const path of paths) {
      console.log(JSON.stringify(await fishbowlGet(baseUrl, token, path)))
    }
  } finally {
    if (token) {
      await fetch(`${baseUrl}/api/logout`, {
        method: 'POST',
        headers: {
          ...cfHeaders(false),
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {})
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
