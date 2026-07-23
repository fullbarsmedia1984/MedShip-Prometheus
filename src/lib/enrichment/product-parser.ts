import type {
  Competitor,
  CompetitorPriceStatus,
  ParsedCompetitorProduct,
} from './types'

/**
 * Pure extraction functions for competitor product pages. No HTML
 * parser dependency: both target sites are handled with JSON blocks
 * and narrow regexes, validated against fixture tests.
 *
 * Strategies per competitor:
 * - pocketnurse (Magento): no JSON-LD on product pages; the primary
 *   path is the Magento DOM (productId-scoped price box, microdata
 *   sku/name, mage gallery JSON). JSON-LD is still attempted first
 *   in case the theme adds it later.
 * - diamedical (NetSuite SuiteCommerce): the storefront is a JS
 *   shell, so HTML scraping is useless; items come from the public
 *   /api/items JSON endpoint via normalizeSuiteCommerceItem.
 */

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = decodeHtmlEntities(value).trim()
  return text.length > 0 ? text : null
}

function stripHtmlTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[$,\s]/g, ''))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

function resolveUrl(candidate: string, pageUrl: string): string | null {
  try {
    return new URL(candidate, pageUrl).toString()
  } catch {
    return null
  }
}

function uniqueUrls(urls: Array<string | null>): string[] {
  return [...new Set(urls.filter((u): u is string => Boolean(u)))]
}

// ------------------------------------------------------------------
// JSON-LD
// ------------------------------------------------------------------

/** Parse every application/ld+json block, tolerating bad JSON per block. */
export function extractJsonLdProducts(html: string): JsonRecord[] {
  const products: JsonRecord[] = []
  const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null

  while ((match = scriptPattern.exec(html)) !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(match[1].trim())
    } catch {
      continue
    }

    const candidates: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
    for (const candidate of candidates) {
      if (!isRecord(candidate)) continue
      const graph = candidate['@graph']
      const nodes = Array.isArray(graph) ? graph : [candidate]
      for (const node of nodes) {
        if (!isRecord(node)) continue
        const type = node['@type']
        const isProduct =
          type === 'Product' || (Array.isArray(type) && type.includes('Product'))
        if (isProduct) products.push(node)
      }
    }
  }

  return products
}

function jsonLdImages(image: unknown, pageUrl: string): string[] {
  const entries = Array.isArray(image) ? image : [image]
  return uniqueUrls(
    entries.map((entry) => {
      if (typeof entry === 'string') return resolveUrl(entry, pageUrl)
      if (isRecord(entry) && typeof entry.url === 'string') return resolveUrl(entry.url, pageUrl)
      return null
    })
  )
}

function jsonLdOffer(offers: unknown): { price: number | null; currency: string | null; availability: string | null } {
  const list = Array.isArray(offers) ? offers : [offers]
  for (const offer of list) {
    if (!isRecord(offer)) continue
    const price =
      parsePrice(offer.price) ??
      parsePrice(offer.lowPrice) ??
      (isRecord(offer.priceSpecification) ? parsePrice(offer.priceSpecification.price) : null)
    const currency =
      cleanText(offer.priceCurrency) ??
      (isRecord(offer.priceSpecification) ? cleanText(offer.priceSpecification.priceCurrency) : null)
    const availability = cleanText(offer.availability)?.replace(/^https?:\/\/schema\.org\//i, '') ?? null
    if (price !== null || currency !== null || availability !== null) {
      return { price, currency, availability }
    }
  }
  return { price: null, currency: null, availability: null }
}

function parseJsonLdProduct(html: string, pageUrl: string): ParsedCompetitorProduct | null {
  const products = extractJsonLdProducts(html)
  if (products.length === 0) return null
  const node = products[0]

  const brand = isRecord(node.brand) ? cleanText(node.brand.name) : cleanText(node.brand)
  const gtin =
    cleanText(node.gtin13) ?? cleanText(node.gtin12) ?? cleanText(node.gtin14) ?? cleanText(node.gtin)
  const offer = jsonLdOffer(node.offers)

  return {
    title: cleanText(node.name),
    brand,
    sku: cleanText(node.sku),
    mpn: cleanText(node.mpn),
    gtin,
    description: typeof node.description === 'string' ? stripHtmlTags(node.description) || null : null,
    listPriceAmount: offer.price,
    currency: offer.currency ?? 'USD',
    priceStatus: offer.price !== null ? 'listed' : 'parse_error',
    availability: offer.availability,
    imageUrls: jsonLdImages(node.image, pageUrl),
    parseSource: 'json_ld',
    rawPayload: node,
  }
}

// ------------------------------------------------------------------
// Magento DOM (pocketnurse)
// ------------------------------------------------------------------

function magentoMainPrice(html: string): number | null {
  // The page config JSON names the main product; related products get
  // their own price boxes, so scope to the main one.
  const productId = html.match(/"productId":\s*"?(\d+)/)?.[1]
  if (productId) {
    const boxStart = html.indexOf(`data-price-box="product-id-${productId}"`)
    if (boxStart >= 0) {
      const block = html.slice(boxStart, boxStart + 2_000)
      const scoped =
        block.match(/data-price-amount="([\d.]+)"[^>]*data-price-type="finalPrice"/) ??
        block.match(/data-price-type="finalPrice"[^>]*data-price-amount="([\d.]+)"/) ??
        block.match(/itemprop="price"\s+content="([\d.]+)"/)
      if (scoped) return parsePrice(scoped[1])
    }
  }
  return null
}

function magentoGalleryImages(html: string, pageUrl: string): string[] {
  // mage/gallery config: "data": [{"thumb": "...", "img": "...", "full": "..."}]
  const galleryMatch = html.match(/"data":\s*(\[\{"thumb"[\s\S]*?\}\])\s*[,}]/)
  if (galleryMatch) {
    try {
      const entries = JSON.parse(galleryMatch[1]) as unknown
      if (Array.isArray(entries)) {
        const urls = entries.map((entry) => {
          if (!isRecord(entry)) return null
          const raw =
            (typeof entry.full === 'string' && entry.full) ||
            (typeof entry.img === 'string' && entry.img) ||
            (typeof entry.thumb === 'string' && entry.thumb) ||
            null
          return raw ? resolveUrl(raw, pageUrl) : null
        })
        const resolved = uniqueUrls(urls)
        if (resolved.length > 0) return resolved
      }
    } catch {
      // fall through to og:image
    }
  }

  const og = html.match(/<meta property="og:image" content="([^"]+)"/)
  return og ? uniqueUrls([resolveUrl(decodeHtmlEntities(og[1]), pageUrl)]) : []
}

