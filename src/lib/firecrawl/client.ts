import type {
  FirecrawlCrawlOptions,
  FirecrawlCrawlStatus,
  FirecrawlImageSearchHit,
  FirecrawlMapLink,
  FirecrawlMapOptions,
  FirecrawlMapResult,
  FirecrawlRateLimit,
  FirecrawlScrapeMetadata,
  FirecrawlScrapeOptions,
  FirecrawlScrapeResult,
  FirecrawlSearchOptions,
  FirecrawlSearchResult,
  FirecrawlWebSearchHit,
} from './types'

export const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2'

export class FirecrawlApiError extends Error {
  readonly statusCode: number
  readonly rateLimit: FirecrawlRateLimit

  constructor(message: string, statusCode: number, rateLimit: FirecrawlRateLimit) {
    super(message)
    this.name = 'FirecrawlApiError'
    this.statusCode = statusCode
    this.rateLimit = rateLimit
  }
}

export class FirecrawlRateLimitError extends FirecrawlApiError {
  override name = 'FirecrawlRateLimitError'
  readonly retryAfterMs: number | null

  constructor(
    message: string,
    statusCode: number,
    rateLimit: FirecrawlRateLimit,
    retryAfterMs: number | null
  ) {
    super(message, statusCode, rateLimit)
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * 402: the Firecrawl plan is out of credits. Terminal for the whole
 * run — callers must stop instead of retrying.
 */
export class FirecrawlInsufficientCreditsError extends FirecrawlApiError {
  override name = 'FirecrawlInsufficientCreditsError'
}

export class FirecrawlResponseValidationError extends Error {
  override name = 'FirecrawlResponseValidationError'
}

export class FirecrawlMissingCredentialsError extends Error {
  override name = 'FirecrawlMissingCredentialsError'
}

export type FirecrawlClientOptions = {
  apiKey: string
  baseUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function numberHeader(value: string | null) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function captureRateLimit(headers: Headers): FirecrawlRateLimit {
  return {
    limit: numberHeader(headers.get('X-RateLimit-Limit')),
    remaining: numberHeader(headers.get('X-RateLimit-Remaining')),
    reset: headers.get('X-RateLimit-Reset'),
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

/** /map returns links as strings (v1 style) or {url} objects (v2). */
function normalizeMapLinks(value: unknown): FirecrawlMapLink[] {
  if (!Array.isArray(value)) return []
  const links: FirecrawlMapLink[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      links.push({ url: entry })
    } else if (isRecord(entry) && typeof entry.url === 'string') {
      links.push({
        url: entry.url,
        title: typeof entry.title === 'string' ? entry.title : undefined,
        description: typeof entry.description === 'string' ? entry.description : undefined,
      })
    }
  }
  return links
}

function normalizeWebHits(value: unknown): FirecrawlWebSearchHit[] {
  if (!Array.isArray(value)) return []
  const hits: FirecrawlWebSearchHit[] = []
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.url === 'string') {
      hits.push({
        url: entry.url,
        title: typeof entry.title === 'string' ? entry.title : undefined,
        description: typeof entry.description === 'string' ? entry.description : undefined,
      })
    }
  }
  return hits
}

function normalizeImageHits(value: unknown): FirecrawlImageSearchHit[] {
  if (!Array.isArray(value)) return []
  const hits: FirecrawlImageSearchHit[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const imageUrl = typeof entry.imageUrl === 'string' ? entry.imageUrl : undefined
    const url = typeof entry.url === 'string' ? entry.url : undefined
    if (!imageUrl && !url) continue
    hits.push({
      url,
      imageUrl,
      title: typeof entry.title === 'string' ? entry.title : undefined,
      imageWidth: typeof entry.imageWidth === 'number' ? entry.imageWidth : undefined,
      imageHeight: typeof entry.imageHeight === 'number' ? entry.imageHeight : undefined,
    })
  }
  return hits
}

export class FirecrawlClient {
  readonly baseUrl: string
  readonly timeoutMs: number
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  lastRateLimit: FirecrawlRateLimit = { limit: null, remaining: null, reset: null }

  constructor(options: FirecrawlClientOptions) {
    if (!options.apiKey?.trim()) {
      throw new FirecrawlMissingCredentialsError('FIRECRAWL_API_KEY is required')
    }
    this.apiKey = options.apiKey
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_FIRECRAWL_BASE_URL)
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** Discover URLs on a domain. ~1 credit per call. */
  async map(url: string, options: FirecrawlMapOptions = {}): Promise<FirecrawlMapResult> {
    const envelope = await this.post('/map', {
      url,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.sitemap ? { sitemap: options.sitemap } : {}),
      ...(options.search ? { search: options.search } : {}),
    })
    // v2 returns links at the top level; tolerate a nested `data.links` too.
    const links = isRecord(envelope)
      ? envelope.links ?? (isRecord(envelope.data) ? envelope.data.links : undefined)
      : undefined
    return { links: normalizeMapLinks(links) }
  }

  /** Scrape one page. 1 credit for plain formats like rawHtml. */
  async scrape(url: string, options: FirecrawlScrapeOptions = {}): Promise<FirecrawlScrapeResult> {
    const envelope = await this.post('/scrape', {
      url,
      formats: options.formats ?? ['rawHtml'],
      onlyMainContent: options.onlyMainContent ?? false,
      ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    })
    const data = isRecord(envelope) ? envelope.data : undefined
    if (!isRecord(data)) {
      throw new FirecrawlResponseValidationError('Firecrawl scrape returned no data object')
    }
    const metadata: FirecrawlScrapeMetadata = isRecord(data.metadata) ? data.metadata : {}
    return {
      rawHtml: typeof data.rawHtml === 'string' ? data.rawHtml : undefined,
      markdown: typeof data.markdown === 'string' ? data.markdown : undefined,
      metadata,
    }
  }

  /** Web/image search. 2 credits per 10 results per source. */
  async search(query: string, options: FirecrawlSearchOptions = {}): Promise<FirecrawlSearchResult> {
    const envelope = await this.post('/search', {
      query,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.sources ? { sources: options.sources.map((type) => ({ type })) } : {}),
    })
    const data = isRecord(envelope) ? envelope.data : undefined
    if (!isRecord(data)) {
      throw new FirecrawlResponseValidationError('Firecrawl search returned no data object')
    }
    return {
      web: normalizeWebHits(data.web),
      images: normalizeImageHits(data.images),
    }
  }

