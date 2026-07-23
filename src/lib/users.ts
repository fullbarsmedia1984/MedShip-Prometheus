import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit, type AuditActor } from '@/lib/audit'
import { sendInviteEmail, sendPasswordResetEmail, sendRoleChangedEmail } from '@/lib/email'
import type { AppRole } from '@/lib/auth'

export type ManagedUser = {
  id: string
  email: string
  displayName: string | null
  role: AppRole
  isActive: boolean
  fishbowlUserId: string | null
  lastSignInAt: string | null
  invitedAt: string | null
  createdAt: string
}

// Roles an inviter may grant. Superadmin can grant admin and below; admin can
// grant staff and below. superadmin is never assignable through this path
// (the sole-superadmin invariant is also enforced by a DB trigger).
export const ASSIGNABLE_ROLES: Record<'superadmin' | 'admin', AppRole[]> = {
  superadmin: ['admin', 'staff', 'sales_rep', 'sales_manager', 'warehouse'],
  admin: ['staff', 'sales_rep', 'sales_manager', 'warehouse'],
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
}

export async function listUsers(): Promise<ManagedUser[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, role, is_active, fishbowl_user_id, invited_at, created_at')
    .order('created_at')

  if (error) throw error

  const { data: authList } = await supabase.auth.admin.listUsers()
  const lastSignIn = new Map(
    (authList?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null])
  )

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as AppRole,
    isActive: row.is_active,
    fishbowlUserId: row.fishbowl_user_id,
    lastSignInAt: lastSignIn.get(row.id) ?? null,
    invitedAt: row.invited_at,
    createdAt: row.created_at,
  }))
}

export async function inviteUser(params: {
  email: string
  role: AppRole
  fishbowlUserId?: string | null
  actor: AuditActor
  inviterName: string
}): Promise<{ id: string; emailSent: boolean; emailError?: string }> {
  const supabase = createAdminClient()

  // Create the auth user ourselves (no Supabase default email) — the invite
  // email below carries a set-password link and goes through Resend. If the
  // address already exists (e.g. a previous invite whose email failed),
  // fall through and re-issue the set-password link instead of erroring.
  let userId: string
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: params.email,
    email_confirm: true,
    app_metadata: { role: params.role },
  })

  if (created?.user) {
    userId = created.user.id
  } else if (createError && /already|registered|exists/i.test(createError.message)) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', params.email)
      .maybeSingle()
    if (!existing) throw new Error(createError.message)
    userId = existing.id
  } else {
    throw new Error(createError?.message ?? 'Failed to create user')
  }

  // Set the role in both places: app_metadata (JWT claim for RLS) and the
  // profile row (management source of truth). The handle_new_user trigger
  // already created the profile row from app_metadata; align it explicitly.
  await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { role: params.role },
  })
  await supabase
    .from('profiles')
    .update({
      role: params.role,
      fishbowl_user_id: params.fishbowlUserId ?? null,
      invited_by: params.actor.userId,
      invited_at: new Date().toISOString(),
      updated_by: params.actor.userId,
    })
    .eq('id', userId)

  // The invite email carries a single-use set-password token redeemed by the
  // /reset-password page (a recovery link works for users who have never set
  // a password). Fall back to the login URL only if link generation fails.
  const { data: link } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: params.email,
  })
  const inviteUrl = link?.properties?.hashed_token
    ? `${appUrl()}/reset-password?token=${encodeURIComponent(link.properties.hashed_token)}`
    : `${appUrl()}/login`

  const invite = await sendInviteEmail({
    to: params.email,
    inviteUrl,
    role: params.role,
    inviterName: params.inviterName,
  })

  await logAudit({
    actor: params.actor,
    action: 'user.invited',
    entityType: 'profile',
    entityId: userId,
    summary: `Invited ${params.email} as ${params.role}`,
    diff: { role: params.role, emailSent: invite.sent, emailError: invite.error ?? null },
  })

  return { id: userId, emailSent: invite.sent, emailError: invite.error }
}

