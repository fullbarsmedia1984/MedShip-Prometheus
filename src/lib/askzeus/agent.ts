// =============================================================================
// AskZeus agentic loop — OpenRouter (OpenAI-compatible chat completions).
//
// Raw REST like the rest of this repo's OpenRouter callers. Streams text
// deltas out as SSE events, accumulates streamed tool calls, executes them
// against the registry, feeds results back, and repeats until the model
// finishes. Every API call is logged to askzeus_llm_calls.
// =============================================================================

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { SYSTEM_PROMPT, buildDynamicContext } from './prompt'
import type { AskZeusTool, ToolContext } from './tools'
import type { AskZeusEvent } from './types'
import type { AppRole } from '@/lib/auth'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'anthropic/claude-opus-4.8'
const MAX_TOKENS = 8000
const MAX_TOOL_ROUNDS = 8

export function askZeusModel(): string {
  return process.env.ASKZEUS_LLM_MODEL || DEFAULT_MODEL
}

// ---------------------------------------------------------------------------
// OpenAI-format chat message types (what we send, stream, and persist)
// ---------------------------------------------------------------------------

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface TextPart {
  type: 'text'
  text: string
  // OpenRouter passes cache_control through to Anthropic models.
  cache_control?: { type: 'ephemeral' }
}

export type ChatMessage =
  | { role: 'system'; content: TextPart[] }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface AgentRunParams {
  /** Prior turns in OpenAI chat format, exactly as stored. */
  history: ChatMessage[]
  tools: AskZeusTool[]
  toolContext: ToolContext
  role: AppRole
  displayName: string | null
  conversationId: string
  signal?: AbortSignal
}

export interface AgentRunOutput {
  /** Messages created this turn (assistant + tool results), for persistence. */
  newMessages: ChatMessage[]
  stopReason: string | null
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  }
}

// ---------------------------------------------------------------------------
// Streaming chunk shapes (the subset we read)
// ---------------------------------------------------------------------------

interface StreamToolCallDelta {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface StreamChunk {
  error?: { message?: string }
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning?: string | null
      tool_calls?: StreamToolCallDelta[]
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    cache_creation_input_tokens?: number
  }
}

interface RoundResult {
  text: string
  toolCalls: ChatToolCall[]
  finishReason: string | null
  usage: StreamChunk['usage'] | null
}

function toOpenAiTools(tools: AskZeusTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))
}

async function logLlmCall(entry: {
  conversationId: string
  model: string
  latencyMs: number
  usage?: StreamChunk['usage'] | null
  stopReason?: string | null
  toolRound: number
  success: boolean
  error?: string
}) {
  try {
    const supabase = createAdminClient()
    await supabase.from('askzeus_llm_calls').insert({
      conversation_id: entry.conversationId,
      model: entry.model,
      latency_ms: entry.latencyMs,
      input_tokens: entry.usage?.prompt_tokens ?? null,
      output_tokens: entry.usage?.completion_tokens ?? null,
      cache_read_tokens: entry.usage?.prompt_tokens_details?.cached_tokens ?? null,
      cache_creation_tokens: entry.usage?.cache_creation_input_tokens ?? null,
      stop_reason: entry.stopReason ?? null,
      tool_round: entry.toolRound,
      success: entry.success,
      error: entry.error ?? null,
    })
  } catch (error) {
    console.warn('askzeus_llm_calls insert failed:', error)
  }
}

/**
 * One streamed completion round. Yields text/status events as they arrive and
 * returns the accumulated round result. `reasoning: {enabled: true}` asks
 * OpenRouter to turn thinking on where the model supports it; if the provider
 * rejects that field we retry once without it (remembered per process).
 */
let reasoningUnsupported = false

async function* streamRound(params: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools: ReturnType<typeof toOpenAiTools>
  signal?: AbortSignal
}): AsyncGenerator<AskZeusEvent, RoundResult, void> {
  const buildBody = (withReasoning: boolean) =>
    JSON.stringify({
      model: params.model,
      max_tokens: MAX_TOKENS,
      messages: params.messages,
      tools: params.tools,
      stream: true,
      usage: { include: true },
      ...(withReasoning ? { reasoning: { enabled: true } } : {}),
    })

  const doFetch = (withReasoning: boolean) =>
    fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://medshipllc.com',
        // ASCII only — fetch() rejects non-ByteString header values.
        'X-Title': 'MedShip Zeus AskZeus',
      },
      body: buildBody(withReasoning),
      signal: params.signal,
    })

  let response = await doFetch(!reasoningUnsupported)
  if (!response.ok && !reasoningUnsupported && response.status === 400) {
    const detail = await response.text().catch(() => '')
    if (/reasoning|thinking/i.test(detail)) {
      reasoningUnsupported = true
      response = await doFetch(false)
    } else {
      throw new Error(parseErrorDetail(detail, response.status))
    }
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(parseErrorDetail(detail, response.status))
  }
  if (!response.body) {
    throw new Error('OpenRouter returned no response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  let text = ''
  const toolCallsByIndex = new Map<number, ChatToolCall>()
  let finishReason: string | null = null
  let usage: StreamChunk['usage'] | null = null
  let announcedThinking = false
  let announcedText = false

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      // OpenRouter emits ": OPENROUTER PROCESSING" keep-alive comments.
      if (!line || line.startsWith(':')) continue
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') continue

      let chunk: StreamChunk
      try {
        chunk = JSON.parse(payload) as StreamChunk
      } catch {
        continue
      }

      if (chunk.error?.message) {
        throw new Error(chunk.error.message)
      }
      if (chunk.usage) {
        usage = chunk.usage
      }

      const choice = chunk.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) {
        finishReason = choice.finish_reason
      }

      const delta = choice.delta
      if (!delta) continue

      if (delta.reasoning && !announcedThinking) {
        announcedThinking = true
        yield { type: 'status', state: 'thinking' }
      }

      if (delta.content) {
        if (!announcedText) {
          announcedText = true
          yield { type: 'status', state: 'responding' }
        }
        text += delta.content
        yield { type: 'text_delta', delta: delta.content }
      }

      for (const toolDelta of delta.tool_calls ?? []) {
        const existing = toolCallsByIndex.get(toolDelta.index)
        if (existing) {
          if (toolDelta.function?.arguments) {
            existing.function.arguments += toolDelta.function.arguments
          }
          if (toolDelta.function?.name) {
            existing.function.name = toolDelta.function.name
          }
          if (toolDelta.id) existing.id = toolDelta.id
        } else {
          toolCallsByIndex.set(toolDelta.index, {
            id: toolDelta.id ?? `call_${toolDelta.index}`,
            type: 'function',
            function: {
              name: toolDelta.function?.name ?? '',
              arguments: toolDelta.function?.arguments ?? '',
            },
          })
        }
      }
    }
  }

  const toolCalls = [...toolCallsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => call)

  return { text, toolCalls, finishReason, usage }
}

