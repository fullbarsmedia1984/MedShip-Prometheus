import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HerculesApiClient,
  HerculesEnvelopeValidationError,
  HerculesForbiddenError,
  HerculesRateLimitExceededError,
  HerculesUnauthorizedError,
} from '../api-client'
import {
  ApiHerculesPricingSource,
  normalizeHerculesApiPart,
} from '../api-source'
import {
  apiPartWithMissingCost,
  apiPartWithMultipleUnitsAndPerBox,
  apiPartWithMultipleVendors,
  apiPartWithNumericCost,
  herculesApiEnvelope,
  herculesApiPartsPage,
} from '../api-fixtures'
import { importHerculesPricing } from '../importer'
import { InMemoryHerculesImportRepository } from '../in-memory-repository'
import { parsePerText } from '../per-parser'

function jsonResponse(
  body: unknown,
  options: {
    status?: number
    headers?: Record<string, string>
  } = {}
) {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}

function createClient(fetchImpl: typeof fetch) {
  return new HerculesApiClient({
    baseUrl: 'https://hercules-dev.medicalshipment.com',
    appId: '65fc01d2a4b71c0c0e3a9f88',
    accessToken: 'test-token',
    fetchImpl,
  })
}

describe('HerculesApiClient', () => {
  it('parses response envelopes and captures rate-limit headers', async () => {
    const requests: unknown[] = []
    const client = createClient(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return jsonResponse(herculesApiEnvelope(herculesApiPartsPage([apiPartWithNumericCost])), {
        headers: {
          'X-RateLimit-Limit': '200',
          'X-RateLimit-Remaining': '199',
          'X-RateLimit-Reset': '2026-06-03T13:00:00.000Z',
        },
      })
    })

    const result = await client.listParts({ limit: 1, offset: 0 })

    assert.equal(result.page.data.length, 1)
    assert.deepEqual(requests[0], { limit: 1, offset: 0 })
    assert.deepEqual(client.lastRateLimit, {
      limit: 200,
      remaining: 199,
      reset: '2026-06-03T13:00:00.000Z',
    })
  })

  it('rejects invalid response envelopes', async () => {
    const client = createClient(async () => jsonResponse({ data: [] }))

    await assert.rejects(
      () => client.listParts({ limit: 1, offset: 0 }),
      HerculesEnvelopeValidationError
    )
  })

  it('throws typed errors for 401 and 403 responses', async () => {
    const expiredClient = createClient(async () =>
      jsonResponse(
        herculesApiEnvelope(null, '/api/v1/parts/list', 401, 'Access token has expired.'),
        { status: 401 }
      )
    )
    await assert.rejects(
      () => expiredClient.listParts({ limit: 1, offset: 0 }),
      HerculesUnauthorizedError
    )

    const forbiddenClient = createClient(async () =>
      jsonResponse(
        herculesApiEnvelope(
          null,
          '/api/v1/parts/list',
          403,
          'Not authorized for data egress (export).'
        ),
        { status: 403 }
      )
    )
    await assert.rejects(
      () => forbiddenClient.listParts({ limit: 1, offset: 0 }),
      HerculesForbiddenError
    )
  })
})

