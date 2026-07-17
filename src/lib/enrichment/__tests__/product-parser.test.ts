import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const { extractJsonLdProducts, normalizeSuiteCommerceItem, parseCompetitorProductHtml } =
  await import(new URL('../product-parser.ts', import.meta.url).href)

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')
}

describe('parseCompetitorProductHtml (pocketnurse fixture)', () => {
  const pageUrl = 'https://www.pocketnurse.com/default/06-93-0056-demo-doser-acetaminophn-tylenl-500mg'
  const html = fixture('pocketnurse-product.html')

  it('parses the main product via the Magento DOM fallback', () => {
    const parsed = parseCompetitorProductHtml(html, pageUrl, 'pocketnurse')
    assert.ok(parsed, 'expected a parsed product')
    assert.equal(parsed.parseSource, 'magento_dom')
    assert.equal(parsed.sku, '06-93-0056')
    assert.equal(parsed.title, 'Demo Dose® Acetaminophn Tylenl 500mg')
    // Main product price, not a related-product price box.
    assert.equal(parsed.listPriceAmount, 24.73)
    assert.equal(parsed.priceStatus, 'listed')
    assert.equal(parsed.currency, 'USD')
    assert.ok(parsed.imageUrls.length > 0, 'expected gallery images')
    assert.ok(
      parsed.imageUrls.every((u: string) => u.startsWith('https://www.pocketnurse.com/')),
      'image URLs must be absolute'
    )
  })

  it('returns null for non-product HTML', () => {
    const parsed = parseCompetitorProductHtml(
      '<html><head><meta property="og:type" content="website"></head><body>Category page</body></html>',
      'https://www.pocketnurse.com/default/products',
      'pocketnurse'
    )
    assert.equal(parsed, null)
  })
})

describe('parseCompetitorProductHtml (JSON-LD)', () => {
  const jsonLdHtml = `
    <html><head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {"@type": "Organization", "name": "Shop"},
        {
          "@type": "Product",
          "name": "Widget Pro",
          "sku": "WID-100",
          "mpn": "W100-XL",
          "gtin13": "0012345678905",
          "brand": {"@type": "Brand", "name": "Acme"},
          "image": ["/images/widget.jpg", {"url": "https://cdn.example.com/widget2.jpg"}],
          "offers": {
            "@type": "Offer",
            "price": "129.95",
            "priceCurrency": "USD",
            "availability": "https://schema.org/InStock"
          }
        }
      ]
    }
    </script>
    </head><body></body></html>`

  it('extracts Product nodes from @graph', () => {
    const products = extractJsonLdProducts(jsonLdHtml)
    assert.equal(products.length, 1)
    assert.equal(products[0].name, 'Widget Pro')
  })

  it('parses a full product from JSON-LD before any fallback', () => {
    const parsed = parseCompetitorProductHtml(jsonLdHtml, 'https://example.com/p/widget', 'pocketnurse')
    assert.ok(parsed)
    assert.equal(parsed.parseSource, 'json_ld')
    assert.equal(parsed.title, 'Widget Pro')
    assert.equal(parsed.brand, 'Acme')
    assert.equal(parsed.mpn, 'W100-XL')
    assert.equal(parsed.gtin, '0012345678905')
    assert.equal(parsed.listPriceAmount, 129.95)
    assert.equal(parsed.priceStatus, 'listed')
    assert.equal(parsed.availability, 'InStock')
    assert.deepEqual(parsed.imageUrls, [
      'https://example.com/images/widget.jpg',
      'https://cdn.example.com/widget2.jpg',
    ])
  })

  it('tolerates malformed JSON-LD blocks', () => {
    const html = '<script type="application/ld+json">{not json</script>'
    assert.deepEqual(extractJsonLdProducts(html), [])
  })
})

describe('normalizeSuiteCommerceItem (diamedical fixtures)', () => {
  const baseUrl = 'https://www.diamedicalusa.com'

  it('normalizes a search-fieldset item', () => {
    const page = JSON.parse(fixture('diamedical-items-search.json'))
    assert.ok(page.total > 0)
    const normalized = normalizeSuiteCommerceItem(page.items[0], baseUrl)
    assert.ok(normalized, 'expected a normalized item')
    assert.equal(
      normalized.url,
      'https://www.diamedicalusa.com/Posey-Double-Strap-Soft-Limb-Holder-with-Quick-Release-Buckle'
    )
    const p = normalized.product
    assert.equal(p.parseSource, 'suitecommerce_api')
    assert.equal(p.sku, 'PTC111849')
    assert.equal(p.title, 'Posey® Double-Strap Soft Limb Holder with Quick-Release Buckle')
    assert.equal(p.listPriceAmount, 15.78)
    assert.equal(p.priceStatus, 'listed')
    assert.ok(p.imageUrls.length > 0)
    assert.ok(p.imageUrls[0].startsWith('https://www.diamedicalusa.com/ProductImages/'))
  })

  it('marks hidden-price items quote_only', () => {
    const normalized = normalizeSuiteCommerceItem(
      {
        urlcomponent: 'Some-Quote-Only-Item',
        displayname: 'Quote Only Item',
        ispricevisible: false,
        onlinecustomerprice: 100,
      },
      baseUrl
    )
    assert.ok(normalized)
    assert.equal(normalized.product.listPriceAmount, null)
    assert.equal(normalized.product.priceStatus, 'quote_only')
  })

  it('rejects items without a url slug', () => {
    assert.equal(normalizeSuiteCommerceItem({ displayname: 'No slug' }, baseUrl), null)
  })
})
