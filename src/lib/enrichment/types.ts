export type Competitor = 'pocketnurse' | 'diamedical'

export const COMPETITORS: Competitor[] = ['pocketnurse', 'diamedical']

export const COMPETITOR_DOMAINS: Record<Competitor, string> = {
  pocketnurse: 'www.pocketnurse.com',
  diamedical: 'www.diamedicalusa.com',
}

export type CompetitorPriceStatus =
  | 'listed'
  | 'quote_only'
  | 'unavailable'
  | 'parse_error'
  | 'unknown'

export type CompetitorParseSource = 'json_ld' | 'magento_dom' | 'suitecommerce_api' | 'meta_tags'

export type ParsedCompetitorProduct = {
  title: string | null
  brand: string | null
  sku: string | null
  mpn: string | null
  gtin: string | null
  description: string | null
  listPriceAmount: number | null
  currency: string
  priceStatus: CompetitorPriceStatus
  availability: string | null
  imageUrls: string[]
  parseSource: CompetitorParseSource
  /** The parsed JSON-LD Product node (or fallback extraction detail). */
  rawPayload: Record<string, unknown>
}

export type CrawlUrlStatus = 'pending' | 'scraped' | 'not_product' | 'failed' | 'skipped'

export type EnrichmentPhase = 'competitor_crawl' | 'image_mirror' | 'search_sweep'

export type EnrichmentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type EnrichmentRunRecord = {
  id: string
  phase: EnrichmentPhase
  competitor: Competitor | null
  status: EnrichmentRunStatus
  cursorJson: Record<string, unknown>
  countersJson: Record<string, number>
  creditsUsed: number
  itemsProcessed: number
  lastError: string | null
  triggeredBy: string | null
  startedAt: string
  completedAt: string | null
}

export type ImageEnrichmentStatus =
  | 'pending'
  | 'mirrored'
  | 'source_failed'
  | 'hotlink_blocked'
  | 'no_source'
  | 'search_not_found'

export type ImageSource = 'hercules' | Competitor | 'web_search'

export type CrawlBatchStatus = 'in_progress' | 'completed' | 'budget_exhausted' | 'rate_limited'