describe('ApiHerculesPricingSource', () => {
  it('builds delta request bodies with updatedAt gte cursor', () => {
    const source = new ApiHerculesPricingSource({
      client: createClient(async () => jsonResponse(herculesApiEnvelope(herculesApiPartsPage([])))),
      pageSize: 50,
      updatedSince: '2026-05-20T00:00:00Z',
    })

    assert.deepEqual(source.buildRequestBody(100), {
      limit: 50,
      offset: 100,
      sortBy: 'updatedAt',
      sortOrder: 'ASC',
      filters: [
        {
          field: 'updatedAt',
          operator: 'gte',
          value: '2026-05-20T00:00:00Z',
        },
      ],
    })
  })

  it('paginates through parts/list pages', async () => {
    const requests: unknown[] = []
    const pages = [
      herculesApiPartsPage([apiPartWithNumericCost], {
        limit: 1,
        offset: 0,
        total: 2,
        hasNext: true,
      }),
      herculesApiPartsPage([apiPartWithMissingCost], {
        limit: 1,
        offset: 1,
        total: 2,
        hasNext: false,
      }),
    ]
    const client = createClient(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return jsonResponse(herculesApiEnvelope(pages.shift()))
    })
    const source = new ApiHerculesPricingSource({ client, pageSize: 1 })

    const items = []
    for await (const item of source.getSupplierItems()) {
      items.push(item)
    }

    assert.equal(items.length, 2)
    assert.deepEqual(requests, [
      { limit: 1, offset: 0 },
      { limit: 1, offset: 1 },
    ])
  })

  it('backs off when successful responses report low remaining rate limit', async () => {
    const sleeps: number[] = []
    const pages = [
      herculesApiPartsPage([apiPartWithNumericCost], {
        limit: 1,
        offset: 0,
        total: 2,
        hasNext: true,
      }),
      herculesApiPartsPage([apiPartWithMissingCost], {
        limit: 1,
        offset: 1,
        total: 2,
        hasNext: false,
      }),
    ]
    const client = createClient(async () =>
      jsonResponse(herculesApiEnvelope(pages.shift()), {
        headers: {
          'X-RateLimit-Remaining': pages.length === 1 ? '1' : '50',
          'X-RateLimit-Reset': new Date(Date.now() + 25).toISOString(),
        },
      })
    )
    const source = new ApiHerculesPricingSource({
      client,
      pageSize: 1,
      lowRateLimitRemainingThreshold: 10,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    for await (const item of source.getSupplierItems()) {
      assert.ok(item)
    }

    assert.equal(sleeps.length, 1)
    assert.ok(sleeps[0] >= 0)
  })

  it('retries after rate-limit exceeded using injected sleep', async () => {
    const sleeps: number[] = []
    let calls = 0
    const client = createClient(async () => {
      calls += 1
      if (calls === 1) {
        return jsonResponse(
          herculesApiEnvelope(null, '/api/v1/parts/list', 403, 'Rate limit exceeded.'),
          { status: 403 }
        )
      }

      return jsonResponse(herculesApiEnvelope(herculesApiPartsPage([apiPartWithNumericCost])))
    })
    const source = new ApiHerculesPricingSource({
      client,
      rateLimitFallbackDelayMs: 123,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    const items = []
    for await (const item of source.getSupplierItems()) {
      items.push(item)
    }

    assert.equal(items.length, 1)
    assert.equal(calls, 2)
    assert.deepEqual(sleeps, [123])
  })

  it('surfaces rate-limit exceeded after bounded retries', async () => {
    const client = createClient(async () =>
      jsonResponse(
        herculesApiEnvelope(null, '/api/v1/parts/list', 403, 'Rate limit exceeded.'),
        { status: 403 }
      )
    )
    const source = new ApiHerculesPricingSource({
      client,
      maxRateLimitRetries: 0,
      sleep: async () => {},
    })

    await assert.rejects(async () => {
      for await (const item of source.getSupplierItems()) {
        assert.ok(item)
      }
    }, HerculesRateLimitExceededError)
  })

  it('normalizes API parts and preserves raw payloads', () => {
    const normalized = normalizeHerculesApiPart(apiPartWithMultipleVendors, {
      costIsConfirmedContractCost: false,
    })

    assert.ok(normalized)
    assert.equal(normalized.vendorOffers.length, 2)
    const rawVendors = apiPartWithMultipleVendors.vendors as Array<{
      units: unknown[]
    }>
    assert.equal(normalized.rawPayload, apiPartWithMultipleVendors)
    assert.equal(normalized.vendorOffers[0].rawPayload, rawVendors[0])
    assert.equal(normalized.vendorOffers[0].uoms[0].rawPayload, rawVendors[0].units[0])
  })

  it('feeds the existing importer while keeping API cost ineligible by default', async () => {
    const repository = new InMemoryHerculesImportRepository()
    const client = createClient(async () =>
      jsonResponse(
        herculesApiEnvelope(
          herculesApiPartsPage([
            apiPartWithNumericCost,
            apiPartWithMultipleUnitsAndPerBox,
          ])
        )
      )
    )

    await importHerculesPricing(
      new ApiHerculesPricingSource({ client }),
      repository
    )

    const numericUom = [...repository.offerUoms.values()].find(
      (uom) => uom.vendorPartNumber === 'API-COST-001'
    )
    const boxUom = [...repository.offerUoms.values()].find(
      (uom) => uom.vendorPartNumber === 'API-UNIT-BX'
    )

    assert.ok(numericUom)
    assert.equal(numericUom.contractPriceAmount, 12.5)
    assert.equal(numericUom.contractPriceStatus, 'unknown')
    assert.equal(numericUom.isCostEligible, false)
    assert.equal(numericUom.quantityAvailable, 22)
    assert.equal(numericUom.volume, '3.25')
    assert.equal(numericUom.volumeUom, 'CF')

    assert.ok(boxUom)
    assert.equal(boxUom.rawPerText, '100/BX')
    assert.equal(boxUom.parsedPerQuantity, 100)
    assert.equal(boxUom.parsedPerUom, 'BX')
    assert.equal(boxUom.perQuantity, 100)
    assert.equal(boxUom.isDefault, true)
  })

  it('allows explicitly confirmed API costs to use existing eligibility rules', async () => {
    const repository = new InMemoryHerculesImportRepository()
    const client = createClient(async () =>
      jsonResponse(herculesApiEnvelope(herculesApiPartsPage([apiPartWithNumericCost])))
    )

    await importHerculesPricing(
      new ApiHerculesPricingSource({
        client,
        costIsConfirmedContractCost: true,
      }),
      repository
    )

    const numericUom = [...repository.offerUoms.values()].find(
      (uom) => uom.vendorPartNumber === 'API-COST-001'
    )

    assert.ok(numericUom)
    assert.equal(numericUom.contractPriceStatus, 'contract_available')
    assert.equal(numericUom.isCostEligible, true)
  })
})

describe('parsePerText', () => {
  it('parses per strings conservatively', () => {
    assert.deepEqual(parsePerText('100/BX'), {
      rawPerText: '100/BX',
      parsedPerQuantity: 100,
      parsedPerUom: 'BX',
    })
    assert.deepEqual(parsePerText('1/EA'), {
      rawPerText: '1/EA',
      parsedPerQuantity: 1,
      parsedPerUom: 'EA',
    })
    assert.deepEqual(parsePerText(null), {
      rawPerText: null,
      parsedPerQuantity: null,
      parsedPerUom: null,
    })
    assert.deepEqual(parsePerText(undefined), {
      rawPerText: null,
      parsedPerQuantity: null,
      parsedPerUom: null,
    })
    assert.deepEqual(parsePerText('case of 100'), {
      rawPerText: 'case of 100',
      parsedPerQuantity: null,
      parsedPerUom: null,
    })
  })
})
