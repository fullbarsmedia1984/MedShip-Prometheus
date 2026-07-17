import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const {
  FirecrawlApiError,
  FirecrawlClient,
  FirecrawlInsufficientCreditsError,
  FirecrawlMissingCredentialsError,
  FirecrawlRateLimitError,
  FirecrawlResponseValidationError,
} = await import(new URL('../client.ts', import.meta.url).href)

function jsonResponse(
  body: unknown,
  options: { status?: number; headers?: Record<string, string> } = {}
) {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
}

function createClient(fetchImpl: typeof fetch) {
  return new FirecrawlClient({ apiKey: 'test-key', fetchImpl })
}

describe('FirecrawlClient', () => {
  it('requires an api key', () => {
    assert.throws(
      () => new FirecrawlClient({ apiKey: '' }),
      FirecrawlMissingCredentialsError
    )
  })

  it('sends bearer auth and returns normalized map links', async () => {
    let capturedUrl = ''
    let capturedAuth: string | null = null
    const client = createClient(async (input, init) => {
      capturedUrl = String(input)
      capturedAuth = new Headers(init?.headers).get('Authorization')
      return jsonResponse({
        success: true,
        data: {
          links: [
            'https://example.com/a.html',
            { url: 'https://example.com/b.html', title: 'B' },
            { bogus: true },
          ],
        },
      })
    })

    const result = await client.map('https://example.com')
    assert.equal(capturedUrl, 'https://api.firecrawl.dev/v2/map')
    assert.equal(capturedAuth, 'Bearer test-key')
    assert.deepEqual(
      result.links.map((l: { url: string }) => l.url),
      ['https://example.com/a.html', 'https://example.com/b.html']
    )
    assert.equal(result.links[1].title, 'B')
  })

  it('returns rawHtml and metadata from scrape', async () => {
    const client = createClient(async () =>
      jsonResponse({
        success: true,
        data: {
          rawHtml: '<html><body>hi</body></html>',
          metadata: { statusCode: 200, sourceURL: 'https://example.com/p' },
        },
      })
    )

    const result = await client.scrape('https://example.com/p')
    assert.equal(result.rawHtml, '<html><body>hi</body></html>')
    assert.equal(result.metadata.statusCode, 200)
  })

  it('normalizes web and image search hits', async () => {
    const client = createClient(async () =>
      jsonResponse({
        success: true,
        data: {
          web: [{ url: 'https://example.com/hit', title: 'Hit' }, { nope: 1 }],
          images: [
            { imageUrl: 'https://cdn.example.com/x.jpg', url: 'https://example.com/x', imageWidth: 400 },
            { junk: true },
          ],
        },
      })
    )

    const result = await client.search('widget', { sources: ['web', 'images'] })
    assert.equal(result.web.length, 1)
    assert.equal(result.images.length, 1)
    assert.equal(result.images[0].imageUrl, 'https://cdn.example.com/x.jpg')
  })

  it('throws FirecrawlInsufficientCreditsError on 402', async () => {
    const client = createClient(async () =>
      jsonResponse({ success: false, error: 'Insufficient credits' }, { status: 402 })
    )
    await assert.rejects(client.scrape('https://example.com'), FirecrawlInsufficientCreditsError)
  })

  it('throws FirecrawlRateLimitError with retryAfterMs on 429', async () => {
    const client = createClient(async () =>
      jsonResponse(
        { success: false, error: 'Rate limit exceeded' },
        { status: 429, headers: { 'Retry-After': '12' } }
      )
    )
    await assert.rejects(client.scrape('https://example.com'), (error: unknown) => {
      assert.ok(error instanceof FirecrawlRateLimitError)
      assert.equal((error as { retryAfterMs: number }).retryAfterMs, 12_000)
      return true
    })
  })

  it('throws FirecrawlApiError on other HTTP failures', async () => {
    const client = createClient(async () =>
      jsonResponse({ success: false, error: 'Internal error' }, { status: 500 })
    )
    await assert.rejects(client.scrape('https://example.com'), FirecrawlApiError)
  })

  it('rejects success envelopes without the success flag', async () => {
    const client = createClient(async () => jsonResponse({ data: {} }))
    await assert.rejects(client.scrape('https://example.com'), FirecrawlResponseValidationError)
  })

  it('captures rate limit headers', async () => {
    const client = createClient(async () =>
      jsonResponse(
        { success: true, data: { links: [] } },
        { headers: { 'X-RateLimit-Limit': '100', 'X-RateLimit-Remaining': '41' } }
      )
    )
    await client.map('https://example.com')
    assert.equal(client.lastRateLimit.limit, 100)
    assert.equal(client.lastRateLimit.remaining, 41)
  })
})
