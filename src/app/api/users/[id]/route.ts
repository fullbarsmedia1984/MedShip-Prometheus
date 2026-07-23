import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth, type AppRole } from '@/lib/auth'
import {
  ASSIGNABLE_ROLES,
  changeUserRole,
  resendInvite,
  sendPasswordResetForUser,
  setUserActive,
} from '@/lib/users'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
  if (!auth.authorized) return auth.response

  const { id } = await params
  const actorRole = auth.role as 'superadmin' | 'admin'
  const actor = { userId: auth.user?.id ?? null, email: auth.user?.email ?? null }
  const body = (await request.json()) as { role?: AppRole; isActive?: boolean }

  try {
    if (body.role !== undefined) {
      // Only superadmin can grant/revoke admin; admins manage staff and below.
      if (!ASSIGNABLE_ROLES[actorRole].includes(body.role)) {
        return NextResponse.json(
          { error: `You cannot assign the role "${body.role}"` },
          { status: 403 }
        )
      }
      await changeUserRole({ userId: id, role: body.role, actor })
    }

    if (body.isActive !== undefined) {
      await setUserActive({ userId: id, isActive: body.isActive, actor })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update user' },
      { status: 400 }
    )
  }
}

// Email actions: re-send an invite (never-signed-in users) or send a
// password reset on the user's behalf.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
  if (!auth.authorized) return auth.response

  const { id } = await params
  const actor = { userId: auth.user?.id ?? null, email: auth.user?.email ?? null }
  const body = (await request.json().catch(() => ({}))) as { action?: string }

  try {
    if (body.action === 'resend_invite') {
      const result = await resendInvite({
        userId: id,
        actor,
        inviterName: auth.user?.email ?? 'An administrator',
      })
      return NextResponse.json(result)
    }

    if (body.action === 'send_reset') {
      const result = await sendPasswordResetForUser({ userId: id, actor })
      return NextResponse.json(result)
    }

    return NextResponse.json(
      { error: 'Unknown action. Use "resend_invite" or "send_reset".' },
      { status: 400 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Action failed' },
      { status: 400 }
    )
  }
}