function parseErrorDetail(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    if (parsed.error?.message) return parsed.error.message
  } catch {
    // fall through
  }
  return `OpenRouter request failed (${status})`
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Run one user turn. Yields SSE events; collects the messages produced this
 * turn (for persistence) into the returned output object.
 */
export async function* runAskZeusAgent(
  params: AgentRunParams,
  output: AgentRunOutput
): AsyncGenerator<AskZeusEvent, void, void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    yield {
      type: 'error',
      code: 'internal',
      message: 'AskZeus is not configured (missing OPENROUTER_API_KEY)',
    }
    return
  }

  const model = askZeusModel()
  const openAiTools = toOpenAiTools(params.tools)
  const toolByName = new Map(params.tools.map((tool) => [tool.name, tool]))

  // The static prompt carries the cache breakpoint; the dynamic block sits
  // after it so date/role changes never invalidate the cached prefix.
  const systemMessage: ChatMessage = {
    role: 'system',
    content: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: buildDynamicContext({
          role: params.role,
          displayName: params.displayName,
          repScoped: params.toolContext.repAliases !== null,
        }),
      },
    ],
  }

  const messages: ChatMessage[] = [systemMessage, ...params.history]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const startedAt = Date.now()
    let result: RoundResult

    try {
      result = yield* streamRound({
        apiKey,
        model,
        messages,
        tools: openAiTools,
        signal: params.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LLM request failed'
      void logLlmCall({
        conversationId: params.conversationId,
        model,
        latencyMs: Date.now() - startedAt,
        toolRound: round,
        success: false,
        error: message,
      })
      yield { type: 'error', code: 'llm_error', message }
      return
    }

    void logLlmCall({
      conversationId: params.conversationId,
      model,
      latencyMs: Date.now() - startedAt,
      usage: result.usage,
      stopReason: result.finishReason,
      toolRound: round,
      success: true,
    })

    output.usage.inputTokens += result.usage?.prompt_tokens ?? 0
    output.usage.outputTokens += result.usage?.completion_tokens ?? 0
    output.usage.cacheReadTokens +=
      result.usage?.prompt_tokens_details?.cached_tokens ?? 0
    output.usage.cacheCreationTokens +=
      result.usage?.cache_creation_input_tokens ?? 0
    output.stopReason = result.finishReason

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: result.text || null,
      ...(result.toolCalls.length > 0 ? { tool_calls: result.toolCalls } : {}),
    }
    messages.push(assistantMessage)
    output.newMessages.push(assistantMessage)

    if (result.toolCalls.length === 0) {
      if (result.finishReason === 'length') {
        yield {
          type: 'error',
          code: 'max_tokens',
          message: 'The response was cut off — try asking a narrower question.',
        }
        return
      }
      yield {
        type: 'done',
        stopReason: result.finishReason,
        usage: output.usage,
      }
      return
    }

    // Execute every tool call concurrently, then append one 'tool' message
    // per call (OpenAI format), in call order.
    for (const call of result.toolCalls) {
      const tool = toolByName.get(call.function.name)
      yield {
        type: 'tool_start',
        toolUseId: call.id,
        name: call.function.name,
        label: tool?.activityLabel ?? `Running ${call.function.name}…`,
      }
    }

    const settled = await Promise.all(
      result.toolCalls.map(async (call) => {
        const tool = toolByName.get(call.function.name)
        if (!tool) {
          return {
            call,
            ok: false,
            summary: 'Unknown tool',
            content: `Error: tool ${call.function.name} is not available.`,
          }
        }
        try {
          const toolResult = await tool.execute(
            parseToolArguments(call.function.arguments),
            params.toolContext
          )
          return {
            call,
            ok: true,
            summary: toolResult.summary,
            content: JSON.stringify(toolResult.data),
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool failed'
          return { call, ok: false, summary: message, content: `Error: ${message}` }
        }
      })
    )

    for (const item of settled) {
      yield {
        type: 'tool_end',
        toolUseId: item.call.id,
        name: item.call.function.name,
        ok: item.ok,
        resultSummary: item.summary,
      }
      const toolMessage: ChatMessage = {
        role: 'tool',
        tool_call_id: item.call.id,
        content: item.content,
      }
      messages.push(toolMessage)
      output.newMessages.push(toolMessage)
    }
  }

  yield {
    type: 'error',
    code: 'max_tool_rounds',
    message:
      'This question needed more data lookups than allowed in one turn. Try breaking it into smaller questions.',
  }
}
