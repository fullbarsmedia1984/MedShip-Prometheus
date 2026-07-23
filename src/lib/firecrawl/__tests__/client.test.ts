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
      // v2 /map returns links at the TOP level (not under `data`).
      return jsonResponse({
        success: true,
        id: 'map-1',
        links: [
          'https://example.com/a.html',
          { url: 'https://example.com/b.html', title: 'B' },
          { bogus: true },
        ],
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

  it('starts a crawl job and returns the id', async () => {
    let capturedUrl = ''
    let capturedBody: unknown = null
    const client = createClient(async (input, init) => {
      capturedUrl = String(input)
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, id: 'crawl-123', url: 'https://api.firecrawl.dev/v2/crawl/crawl-123' })
    })
    const result = await client.startCrawl('https://example.com', { limit: 500 })
    assert.equal(capturedUrl, 'https://api.firecrawl.dev/v2/crawl')
    assert.equal((capturedBody as { limit: number }).limit, 500)
    assert.deepEqual((capturedBody as { scrapeOptions: { formats: string[] } }).scrapeOptions.formats, ['rawHtml'])
    assert.equal(result.id, 'crawl-123')
  })

  it('polls crawl status via GET and normalizes data', async () => {
    let method = ''
    const client = createClient(async (input, init) => {
      method = init?.method ?? 'GET'
      assert.equal(String(input), 'https://api.firecrawl.dev/v2/crawl/crawl-123')
      return jsonResponse({
        success: true,
        status: 'scraping',
        total: 100,
        completed: 20,
        creditsUsed: 20,
        next: 'https://api.firecrawl.dev/v2/crawl/crawl-123?skip=20',
        data: [
          { rawHtml: '<html>a</html>', metadata: { statusCode: 200, sourceURL: 'https://example.com/a' } },
          { bogus: true },
        ],
      })
    })
    const status = await client.getCrawlStatus('crawl-123')
    assert.equal(method, 'GET')
    assert.equal(status.status, 'scraping')
    assert.equal(status.completed, 20)
    assert.equal(status.creditsUsed, 20)
    assert.equal(status.next, 'https://api.firecrawl.dev/v2/crawl/crawl-123?skip=20')
    assert.equal(status.data.length, 2)
    assert.equal(status.data[0].rawHtml, '<html>a</html>')
  })

  it('follows a next-cursor URL directly for crawl status', async () => {
    let capturedUrl = ''
    const client = createClient(async (input) => {
      capturedUrl = String(input)
      return jsonResponse({ success: true, status: 'completed', total: 1, completed: 1, creditsUsed: 1, data: [] })
    })
    await client.getCrawlStatus('https://api.firecrawl.dev/v2/crawl/crawl-123?skip=20')
    assert.equal(capturedUrl, 'https://api.firecrawl.dev/v2/crawl/crawl-123?skip=20')
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
