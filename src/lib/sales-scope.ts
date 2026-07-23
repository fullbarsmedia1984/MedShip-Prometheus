import 'server-only'
import type { User } from '@supabase/supabase-js'
import type { AppRole } from '@/lib/auth'
import { getRepAliases } from '@/lib/reps'

/**
 * Resolve the row-scope for the sales dashboards: sales reps only ever see
 * rows tagged with their own Fishbowl salesperson aliases; every other role
 * gets `undefined` (no row scope). A rep with no alias linkage gets `[]`,
 * which matches nothing — the correct fail-closed default.
 *
 * Shared by the dashboard API routes and the server-rendered pages so the
 * two entry points apply identical scoping by construction.
 */
export async function resolveRepScope(
  role: AppRole | null,
  user: User | null
): Promise<string[] | undefined> {
  return role === 'sales_rep' && user ? getRepAliases(user.id) : undefined
}
