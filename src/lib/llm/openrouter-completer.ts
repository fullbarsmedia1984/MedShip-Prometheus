// =============================================================================
// OpenRouter completer — Claude Haiku through OpenRouter's OpenAI-compatible
// chat completions endpoint, for deployments keyed with an OpenRouter key.
// =============================================================================

import type { JsonCompleter, JsonCompletion } from './provider-base'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5'
const MAX_TOKENS = 4096
const TIMEOUT_MS = 30_000

export class OpenRouterJsonCompleter implements JsonCompleter {
  readonly providerName = 'openrouter'
  readonly model: string

  constructor(
    private readonly apiKey: string,
    model?: string
  ) {
    this.model = model ?? DEFAULT_MODEL
  }

  async completeJson(
    system: string,
    user: string,
    jsonSchema: Record<string, unknown>
  ): Promise<JsonCompletion> {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'estimator_response', strict: true, schema: jsonSchema },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => response.statusText)
      throw new Error(`OpenRouter error ${response.status}: ${body}`)
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = payload.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('OpenRouter response contained no content')
    }

    return {
      data: JSON.parse(content),
      inputTokens: payload.usage?.prompt_tokens ?? null,
      outputTokens: payload.usage?.completion_tokens ?? null,
    }
  }
}
