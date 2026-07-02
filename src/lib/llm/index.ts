// =============================================================================
// Zeus Packaging Estimator — LLM provider factory
// Provider selection via env: ESTIMATOR_LLM_PROVIDER=anthropic|openrouter|disabled
// (auto-detected from available API keys when unset). Every call is logged to
// estimator_llm_calls; the pipeline never blocks on LLM availability.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { AnthropicJsonCompleter } from './anthropic-completer'
import { OpenRouterJsonCompleter } from './openrouter-completer'
import {
  DisabledLlmProvider,
  JsonEstimatorLlmProvider,
  type JsonCompleter,
} from './provider-base'
import type { EstimatorLlmProvider, LlmCallRecord } from './types'

export * from './types'
export { DisabledLlmProvider } from './provider-base'

async function logToSupabase(record: LlmCallRecord): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('estimator_llm_calls').insert({
    purpose: record.purpose,
    provider: record.provider,
    model: record.model,
    prompt_hash: record.promptHash,
    latency_ms: record.latencyMs,
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
    success: record.success,
    error: record.error,
    result: record.result ?? null,
  })
}

function resolveCompleter(): JsonCompleter | null {
  const requested = process.env.ESTIMATOR_LLM_PROVIDER?.toLowerCase()
  const model = process.env.ESTIMATOR_LLM_MODEL || undefined
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openRouterKey = process.env.OPENROUTER_API_KEY

  if (requested === 'disabled') return null
  if (requested === 'anthropic') {
    return anthropicKey ? new AnthropicJsonCompleter(anthropicKey, model) : null
  }
  if (requested === 'openrouter') {
    return openRouterKey ? new OpenRouterJsonCompleter(openRouterKey, model) : null
  }

  // Auto-detect: prefer Anthropic when both keys exist.
  if (anthropicKey) return new AnthropicJsonCompleter(anthropicKey, model)
  if (openRouterKey) return new OpenRouterJsonCompleter(openRouterKey, model)
  return null
}

export function getEstimatorLlmProvider(): EstimatorLlmProvider {
  const completer = resolveCompleter()
  if (!completer) return new DisabledLlmProvider()
  return new JsonEstimatorLlmProvider(completer, logToSupabase)
}
