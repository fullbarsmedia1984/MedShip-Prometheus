// =============================================================================
// AskZeus shared types — SSE wire protocol + stored message shapes.
// Shared by the server (agent/route) and the client chat hook, so this file
// must stay free of server-only imports.
// =============================================================================

export type AskZeusRole = 'user' | 'assistant' | 'tool'

/**
 * One stored chat message. `content` is the full OpenAI-format message object
 * (role, content, tool_calls / tool_call_id) exactly as sent to OpenRouter,
 * so history replay is a straight passthrough.
 */
export interface StoredMessage {
  id: string
  role: AskZeusRole
  content: Record<string, unknown>
  createdAt: string
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  lastMessageAt: string
}

// -----------------------------------------------------------------------------
// SSE events streamed from POST /api/askzeus/chat
// -----------------------------------------------------------------------------

export interface MetaEvent {
  type: 'meta'
  conversationId: string
}

export interface StatusEvent {
  type: 'status'
  state: 'thinking' | 'responding'
}

export interface TextDeltaEvent {
  type: 'text_delta'
  delta: string
}

export interface ToolStartEvent {
  type: 'tool_start'
  toolUseId: string
  name: string
  /** Human label for the activity chip, e.g. "Searching orders…" */
  label: string
}

export interface ToolEndEvent {
  type: 'tool_end'
  toolUseId: string
  name: string
  ok: boolean
  /** e.g. "12 orders found" */
  resultSummary: string
}

export interface ErrorEvent {
  type: 'error'
  code: 'llm_error' | 'refusal' | 'max_tokens' | 'max_tool_rounds' | 'internal'
  message: string
}

export interface DoneEvent {
  type: 'done'
  stopReason: string | null
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  }
}

export type AskZeusEvent =
  | MetaEvent
  | StatusEvent
  | TextDeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | ErrorEvent
  | DoneEvent