/** Re-send the set-password invite to a user who has never signed in. */
export async function resendInvite(params: {
  userId: string
  actor: AuditActor
  inviterName: string
}): Promise<{ emailSent: boolean; emailError?: string }> {
  const supabase = createAdminClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, role, is_active')
    .eq('id', params.userId)
    .maybeSingle()
  if (!profile) throw new Error('User not found')
  if (!profile.is_active) throw new Error('Reactivate the user before resending their invite')

  const { data: authUser } = await supabase.auth.admin.getUserById(params.userId)
  if (authUser?.user?.last_sign_in_at) {
    throw new Error('This user has already signed in — send a password reset instead')
  }

  const { data: link, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: profile.email,
  })
  if (error || !link?.properties?.hashed_token) {
    throw new Error(error?.message ?? 'Failed to generate the invite link')
  }

  const inviteUrl = `${appUrl()}/reset-password?token=${encodeURIComponent(link.properties.hashed_token)}`
  const result = await sendInviteEmail({
    to: profile.email,
    inviteUrl,
    role: profile.role as AppRole,
    inviterName: params.inviterName,
  })

  await logAudit({
    actor: params.actor,
    action: 'user.invite_resent',
    entityType: 'profile',
    entityId: params.userId,
    summary: `Invite re-sent to ${profile.email}`,
    diff: { emailSent: result.sent, emailError: result.error ?? null },
  })

  return { emailSent: result.sent, emailError: result.error }
}

/** Send a password-reset email to a user on an administrator's behalf. */
export async function sendPasswordResetForUser(params: {
  userId: string
  actor: AuditActor
}): Promise<{ emailSent: boolean; emailError?: string }> {
  const supabase = createAdminClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, is_active')
    .eq('id', params.userId)
    .maybeSingle()
  if (!profile) throw new Error('User not found')
  if (!profile.is_active) throw new Error('Reactivate the user before sending a reset')

  const { data: link, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: profile.email,
  })
  if (error || !link?.properties?.hashed_token) {
    throw new Error(error?.message ?? 'Failed to generate the reset link')
  }

  const resetUrl = `${appUrl()}/reset-password?token=${encodeURIComponent(link.properties.hashed_token)}`
  const result = await sendPasswordResetEmail({ to: profile.email, resetUrl, minutes: 60 })

  await logAudit({
    actor: params.actor,
    action: 'user.password_reset_sent',
    entityType: 'profile',
    entityId: params.userId,
    summary: `Password reset sent to ${profile.email} by an administrator`,
    diff: { emailSent: result.sent, emailError: result.error ?? null },
  })

  return { emailSent: result.sent, emailError: result.error }
}

export async function changeUserRole(params: {
  userId: string
  role: AppRole
  actor: AuditActor
}): Promise<void> {
  const supabase = createAdminClient()

  const { data: current } = await supabase
    .from('profiles')
    .select('email, role')
    .eq('id', params.userId)
    .maybeSingle()

  // The DB trigger is the real guard against demoting the superadmin; fail
  // fast here for a friendlier error.
  if (current?.role === 'superadmin') {
    throw new Error('The superadmin role cannot be changed')
  }

  await supabase.auth.admin.updateUserById(params.userId, {
    app_metadata: { role: params.role },
  })
  const { error } = await supabase
    .from('profiles')
    .update({ role: params.role, updated_by: params.actor.userId })
    .eq('id', params.userId)
  if (error) throw error

  if (current?.email) {
    await sendRoleChangedEmail({ to: current.email, role: params.role })
  }

  await logAudit({
    actor: params.actor,
    action: 'user.role_changed',
    entityType: 'profile',
    entityId: params.userId,
    summary: `Role changed to ${params.role}`,
    diff: { from: current?.role ?? null, to: params.role },
  })
}

export async function setUserActive(params: {
  userId: string
  isActive: boolean
  actor: AuditActor
}): Promise<void> {
  const supabase = createAdminClient()

  const { data: current } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', params.userId)
    .maybeSingle()

  if (current?.role === 'superadmin') {
    throw new Error('The superadmin cannot be deactivated')
  }

  const { error } = await supabase
    .from('profiles')
    .update({ is_active: params.isActive, updated_by: params.actor.userId })
    .eq('id', params.userId)
  if (error) throw error

  // Revoke live sessions immediately on deactivation.
  if (!params.isActive) {
    await supabase.auth.admin.signOut(params.userId, 'global')
  }

  await logAudit({
    actor: params.actor,
    action: params.isActive ? 'user.activated' : 'user.deactivated',
    entityType: 'profile',
    entityId: params.userId,
    summary: params.isActive ? 'User reactivated' : 'User deactivated',
  })
}