function parseMagentoProduct(html: string, pageUrl: string): ParsedCompetitorProduct | null {
  const ogType = html.match(/<meta property="og:type" content="([^"]*)"/)?.[1]
  const sku = html.match(/itemprop="sku"[^>]*>([^<]+)/)?.[1]
  const name =
    html.match(/itemprop="name"[^>]*>([^<]+)/)?.[1] ??
    html.match(/<meta property="og:title" content="([^"]+)"/)?.[1]

  // Category/CMS pages have no product microdata and no product og:type.
  if (ogType !== 'product' && !sku) return null

  const price = magentoMainPrice(html)
  // Pocket Nurse hides some prices behind MAP ("minimum advertised
  // price") messaging; that is a hidden price, not a parse failure.
  const mapHidden = /minimum advertised price/i.test(html)
  const priceStatus: CompetitorPriceStatus =
    price !== null ? 'listed' : mapHidden ? 'quote_only' : 'parse_error'

  const title = name ? cleanText(name) : null

  return {
    title,
    brand: null,
    sku: sku ? cleanText(sku) : null,
    mpn: null,
    gtin: null,
    description: null,
    listPriceAmount: price,
    currency: 'USD',
    priceStatus,
    availability: null,
    imageUrls: magentoGalleryImages(html, pageUrl),
    parseSource: 'magento_dom',
    rawPayload: { sku: sku ?? null, title, price },
    }
}

// ------------------------------------------------------------------
// Entry point for scraped HTML
// ------------------------------------------------------------------

export function parseCompetitorProductHtml(
  html: string,
  pageUrl: string,
  competitor: Competitor
): ParsedCompetitorProduct | null {
  const fromJsonLd = parseJsonLdProduct(html, pageUrl)
  if (fromJsonLd) return fromJsonLd
  if (competitor === 'pocketnurse') return parseMagentoProduct(html, pageUrl)
  return null
}

// ------------------------------------------------------------------
// SuiteCommerce items API (diamedical)
// ------------------------------------------------------------------

export type SuiteCommerceNormalizedItem = {
  product: ParsedCompetitorProduct
  /** Canonical product URL, built from urlcomponent. */
  url: string
}

/**
 * Normalize one item from the SuiteCommerce /api/items endpoint
 * (fieldset=search). Returns null for records without a URL slug —
 * those cannot be revisited or deduped.
 */
export function normalizeSuiteCommerceItem(
  item: unknown,
  baseUrl: string
): SuiteCommerceNormalizedItem | null {
  if (!isRecord(item)) return null
  const urlComponent = cleanText(item.urlcomponent)
  if (!urlComponent) return null

  const priceVisible = item.ispricevisible !== false
  const price = priceVisible ? parsePrice(item.onlinecustomerprice) : null

  const images: Array<string | null> = []
  const media = isRecord(item.itemimages_detail) ? item.itemimages_detail : null
  if (media) {
    // itemimages_detail is either {media: {urls: [{url}]}} or a map of
    // named groups with the same {urls: [...]} shape.
    for (const group of Object.values(media)) {
      if (!isRecord(group)) continue
      const urls = group.urls
      if (!Array.isArray(urls)) continue
      for (const entry of urls) {
        if (isRecord(entry) && typeof entry.url === 'string') {
          images.push(resolveUrl(entry.url, baseUrl))
        }
      }
    }
  }

  const title = cleanText(item.displayname) ?? cleanText(item.storedisplayname2)
  const description =
    typeof item.storedetaileddescription === 'string'
      ? stripHtmlTags(item.storedetaileddescription).slice(0, 2_000) || null
      : null

  const rawPayload: Record<string, unknown> = {
    internalid: item.internalid ?? null,
    itemid: item.itemid ?? null,
    itemtype: item.itemtype ?? null,
    isinstock: item.isinstock ?? null,
    ispricevisible: item.ispricevisible ?? null,
    onlinecustomerprice: item.onlinecustomerprice ?? null,
    urlcomponent: urlComponent,
  }

  return {
    url: `${baseUrl.replace(/\/+$/, '')}/${urlComponent}`,
    product: {
      title,
      brand: null,
      sku: cleanText(item.itemid),
      mpn: null,
      gtin: null,
      description,
      listPriceAmount: price,
      currency: 'USD',
      priceStatus: price !== null ? 'listed' : priceVisible ? 'parse_error' : 'quote_only',
      availability: item.isinstock === true ? 'InStock' : item.isinstock === false ? 'OutOfStock' : null,
      imageUrls: uniqueUrls(images),
      parseSource: 'suitecommerce_api',
      rawPayload,
    },
  }
}
