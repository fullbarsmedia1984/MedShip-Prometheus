import { requireDashboardAuth, ADMIN_API_AUTH_OPTIONS } from '@/lib/auth'
import { listUsers, ASSIGNABLE_ROLES } from '@/lib/users'
import { getEmailConfiguration } from '@/lib/email'
import { UsersManager } from './UsersManager'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const auth = await requireDashboardAuth(ADMIN_API_AUTH_OPTIONS)
  const actorRole = auth.role as 'superadmin' | 'admin'
  const users = await listUsers()
  const email = getEmailConfiguration()

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-medship-dark">User Management</h1>
        <p className="mt-1 text-sm text-medship-secondary">
          Invite teammates, assign roles, and deactivate access.
        </p>
      </div>
      <UsersManager
        initialUsers={users}
        assignableRoles={ASSIGNABLE_ROLES[actorRole]}
        currentUserId={auth.user?.id ?? null}
        currentUserEmail={auth.user?.email ?? null}
        emailStatus={{
          ready: email.ready,
          sender: email.sender,
          appUrl: email.appUrl,
          issues: email.issues,
        }}
      />
    </div>
  )
}
