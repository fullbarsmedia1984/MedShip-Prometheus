import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  KANBAN_API_AUTH_OPTIONS,
  requireApiAuth,
  requireDashboardAuth,
} from '@/lib/auth'
import { isExecutiveJobRole } from './roles'
import type { KanbanUser } from './types'

export interface KanbanContext {
  /** Zeus app role (profiles.role); null only in dev bypass. */
  appRole: string | null
  /** The directory person linked to the signed-in profile, if any. */
  identity: KanbanUser | null
  /** Command access: sees and manages every board (CEO/COO tier). */
  isExec: boolean
}

const USER_COLUMNS = 'id, full_name, email, job_role, avatar_color, profile_id'

/**
 * Resolve the signed-in Zeus user to a Kanban directory person.
 * Match by profiles link first, then by email (lazily persisting the link).
 * superadmin/admin app roles get command access even without a directory row.
 */
async function resolveIdentity(
  userId: string | null,
  email: string | null
): Promise<KanbanUser | null> {
  const supabase = createAdminClient()

  if (userId) {
    const { data } = await supabase
      .from('kanban_users')
      .select(USER_COLUMNS)
      .eq('profile_id', userId)
      .eq('is_active', true)
      .maybeSingle()
    if (data) return data as KanbanUser
  }

  if (email) {
    const { data } = await supabase
      .from('kanban_users')
      .select(USER_COLUMNS)
      .ilike('email', email)
      .eq('is_active', true)
      .maybeSingle()
    if (data) {
      if (userId && !data.profile_id) {
        await supabase
          .from('kanban_users')
          .update({ profile_id: userId })
          .eq('id', data.id)
      }
      return data as KanbanUser
    }
  }

  return null
}

function buildContext(
  appRole: string | null,
  identity: KanbanUser | null
): KanbanContext {
  const isExec =
    appRole === 'superadmin' ||
    appRole === 'admin' ||
    (identity !== null && isExecutiveJobRole(identity.job_role))
  return { appRole, identity, isExec }
}

/** For dashboard pages: redirects to /login when signed out. */
export async function requireKanbanPageContext(): Promise<KanbanContext> {
  const auth = await requireDashboardAuth(KANBAN_API_AUTH_OPTIONS)
  const identity = await resolveIdentity(
    auth.user?.id ?? null,
    auth.user?.email ?? null
  )
  return buildContext(auth.role, identity)
}

/** For API routes: returns a NextResponse on auth failure. */
export async function requireKanbanApiContext() {
  const auth = await requireApiAuth(KANBAN_API_AUTH_OPTIONS)
  if (!auth.authorized) {
    return { authorized: false as const, response: auth.response }
  }
  const identity = await resolveIdentity(
    auth.user?.id ?? null,
    auth.user?.email ?? null
  )
  return {
    authorized: true as const,
    context: buildContext(auth.role, identity),
  }
}
