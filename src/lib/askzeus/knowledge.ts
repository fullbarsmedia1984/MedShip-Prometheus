// =============================================================================
// AskZeus knowledge base — admin-curated facts injected into the system
// context on every chat turn. This is the practical "training" mechanism:
// edits take effect on the next question, no deploy needed.
// =============================================================================

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export interface KnowledgeEntry {
  id: string
  content: string
  active: boolean
  createdAt: string
  updatedAt: string
}

interface KnowledgeRow {
  id: string
  content: string
  active: boolean
  created_at: string
  updated_at: string
}

function toEntry(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    content: row.content,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Active entries' text, oldest first, for prompt injection. */
export async function getActiveKnowledge(): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('askzeus_knowledge')
    .select('content')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) {
    // Knowledge is an enhancement — never block a chat on it.
    console.warn('askzeus_knowledge fetch failed:', error.message)
    return []
  }
  return ((data ?? []) as Array<{ content: string }>).map((row) => row.content)
}

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('askzeus_knowledge')
    .select('id, content, active, created_at, updated_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as KnowledgeRow[]).map(toEntry)
}

export async function createKnowledge(
  content: string,
  createdBy: string | null
): Promise<KnowledgeEntry> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('askzeus_knowledge')
    .insert({ content, created_by: createdBy })
    .select('id, content, active, created_at, updated_at')
    .single()
  if (error) throw new Error(error.message)
  return toEntry(data as KnowledgeRow)
}

export async function updateKnowledge(
  id: string,
  patch: { content?: string; active?: boolean }
): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('askzeus_knowledge')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

export async function deleteKnowledge(id: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('askzeus_knowledge')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}
