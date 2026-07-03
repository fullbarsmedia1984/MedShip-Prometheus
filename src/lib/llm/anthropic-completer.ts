// =============================================================================
// Anthropic completer — Claude Haiku via the official SDK with structured
// outputs (output_config.format json_schema) so responses are guaranteed JSON.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk'
import type { JsonCompleter, JsonCompletion } from './provider-base'

const DEFAULT_MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 4096

export class AnthropicJsonCompleter implements JsonCompleter {
  readonly providerName = 'anthropic'
  readonly model: string
  private client: Anthropic

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey })
    this.model = model ?? DEFAULT_MODEL
  }

  async completeJson(
    system: string,
    user: string,
    jsonSchema: Record<string, unknown>
  ): Promise<JsonCompletion> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: {
        format: { type: 'json_schema', schema: jsonSchema },
      },
    })

    if (response.stop_reason === 'refusal') {
      throw new Error('LLM refused the request')
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')

    return {
      data: JSON.parse(text),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  }
}
