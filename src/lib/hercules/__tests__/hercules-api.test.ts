import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HerculesApiClient,
  HerculesExpiredTokenError,
  HerculesEnvelopeValidationError,
  HerculesForbiddenError,
  HerculesInvalidTokenError,
  HerculesMissingCredentialsError,
  HerculesMissingEgressPermissionError,
  HerculesRateLimitExceededError,
  HerculesUnauthorizedError,
} from '../api-client'
import {
  ApiHerculesPricingSource,
  normalizeHerculesApiPart,
} from '../api-source'
import { runHerculesApiBackfillThenDelta } from '../api-sync'
import {
  apiPartWithBlankContractPrice,
  apiPartWithMissingCost,
  apiPartWithMultipleUnitsAndPerBox,
  apiPartWithMultipleVendors,
  apiPartWithNullContractPrice,
  apiPartWithNumericCost,
  apiPartWithRequestQuoteContractPrice,
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
    appId: 'test-app-id',
    accessToken: 'test-token',
    fetchImpl,
  })
}

describe('HerculesApiClient', () => {
  it('requires explicit credentials without exposing secret values', () => {
    assert.throws(
      () =>
        new HerculesApiClient({
          appId: '',
          accessToken: 'test-token',
          fetchImpl: async () => jsonResponse({}),
        }),
      (error) =>
        error instanceof HerculesMissingCredentialsError &&
        error.message === 'HERCULES_API_APP_ID is required' &&
        !error.message.includes('test-token')
    )

    assert.throws(
      () =>
        new HerculesApiClient({
          appId: 'test-app-id',
          accessToken: ' ',
          fetchImpl: async () => jsonResponse({}),
        }),
      (error) =>
        error instanceof HerculesMissingCredentialsError &&
        error.message === 'HERCULES_API_ACCESS_TOKEN is required' &&
        !error.message.includes('test-app-id')
    )
  })

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
    const invalidTokenClient = createClient(async () =>
      jsonResponse(
        herculesApiEnvelope(null, '/api/v1/parts/list', 401, 'Invalid access token.'),
        { status: 401 }
      )
    )
    await assert.rejects(
      () => invalidTokenClient.listParts({ limit: 1, offset: 0 }),
      HerculesInvalidTokenError
    )

    const expiredClient = createClient(async () =>
      jsonResponse(
        herculesApiEnvelope(null, '/api/v1/parts/list', 401, 'Access token has expired.'),
        { status: 401 }
      )
    )
    await assert.rejects(
      () => expiredClient.listParts({ limit: 1, offset: 0 }),
      HerculesExpiredTokenError
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
      HerculesMissingEgressPermissionError
    )

    const genericUnauthorizedClient = createClient(async () =>
      jsonResponse(
        herculesApiEnvelope(null, '/api/v1/parts/list', 401, 'Authentication required.'),
        { status: 401 }
      )
    )
    await assert.rejects(
      () => genericUnauthorizedClient.listParts({ limit: 1, offset: 0 }),
      HerculesUnauthorizedError
    )

    const genericForbiddenClient = createClient(async () =>
      jsonResponse(
        herculesApiEnvelope(null, '/api/v1/parts/list', 403, 'Forbidden.'),
        { status: 403 }
      )
    )
    await assert.rejects(
      () => genericForbiddenClient.listParts({ limit: 1, offset: 0 }),
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

  it('clamps page size to 500 and can scope requests by supplier code', () => {
    const source = new ApiHerculesPricingSource({
      client: createClient(async () => jsonResponse(herculesApiEnvelope(herculesApiPartsPage([])))),
      pageSize: 999,
      supplierCode: 'MEDLINE',
    })

    assert.deepEqual(source.buildRequestBody(0), {
      limit: 500,
      offset: 0,
      filters: [
        {
          field: 'vendors.supplierCode',
          operator: 'eq',
          value: 'MEDLINE',
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

  it('caps low-remaining backoff when reset is far in the future', async () => {
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
          'X-RateLimit-Reset': new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      })
    )
    const source = new ApiHerculesPricingSource({
      client,
      pageSize: 1,
      lowRateLimitRemainingThreshold: 10,
      maxRateLimitDelayMs: 250,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    for await (const item of source.getSupplierItems()) {
      assert.ok(item)
    }

    assert.deepEqual(sleeps, [250])
  })

  it('tracks the max updatedAt actually processed as the next delta cursor', async () => {
    const client = createClient(async () =>
      jsonResponse(
        herculesApiEnvelope(
          herculesApiPartsPage([
            { ...apiPartWithNumericCost, updatedAt: '2026-06-01T12:00:00.000Z' },
            { ...apiPartWithMissingCost, updatedAt: '2026-06-01T12:05:00.000Z' },
            { ...apiPartWithMultipleVendors, updatedAt: '2026-06-01T12:03:00.000Z' },
          ])
        )
      )
    )
    const source = new ApiHerculesPricingSource({ client })

    for await (const item of source.getSupplierItems()) {
      assert.ok(item)
    }

    assert.equal(source.latestProcessedUpdatedAt, '2026-06-01T12:05:00.000Z')
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

  it('uses the latest successful reset header when retrying rate-limit responses', async () => {
    const sleeps: number[] = []
    let calls = 0
    const reset = new Date(Date.now() + 120).toISOString()
    const client = createClient(async () => {
      calls += 1
      if (calls === 1) {
        return jsonResponse(
          herculesApiEnvelope(
            herculesApiPartsPage([apiPartWithNumericCost], {
              limit: 1,
              offset: 0,
              total: 2,
              hasNext: true,
            })
          ),
          {
            headers: {
              'X-RateLimit-Remaining': '50',
              'X-RateLimit-Reset': reset,
            },
          }
        )
      }
      if (calls === 2) {
        return jsonResponse(
          herculesApiEnvelope(null, '/api/v1/parts/list', 403, 'Rate limit exceeded.'),
          { status: 403 }
        )
      }

      return jsonResponse(
        herculesApiEnvelope(
          herculesApiPartsPage([apiPartWithMissingCost], {
            limit: 1,
            offset: 1,
            total: 2,
            hasNext: false,
          })
        )
      )
    })
    const source = new ApiHerculesPricingSource({
      client,
      pageSize: 1,
      rateLimitFallbackDelayMs: 5_000,
      maxRateLimitDelayMs: 1_000,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    const items = []
    for await (const item of source.getSupplierItems()) {
      items.push(item)
    }

    assert.equal(items.length, 2)
    assert.equal(calls, 3)
    assert.equal(client.lastRateLimit.reset, reset)
    assert.equal(sleeps.length, 1)
    assert.ok(sleeps[0] >= 0)
    assert.ok(sleeps[0] <= 1_000)
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
      useLegacyCostFallback: false,
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

  it('feeds the existing importer using contractPrice as COGS and price as list price', async () => {
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
    assert.equal(numericUom.contractPriceStatus, 'contract_available')
    assert.equal(numericUom.listPriceAmount, 20)
    assert.equal(numericUom.isCostEligible, true)
    assert.equal(numericUom.rawPayload.price, '$20.00')
    assert.equal(numericUom.rawPayload.contractPrice, '$12.50')
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

  it('maps null, blank, and request-quote contractPrice values to ineligible statuses', async () => {
    const repository = new InMemoryHerculesImportRepository()
    const client = createClient(async () =>
      jsonResponse(
        herculesApiEnvelope(
          herculesApiPartsPage([
            apiPartWithNullContractPrice,
            apiPartWithBlankContractPrice,
            apiPartWithRequestQuoteContractPrice,
          ])
        )
      )
    )

    await importHerculesPricing(new ApiHerculesPricingSource({ client }), repository)

    const byVpn = (vpn: string) =>
      [...repository.offerUoms.values()].find((uom) => uom.vendorPartNumber === vpn)

    assert.equal(byVpn('API-MISSING-001')?.contractPriceStatus, 'not_provided')
    assert.equal(byVpn('API-MISSING-001')?.isCostEligible, false)
    assert.equal(byVpn('API-BLANK-001')?.contractPriceStatus, 'not_provided')
    assert.equal(byVpn('API-BLANK-001')?.isCostEligible, false)
    assert.equal(byVpn('API-RFQ-001')?.contractPriceStatus, 'list_only_request_quote')
    assert.equal(byVpn('API-RFQ-001')?.costIneligibilityReason, 'contract_price_requires_quote')
  })

  it('does not infer contract cost from API price when contractPrice is missing', async () => {
    const repository = new InMemoryHerculesImportRepository()
    const client = createClient(async () =>
      jsonResponse(herculesApiEnvelope(herculesApiPartsPage([apiPartWithNullContractPrice])))
    )

    await importHerculesPricing(new ApiHerculesPricingSource({ client }), repository)

    const uom = [...repository.offerUoms.values()].find(
      (candidate) => candidate.vendorPartNumber === 'API-MISSING-001'
    )

    assert.ok(uom)
    assert.equal(uom.listPriceAmount, 30)
    assert.equal(uom.contractPriceAmount, null)
    assert.equal(uom.contractPriceStatus, 'not_provided')
    assert.equal(uom.isCostEligible, false)
  })

  it('keeps legacy cost fallback disabled unless explicitly requested', async () => {
    const legacyPart = {
      ...apiPartWithNumericCost,
      _id: 'api-part-legacy-cost-only',
      vendors: [
        {
          _id: 'api-vendor-legacy-cost',
          vendorName: 'Medline',
          supplierCode: 'MEDLINE',
          isPrimary: true,
          units: [
            {
              unit: 'EA',
              vendorPartNumber: 'API-LEGACY-COST',
              price: '$99.00',
              cost: '$7.00',
              per: '1/EA',
            },
          ],
        },
      ],
    }
    const normalized = normalizeHerculesApiPart(legacyPart, {})
    const fallback = normalizeHerculesApiPart(legacyPart, {
      useLegacyCostFallback: true,
    })

    assert.equal(normalized?.vendorOffers[0].uoms[0].contractPrice, null)
    assert.equal(fallback?.vendorOffers[0].uoms[0].contractPrice, '$7.00')
  })
})

describe('runHerculesApiBackfillThenDelta', () => {
  it('checkpoints a full backfill and follows with delta from backfill start', async () => {
    const repository = new InMemoryHerculesImportRepository()
    const requests: Array<{
      pageSize: number
      initialOffset?: number
      updatedSince?: string
      supplierCode?: string
    }> = []
    const pages = [
      herculesApiPartsPage([apiPartWithNumericCost], {
        limit: 1,
        offset: 0,
        total: 2,
        hasNext: true,
      }),
      herculesApiPartsPage([apiPartWithMultipleUnitsAndPerBox], {
        limit: 1,
        offset: 1,
        total: 2,
        hasNext: false,
      }),
      herculesApiPartsPage([apiPartWithNumericCost], {
        limit: 1,
        offset: 0,
        total: 1,
        hasNext: false,
      }),
    ]

    const result = await runHerculesApiBackfillThenDelta({
      importRepository: repository,
      syncStateRepository: repository,
      supplierCode: 'medline',
      pageSize: 1,
      now: () => new Date('2026-06-25T12:00:00.000Z'),
      createSource: (input) => {
        requests.push(input)
        return new ApiHerculesPricingSource({
          client: createClient(async () => jsonResponse(herculesApiEnvelope(pages.shift()))),
          pageSize: input.pageSize,
          initialOffset: input.initialOffset,
          updatedSince: input.updatedSince,
          supplierCode: input.supplierCode,
        })
      },
    })

    const state = await repository.getApiSyncState(result.sourceKey)

    assert.equal(result.supplierCode, 'MEDLINE')
    assert.equal(result.fullBackfillStartedAt, '2026-06-25T12:00:00.000Z')
    assert.equal(result.deltaCursor, '2026-06-25T12:00:00.000Z')
    assert.deepEqual(requests.map((request) => request.updatedSince), [
      undefined,
      '2026-06-25T12:00:00.000Z',
    ])
    assert.equal(state?.phase, 'delta')
    assert.equal(state?.status, 'success')
    assert.equal(state?.nextOffset, null)
    assert.equal(state?.deltaCursor, '2026-06-01T12:00:00.000Z')
  })

  it('resumes full backfill from the stored next offset', async () => {
    const repository = new InMemoryHerculesImportRepository()
    await repository.upsertApiSyncState({
      sourceKey: 'hercules-api-parts:NDC',
      supplierCode: 'NDC',
      phase: 'full_backfill',
      status: 'running',
      pageLimit: 500,
      nextOffset: 500,
      backfillStartedAt: '2026-06-25T10:00:00.000Z',
      backfillCompletedAt: null,
      deltaCursor: null,
      lastProcessedUpdatedAt: null,
      lastImportJobId: null,
      lastError: null,
      metadata: {},
    })
    const initialOffsets: Array<number | undefined> = []

    await runHerculesApiBackfillThenDelta({
      importRepository: repository,
      syncStateRepository: repository,
      supplierCode: 'NDC',
      createSource: (input) => {
        initialOffsets.push(input.initialOffset)
        return new ApiHerculesPricingSource({
          client: createClient(async () =>
            jsonResponse(
              herculesApiEnvelope(
                herculesApiPartsPage([apiPartWithRequestQuoteContractPrice], {
                  limit: 500,
                  offset: input.initialOffset ?? 0,
                  total: 1,
                  hasNext: false,
                })
              )
            )
          ),
          pageSize: input.pageSize,
          initialOffset: input.initialOffset,
          updatedSince: input.updatedSince,
          supplierCode: input.supplierCode,
        })
      },
    })

    assert.equal(initialOffsets[0], 500)
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
