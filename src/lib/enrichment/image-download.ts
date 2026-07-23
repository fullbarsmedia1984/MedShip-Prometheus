import { createHash } from 'node:crypto'

/**
 * Hardened product-image downloader. Source URLs come from scraped
 * third-party pages and are untrusted: the URL is vetted, the body is
 * size-capped while streaming (headers lie), and the content type is
 * derived from magic bytes, never from the server's headers alone.
 * SVG is rejected outright (scriptable). Never throws — every failure
 * returns a typed reason so callers can record terminal states.
 */

export type ImageDownloadSuccess = {
  ok: true
  bytes: Uint8Array
  contentType: string
  extension: string
  sha256: string
}

export type ImageDownloadFailure = {
  ok: false
  reason: 'unsafe_url' | 'blocked' | 'not_image' | 'too_large' | 'timeout' | 'fetch_error'
  detail: string
}

export type ImageDownloadResult = ImageDownloadSuccess | ImageDownloadFailure

export type ImageDownloadOptions = {
  maxBytes: number
  timeoutMs: number
  /** Product page to present as Referer on the retry after a 403. */
  referer?: string
  fetchImpl?: typeof fetch
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

/** Reject anything that could reach internal infrastructure. */
export function isSafeImageUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.port && url.port !== '80' && url.port !== '443') return false
  if (url.username || url.password) return false

  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  // IPv6 literal
  if (host.includes(':') || host.startsWith('[')) return false
  // Must look like a real public hostname
  if (!host.includes('.')) return false

  return true
}

/** Identify the image type from its first bytes. */
export function sniffImageType(bytes: Uint8Array): { contentType: string; extension: string } | null {
  if (bytes.length < 16) return null

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' }
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { contentType: 'image/png', extension: 'png' }
  }
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length))
  if (ascii(0, 4) === 'GIF8') {
    return { contentType: 'image/gif', extension: 'gif' }
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' }
  }
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4)
    if (brand.startsWith('avif') || brand.startsWith('avis')) {
      return { contentType: 'image/avif', extension: 'avif' }
    }
  }
  return null
}

async function readBodyCapped(
  response: Response,
  maxBytes: number
): Promise<Uint8Array | 'too_large'> {
  const body = response.body
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    return buffer.byteLength > maxBytes ? 'too_large' : buffer
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel()
          return 'too_large'
        }
        chunks.push(value)
      }
    }
  } finally {
    reader.releaseLock()
  }

  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined
}

async function attemptFetch(
  url: string,
  options: ImageDownloadOptions,
  withReferer: boolean
): Promise<ImageDownloadResult | 'retry_with_referer'> {
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    const headers: Record<string, string> = {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
    }
    if (withReferer && options.referer) headers.Referer = options.referer

    const response = await fetchImpl(url, { headers, redirect: 'follow', signal: controller.signal })

    if (response.status === 403 || response.status === 429 || response.status === 451) {
      if (!withReferer && options.referer) return 'retry_with_referer'
      return { ok: false, reason: 'blocked', detail: `HTTP ${response.status}` }
    }
    if (!response.ok) {
      return { ok: false, reason: 'fetch_error', detail: `HTTP ${response.status}` }
    }

    const headerType = (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
    if (headerType && !headerType.startsWith('image/')) {
      return { ok: false, reason: 'not_image', detail: `Content-Type ${headerType}` }
    }
    const declaredLength = Number(response.headers.get('Content-Length'))
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      return { ok: false, reason: 'too_large', detail: `Content-Length ${declaredLength}` }
    }

    const body = await readBodyCapped(response, options.maxBytes)
    if (body === 'too_large') {
      return { ok: false, reason: 'too_large', detail: `body exceeded ${options.maxBytes} bytes` }
    }

    const sniffed = sniffImageType(body)
    if (!sniffed || !ALLOWED_CONTENT_TYPES.has(sniffed.contentType)) {
      return { ok: false, reason: 'not_image', detail: 'magic bytes are not an allowed image type' }
    }

    const sha256 = createHash('sha256').update(body).digest('hex')
    return { ok: true, bytes: body, contentType: sniffed.contentType, extension: sniffed.extension, sha256 }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      reason: aborted ? 'timeout' : 'fetch_error',
      detail: error instanceof Error ? error.message : 'fetch failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function downloadImage(
  url: string,
  options: ImageDownloadOptions
): Promise<ImageDownloadResult> {
  if (!isSafeImageUrl(url)) {
    return { ok: false, reason: 'unsafe_url', detail: 'URL failed safety vetting' }
  }

  const first = await attemptFetch(url, options, false)
  if (first !== 'retry_with_referer') return first

  const second = await attemptFetch(url, options, true)
  if (second === 'retry_with_referer') {
    return { ok: false, reason: 'blocked', detail: 'blocked with and without Referer' }
  }
  return second
}
