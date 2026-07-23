import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth, type AppRole } from '@/lib/auth'
import { ASSIGNABLE_ROLES, inviteUser, listUsers } from '@/lib/users'

export async function GET() {
  const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
  if (!auth.authorized) return auth.response

  try {
    return NextResponse.json({ users: await listUsers() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list users' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
  if (!auth.authorized) return auth.response

  const actorRole = auth.role as 'superadmin' | 'admin'
  const body = (await request.json()) as {
    email?: string
    role?: AppRole
    fishbowlUserId?: string | null
  }

  const email = body.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }

  if (!body.role || !ASSIGNABLE_ROLES[actorRole].includes(body.role)) {
    return NextResponse.json(
      { error: `You cannot assign the role "${body.role ?? ''}"` },
      { status: 403 }
    )
  }

  try {
    const result = await inviteUser({
      email,
      role: body.role,
      fishbowlUserId: body.fishbowlUserId ?? null,
      actor: { userId: auth.user?.id ?? null, email: auth.user?.email ?? null },
      inviterName: auth.user?.email ?? 'An administrator',
    })
    return NextResponse.json(
      { id: result.id, emailSent: result.emailSent, emailError: result.emailError ?? null },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to invite user' },
      { status: 500 }
    )
  }
}
