import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type AuditActor = {
  userId: string | null
  email: string | null
}

export type AuditEntry = {
  actor: AuditActor
  action: string
  entityType: string
  entityId?: string | null
  summary?: string
  diff?: Record<string, unknown>
}

/**
 * Append a who-changed record to audit_log. Best-effort: a logging failure is
 * swallowed (and console-warned) so it never blocks the action being audited.
 * Writes via the service role — audit_log has no client write policy.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('audit_log').insert({
      actor_user_id: entry.actor.userId,
      actor_email: entry.actor.email,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      summary: entry.summary ?? null,
      diff: entry.diff ?? {},
    })

    if (error) {
      console.error('Failed to write audit_log entry:', error.message, entry.action)
    }
  } catch (error) {
    console.error(
      'Failed to write audit_log entry:',
      error instanceof Error ? error.message : String(error),
      entry.action
    )
  }
}
