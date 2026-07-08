import type { JsonObject } from './types'

/**
 * Embeddings for catalog semantic search.
 * text-embedding-3-small natively shortened to 512 dims: near-parity
 * retrieval quality with a third of the storage of 1536, and a much
 * faster HNSW build over ~750k rows.
 */

export const HERCULES_EMBEDDING_MODEL = 'text-embedding-3-small'
export const HERCULES_EMBEDDING_DIMENSIONS = 512

export type EmbeddableCatalogFields = {
  description?: string | null
  brand?: string | null
  manufacturerName?: string | null
  category?: string | null
  subcategory?: string | null
}

/** Canonical text an item is embedded from (also used at query time). */
export function catalogEmbeddingText(item: EmbeddableCatalogFields): string {
  return [
    item.description,
    item.brand,
    item.manufacturerName,
    [item.category, item.subcategory].filter(Boolean).join(' / '),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000)
}

export type EmbedOptions = {
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function embedTexts(
  texts: string[],
  options: EmbedOptions = {}
): Promise<number[][]> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')
  const fetchImpl = options.fetchImpl ?? fetch

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)

  try {
    const response = await fetchImpl('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: HERCULES_EMBEDDING_MODEL,
        dimensions: HERCULES_EMBEDDING_DIMENSIONS,
        // The API rejects empty strings; a lone space embeds harmlessly.
        input: texts.map((text) => (text.trim() ? text : ' ')),
      }),
      signal: controller.signal,
    })

    const body = (await response.json()) as JsonObject
    if (!response.ok) {
      const message =
        (body.error as JsonObject | undefined)?.message ?? `HTTP ${response.status}`
      throw new Error(`OpenAI embeddings failed: ${String(message)}`)
    }

    const data = body.data as Array<{ index: number; embedding: number[] }>
    return data
      .slice()
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.embedding)
  } finally {
    clearTimeout(timeout)
  }
}

/** Best-effort query embedding: null (lexical-only search) on any failure. */
export async function embedQuery(
  text: string,
  options: EmbedOptions = {}
): Promise<number[] | null> {
  try {
    const [embedding] = await embedTexts([text], {
      timeoutMs: 5_000,
      ...options,
    })
    return embedding ?? null
  } catch {
    return null
  }
}

/** pgvector halfvec input literal. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}
