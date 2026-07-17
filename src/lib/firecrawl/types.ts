export type FirecrawlRateLimit = {
  limit: number | null
  remaining: number | null
  reset: string | null
}

export type FirecrawlMapLink = {
  url: string
  title?: string
  description?: string
}

export type FirecrawlMapResult = {
  links: FirecrawlMapLink[]
}

export type FirecrawlScrapeMetadata = {
  statusCode?: number
  sourceURL?: string
  title?: string
  [key: string]: unknown
}

export type FirecrawlScrapeResult = {
  rawHtml?: string
  markdown?: string
  metadata: FirecrawlScrapeMetadata
}

export type FirecrawlWebSearchHit = {
  url: string
  title?: string
  description?: string
}

export type FirecrawlImageSearchHit = {
  /** Page the image was found on. */
  url?: string
  title?: string
  /** Direct URL of the image file itself. */
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
}

export type FirecrawlSearchResult = {
  web: FirecrawlWebSearchHit[]
  images: FirecrawlImageSearchHit[]
}

export type FirecrawlMapOptions = {
  limit?: number
  /** 'include' (default), 'skip', or 'only' — how the sitemap is used. */
  sitemap?: 'include' | 'skip' | 'only'
  search?: string
}

export type FirecrawlScrapeOptions = {
  formats?: Array<'rawHtml' | 'markdown' | 'links'>
  onlyMainContent?: boolean
  timeoutMs?: number
}

export type FirecrawlSearchOptions = {
  limit?: number
  sources?: Array<'web' | 'images'>
}
