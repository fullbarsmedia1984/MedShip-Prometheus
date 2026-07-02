import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export type AppRole = 'superadmin' | 'admin' | 'staff' | 'sales_rep' | 'sales_manager'

const APP_ROLES: readonly AppRole[] = [
  'superadmin',
  'admin',
  'staff',
  'sales_rep',
  'sales_manager',
]

export type ApiAuthOptions = {
  roles?: AppRole[]
}

export const SUPERADMIN_API_AUTH_OPTIONS = {
  roles: ['superadmin'],
} satisfies ApiAuthOptions

export const ADMIN_API_AUTH_OPTIONS = {
  roles: ['superadmin', 'admin'],
} satisfies ApiAuthOptions

export const STAFF_API_AUTH_OPTIONS = {
  roles: ['superadmin', 'admin', 'staff'],
} satisfies ApiAuthOptions

type AuthContext = {
  user: User | null
  role: AppRole | null
  isDevBypass: boolean
}

type ApiAuthResult =
  | ({ authorized: true } & AuthContext)
  | { authorized: false; response: NextResponse<{ error: string }> }

export function isLocalAuthBypassEnabled() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  return (
    process.env.NODE_ENV === 'development' &&
    (!supabaseUrl || !supabaseAnonKey)
  )
}

export async function getAuthContext(): Promise<AuthContext | null> {
  if (isLocalAuthBypassEnabled()) {
    return {
      user: null,
      role: 'superadmin',
      isDevBypass: true,
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  // profiles is the source of truth for role and active status; RLS lets a
  // user read their own row. app_metadata.role is the fallback for the
  // window between user creation and profile backfill.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (profile && profile.is_active === false) {
    return null
  }

  const role = parseRole(profile?.role) ?? parseRole(user.app_metadata.role)

  return {
    user,
    role,
    isDevBypass: false,
  }
}

export async function requireDashboardAuth(options?: ApiAuthOptions) {
  const auth = await getAuthContext()

  if (!auth) {
    redirect('/login')
  }

  if (options?.roles?.length && !hasAllowedRole(auth.role, options.roles)) {
    redirect('/dashboard')
  }

  return auth
}

export async function requireApiAuth(
  options?: ApiAuthOptions
): Promise<ApiAuthResult> {
  const auth = await getAuthContext()

  if (!auth) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  if (options?.roles?.length && !hasAllowedRole(auth.role, options.roles)) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }

  return {
    authorized: true,
    ...auth,
  }
}

function hasAllowedRole(role: AppRole | null, allowedRoles: AppRole[]) {
  return role !== null && allowedRoles.includes(role)
}

// Roles come from profiles/app_metadata only: user_metadata is user-editable
// via the Supabase client API, so trusting it would let users self-assign
// roles.
function parseRole(value: unknown): AppRole | null {
  if (typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value)) {
    return value as AppRole
  }

  return null
}
