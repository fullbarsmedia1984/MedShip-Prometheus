// =============================================================================
// AskZeus conversation persistence — service-role reads/writes with explicit
// ownership checks (RLS grants clients read-only access to their own rows, but
// all app access goes through here).
// =============================================================================

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { ChatMessage } from './agent'
import type { ConversationSummary, StoredMessage } from './types'

const TITLE_MAX = 60

interface ConversationRow {
  id: string
  user_id: string
  title: string
  created_at: string
  last_message_at: string
}

interface MessageRow {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: Record<string, unknown>
  created_at: string
}

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
  }
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('askzeus_conversations')
    .select('id, user_id, title, created_at, last_message_at')
    .eq('user_id', userId)
    .order('last_message_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return ((data ?? []) as ConversationRow[]).map(toSummary)
}

/** Returns the conversation only if it belongs to userId. */
export async function getOwnedConversation(
  conversationId: string,
  userId: string
): Promise<ConversationSummary | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('askzeus_conversations')
    .select('id, user_id, title, created_at, last_message_at')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toSummary(data as ConversationRow) : null
}

export async function createConversation(
  userId: string,
  firstMessage: string
): Promise<ConversationSummary> {
  const supabase = createAdminClient()
  const title =
    firstMessage.length > TITLE_MAX
      ? `${firstMessage.slice(0, TITLE_MAX - 1).trimEnd()}…`
      : firstMessage
  const { data, error } = await supabase
    .from('askzeus_conversations')
    .insert({ user_id: userId, title })
    .select('id, user_id, title, created_at, last_message_at')
    .single()
  if (error) throw new Error(error.message)
  return toSummary(data as ConversationRow)
}

export async function renameConversation(
  conversationId: string,
  userId: string,
  title: string
): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('askzeus_conversations')
    .update({ title: title.slice(0, 120) })
    .eq('id', conversationId)
    .eq('user_id', userId)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

export async function deleteConversation(
  conversationId: string,
  userId: string
): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('askzeus_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

export async function getConversationMessages(
  conversationId: string
): Promise<StoredMessage[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('askzeus_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as MessageRow[]).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }))
}

/** Rebuild the OpenAI-format message history from stored rows. */
export function toChatHistory(messages: StoredMessage[]): ChatMessage[] {
  return messages.map((message) => message.content as unknown as ChatMessage)
}

export async function appendMessages(
  conversationId: string,
  entries: Array<{
    message: ChatMessage
    model?: string
    inputTokens?: number
    outputTokens?: number
  }>
): Promise<void> {
  if (entries.length === 0) return
  const supabase = createAdminClient()
  // Explicit staggered timestamps: a batch insert would give every row the
  // same created_at default, losing the assistant/tool ordering the history
  // replay depends on.
  const base = Date.now()
  const { error } = await supabase.from('askzeus_messages').insert(
    entries.map((entry, index) => ({
      conversation_id: conversationId,
      role: entry.message.role,
      content: entry.message,
      model: entry.model ?? null,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      created_at: new Date(base + index).toISOString(),
    }))
  )
  if (error) throw new Error(error.message)
  await supabase
    .from('askzeus_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)
}