  /**
   * Start an async crawl job. Firecrawl crawls the site following
   * links and scrapes each page; returns a job id to poll. ~1 credit
   * per page crawled.
   */
  async startCrawl(url: string, options: FirecrawlCrawlOptions = {}): Promise<{ id: string }> {
    const envelope = await this.post('/crawl', {
      url,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.includePaths ? { includePaths: options.includePaths } : {}),
      ...(options.excludePaths ? { excludePaths: options.excludePaths } : {}),
      scrapeOptions: { formats: options.formats ?? ['rawHtml'], onlyMainContent: false },
    })
    const id = isRecord(envelope) && typeof envelope.id === 'string' ? envelope.id : null
    if (!id) throw new FirecrawlResponseValidationError('Firecrawl crawl did not return a job id')
    return { id }
  }

  /**
   * Poll a crawl job. Pass a full `next` cursor URL to follow
   * pagination, or a job id with `{skip}` to read results from a
   * given offset (stable append-only ordering).
   */
  async getCrawlStatus(
    idOrCursor: string,
    options: { skip?: number } = {}
  ): Promise<FirecrawlCrawlStatus> {
    let url: string
    if (idOrCursor.startsWith('http')) {
      url = idOrCursor
    } else {
      url = `${this.baseUrl}/crawl/${idOrCursor}`
      if (options.skip !== undefined) url += `?skip=${options.skip}`
    }
    const envelope = await this.request('GET', url)
    if (!isRecord(envelope)) {
      throw new FirecrawlResponseValidationError('Firecrawl crawl status returned no object')
    }

    const rawData = Array.isArray(envelope.data) ? envelope.data : []
    const data: FirecrawlScrapeResult[] = rawData.map((entry) => {
      const rec = isRecord(entry) ? entry : {}
      const metadata: FirecrawlScrapeMetadata = isRecord(rec.metadata) ? rec.metadata : {}
      return {
        rawHtml: typeof rec.rawHtml === 'string' ? rec.rawHtml : undefined,
        markdown: typeof rec.markdown === 'string' ? rec.markdown : undefined,
        metadata,
      }
    })

    return {
      status: (typeof envelope.status === 'string' ? envelope.status : 'scraping') as FirecrawlCrawlStatus['status'],
      total: typeof envelope.total === 'number' ? envelope.total : 0,
      completed: typeof envelope.completed === 'number' ? envelope.completed : 0,
      creditsUsed: typeof envelope.creditsUsed === 'number' ? envelope.creditsUsed : 0,
      next: typeof envelope.next === 'string' ? envelope.next : null,
      data,
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `${this.baseUrl}${path}`, body)
  }

  private async request(
    method: 'GET' | 'POST',
    url: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      })

      const rateLimit = captureRateLimit(response.headers)
      if (rateLimit.limit !== null || rateLimit.remaining !== null || rateLimit.reset !== null) {
        this.lastRateLimit = rateLimit
      }

      let parsed: unknown = null
      try {
        parsed = await response.json()
      } catch {
        parsed = null
      }

      if (!response.ok) {
        const message =
          isRecord(parsed) && typeof parsed.error === 'string'
            ? parsed.error
            : `Firecrawl request failed with HTTP ${response.status}`

        if (response.status === 402) {
          throw new FirecrawlInsufficientCreditsError(message, response.status, rateLimit)
        }
        if (response.status === 429) {
          const retryAfterSeconds = numberHeader(response.headers.get('Retry-After'))
          throw new FirecrawlRateLimitError(
            message,
            response.status,
            rateLimit,
            retryAfterSeconds !== null ? retryAfterSeconds * 1000 : null
          )
        }
        throw new FirecrawlApiError(message, response.status, rateLimit)
      }

      if (!isRecord(parsed) || parsed.success !== true) {
        const message =
          isRecord(parsed) && typeof parsed.error === 'string'
            ? parsed.error
            : 'Firecrawl response envelope missing success flag'
        throw new FirecrawlResponseValidationError(message)
      }

      // Return the whole envelope: v2 nests scrape/search payloads under
      // `data`, but /map puts `links` at the top level. Each method picks
      // the field it needs.
      return parsed
    } finally {
      clearTimeout(timeout)
    }
  }
}
