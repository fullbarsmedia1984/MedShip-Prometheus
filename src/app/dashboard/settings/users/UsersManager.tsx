'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AppRole } from '@/lib/auth'

type ManagedUser = {
  id: string
  email: string
  displayName: string | null
  role: AppRole
  isActive: boolean
  fishbowlUserId: string | null
  lastSignInAt: string | null
}

const ROLE_LABELS: Record<AppRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  staff: 'Administrative Staff',
  sales_rep: 'Sales Rep',
  sales_manager: 'Sales Manager',
}

function formatDate(value: string | null): string {
  if (!value) return 'Never'
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function UsersManager({
  initialUsers,
  assignableRoles,
  currentUserId,
}: {
  initialUsers: ManagedUser[]
  assignableRoles: AppRole[]
  currentUserId: string | null
}) {
  const router = useRouter()
  const [users, setUsers] = useState(initialUsers)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<AppRole>(assignableRoles[0])
  const [inviteFishbowlId, setInviteFishbowlId] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => router.refresh()

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          fishbowlUserId: inviteRole === 'sales_rep' ? inviteFishbowlId || null : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to invite user')
        return
      }
      toast.success(`Invite sent to ${inviteEmail}`)
      setInviteOpen(false)
      setInviteEmail('')
      setInviteFishbowlId('')
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const updateUser = async (id: string, patch: { role?: AppRole; isActive?: boolean }) => {
    setBusy(true)
    // Optimistic update; reconcile from the server afterward.
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Update failed')
        setUsers(initialUsers)
        return
      }
      toast.success('User updated')
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <span className="text-sm font-medium text-medship-dark">
          {users.length} {users.length === 1 ? 'user' : 'users'}
        </span>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlus className="mr-1.5 h-4 w-4" />
          Invite user
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last sign-in</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const isSuperadmin = user.role === 'superadmin'
            const isSelf = user.id === currentUserId
            const canManage = !isSuperadmin && !isSelf
            return (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="font-medium text-medship-dark">
                    {user.displayName ?? user.email.split('@')[0]}
                  </div>
                  <div className="text-xs text-medship-secondary">{user.email}</div>
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <select
                      value={user.role}
                      disabled={busy}
                      onChange={(e) => updateUser(user.id, { role: e.target.value as AppRole })}
                      className="rounded-md border border-border bg-white px-2 py-1 text-sm text-medship-dark"
                    >
                      {/* Keep the current role selectable even if not otherwise assignable. */}
                      {[...new Set([user.role, ...assignableRoles])].map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-sm text-medship-dark">{ROLE_LABELS[user.role]}</span>
                  )}
                </TableCell>
                <TableCell>
                  <span
                    className={
                      user.isActive
                        ? 'text-sm font-medium text-medship-green'
                        : 'text-sm font-medium text-medship-secondary'
                    }
                  >
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-medship-secondary">
                  {formatDate(user.lastSignInAt)}
                </TableCell>
                <TableCell className="text-right">
                  {canManage && (
                    <Button
                      size="sm"
                      variant={user.isActive ? 'outline' : 'default'}
                      disabled={busy}
                      onClick={() => updateUser(user.id, { isActive: !user.isActive })}
                    >
                      {user.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md p-6">
            <h2 className="mb-4 text-lg font-semibold text-medship-dark">Invite a user</h2>
            <form onSubmit={submitInvite} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-medship-dark">Email</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                  placeholder="name@example.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-medship-dark">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as AppRole)}
                  className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                >
                  {assignableRoles.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
              {inviteRole === 'sales_rep' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-medship-dark">
                    Fishbowl user ID
                    <span className="ml-1 font-normal text-medship-secondary">(optional)</span>
                  </label>
                  <input
                    value={inviteFishbowlId}
                    onChange={(e) => setInviteFishbowlId(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                    placeholder="Canonical rep identity"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Sending...' : 'Send invite'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </Card>
  )
}
