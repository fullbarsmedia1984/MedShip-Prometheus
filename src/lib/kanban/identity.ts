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

// Auto-provision defaults: app role -> kanban job role guess. Cosmetic and
// editable later; command access for admins comes from appRole regardless.
const APP_TO_JOB_ROLE: Record<string, string> = {
  superadmin: 'coo',
  admin: 'coo',
  staff: 'customer_service',
  sales_manager: 'territory_sales_rep',
  sales_rep: 'territory_sales_rep',
  warehouse: 'warehouse_staff',
}

const AVATAR_PALETTE = [
  '#0e5e56', '#ff5a1f', '#2563eb', '#db2777', '#b45309',
  '#059669', '#4f46e5', '#0d9488', '#9333ea', '#65a30d',
]

/** First sign-in provisioning: a directory row plus a personal board with
 *  To Do / In Progress / Done columns. */
async function provisionIdentity(
  userId: string,
  fallbackEmail: string | null
): Promise<KanbanUser | null> {
  const supabase = createAdminClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, display_name, role, is_active')
    .eq('id', userId)
    .maybeSingle()
  if (!profile || profile.is_active === false) return null

  const email = (profile.email as string | null) ?? fallbackEmail
  if (!email) return null
  const fullName =
    (profile.display_name as string | null)?.trim() || email.split('@')[0]
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0
  const avatar = AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]

  const { data: created, error } = await supabase
    .from('kanban_users')
    .upsert(
      {
        full_name: fullName,
        email,
        job_role: APP_TO_JOB_ROLE[profile.role as string] ?? 'customer_service',
        avatar_color: avatar,
        profile_id: userId,
        is_active: true,
      },
      { onConflict: 'email' }
    )
    .select(USER_COLUMNS)
    .single()
  if (error || !created) return null

  // personal board (idempotent via unique slug)
  const slug = `me-${fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${created.id.slice(0, 4)}`
  const { data: board } = await supabase
    .from('kanban_boards')
    .upsert(
      {
        slug,
        name: `${fullName}'s Board`,
        kind: 'personal',
        owner_id: created.id,
        description: 'Personal task board',
        accent: avatar,
        position: 100,
      },
      { onConflict: 'slug' }
    )
    .select('id')
    .single()
  if (board) {
    const { data: existingCols } = await supabase
      .from('kanban_columns')
      .select('id')
      .eq('board_id', board.id)
      .limit(1)
    if (!existingCols || existingCols.length === 0) {
      await supabase.from('kanban_columns').insert([
        { board_id: board.id, name: 'To Do', position: 1, is_done_column: false },
        { board_id: board.id, name: 'In Progress', position: 2, is_done_column: false },
        { board_id: board.id, name: 'Done', position: 3, is_done_column: true },
      ])
    }
  }
  return created as KanbanUser
}

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

  // No directory row yet: first sign-in auto-provisions one (plus a
  // personal board), so real staff need zero setup to use the boards.
  if (userId) {
    return provisionIdentity(userId, email)
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
