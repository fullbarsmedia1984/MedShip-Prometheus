import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export type AppRole = 'admin' | 'operator' | 'user'

export type ApiAuthOptions = {
  roles?: AppRole[]
}

export const ADMIN_API_AUTH_OPTIONS = {
  roles: ['admin'],
} satisfies ApiAuthOptions

type AuthContext = {
  user: User | null
  roles: string[]
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
      roles: ['admin'],
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

  return {
    user,
    roles: getUserRoles(user),
    isDevBypass: false,
  }
}

export async function requireDashboardAuth() {
  const auth = await getAuthContext()

  if (!auth) {
    redirect('/login')
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

  if (options?.roles?.length && !hasAllowedRole(auth.roles, options.roles)) {
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

function hasAllowedRole(userRoles: string[], allowedRoles: AppRole[]) {
  return userRoles.some((role) => allowedRoles.includes(role as AppRole))
}

// Roles come from app_metadata only: user_metadata is user-editable via the
// Supabase client API, so trusting it would let users self-assign roles.
function getUserRoles(user: User) {
  const roles = new Set<string>()
  addRoles(roles, user.app_metadata.role)
  addRoles(roles, user.app_metadata.roles)

  return [...roles]
}

function addRoles(roles: Set<string>, value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    roles.add(value.trim())
    return
  }

  if (Array.isArray(value)) {
    for (const role of value) {
      if (typeof role === 'string' && role.trim()) {
        roles.add(role.trim())
      }
    }
  }
}
