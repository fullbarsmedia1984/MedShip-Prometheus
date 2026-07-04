import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth, type AppRole } from '@/lib/auth'
import { ASSIGNABLE_ROLES, changeUserRole, setUserActive } from '@/lib/users'

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
