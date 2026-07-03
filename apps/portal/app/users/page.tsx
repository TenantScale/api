'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { isTenantAdmin, roleBadgeColor, formatDate } from '@/lib/utils'
import NavBar from '@/components/NavBar'
import type { User } from '@supabase/supabase-js'

interface PortalUser {
  id: string
  user_id: string
  email: string
  role: string
  joined_at: string
  is_self: boolean
}

export default function UsersPage() {
  const [user, setUser] = useState<User | null>(null)
  const [users, setUsers] = useState<PortalUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite form
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // Role change
  const [changingRole, setChangingRole] = useState<string | null>(null)

  // Remove confirmation
  const [removing, setRemoving] = useState<string | null>(null)

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUser(user)
      fetchUsers()
    })
  }, [])

  async function fetchUsers() {
    try {
      const res = await fetch('/api/proxy/v1/portal/users')
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users ?? [])
      } else {
        setError('Failed to load users')
      }
    } catch (err) {
      console.error('[Users] Failed to fetch:', err)
      setError('Failed to connect')
    }
    setLoading(false)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteResult(null)

    try {
      const res = await fetch('/api/proxy/v1/portal/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      const data = await res.json()
      if (res.ok) {
        setInviteResult({ ok: true, msg: `${inviteEmail} invited as ${inviteRole}` })
        setInviteEmail('')
        setShowInvite(false)
        fetchUsers()
      } else {
        setInviteResult({ ok: false, msg: data.error })
      }
    } catch {
      setInviteResult({ ok: false, msg: 'Failed to send invite' })
    }
    setInviting(false)
  }

  async function handleRoleChange(membershipId: string, newRole: string) {
    setChangingRole(membershipId)
    try {
      const res = await fetch(`/api/proxy/v1/portal/users/${membershipId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      if (res.ok) fetchUsers()
    } catch (err) {
      console.error('[Users] Failed to change role:', err)
    }
    setChangingRole(null)
  }

  async function handleRemove(membershipId: string) {
    try {
      const res = await fetch(`/api/proxy/v1/portal/users/${membershipId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setRemoving(null)
        fetchUsers()
      }
    } catch (err) {
      console.error('[Users] Failed to remove:', err)
    }
  }

  const currentUser = users.find(u => u.is_self)
  const isAdmin = isTenantAdmin(currentUser?.role)

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-gray-500">Loading users...</p></div>
  }

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin={false} />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">Team Members</h2>
            <p className="text-sm text-gray-400 mt-1">{users.length} user{users.length !== 1 ? 's' : ''}</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowInvite(!showInvite)}
              className="rounded-lg bg-gradient-to-r from-indigo-600 to-[#00E5D1] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Invite User
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">{error}</div>
        )}

        {/* Invite form */}
        {showInvite && isAdmin && (
          <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
            <h3 className="mb-4 text-sm font-medium">Invite a team member</h3>
            <form onSubmit={handleInvite} className="flex flex-wrap gap-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="flex-1 min-w-[200px] rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={inviting}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {inviting ? 'Inviting...' : 'Send Invite'}
              </button>
            </form>
            {inviteResult && (
              <p className={`mt-3 text-sm ${inviteResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                {inviteResult.msg}
              </p>
            )}
          </div>
        )}

        {/* Users table */}
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className="px-4 py-3 text-left font-medium text-gray-400">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Role</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Joined</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-gray-500">
                    No users yet. Invite your first team member.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-800/50 transition-colors hover:bg-gray-900/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span>{u.email}</span>
                        {u.is_self && (
                          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">you</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin && !u.is_self && u.role !== 'owner' ? (
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          disabled={changingRole === u.id}
                          className={`rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none ${roleBadgeColor(u.role)}`}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      ) : (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs ${roleBadgeColor(u.role)}`}>
                          {u.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(u.joined_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && !u.is_self && u.role !== 'owner' && (
                        <>
                          {removing === u.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs text-red-400">Remove?</span>
                              <button onClick={() => handleRemove(u.id)}
                                className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700">Yes</button>
                              <button onClick={() => setRemoving(null)}
                                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600">No</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setRemoving(u.id)}
                              className="text-xs text-red-400 hover:text-red-300"
                            >
                              Remove
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
