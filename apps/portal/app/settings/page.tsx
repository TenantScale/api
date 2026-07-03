'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import NavBar from '@/components/NavBar'
import type { User } from '@supabase/supabase-js'

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; msg: string } | null>(null)

  // Tenant data
  const [tenantName, setTenantName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [planName, setPlanName] = useState('')
  const [createdAt, setCreatedAt] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [myRole, setMyRole] = useState('')
  const [userId, setUserId] = useState('')

  // Leave/transfer
  const [showLeave, setShowLeave] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [transferEmail, setTransferEmail] = useState('')
  const [transferring, setTransferring] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUser(user)
      setUserId(user.id)
      fetchSettings()
    })
  }, [])

  async function fetchSettings() {
    try {
      const res = await fetch('/api/proxy/v1/portal/me')
      if (res.ok) {
        const data = await res.json()
        setTenantName(data.tenant.name)
        setTenantSlug(data.tenant.slug)
        setPlanName(data.tenant.plan_name)
        setCreatedAt(data.tenant.created_at)
        setTenantId(data.tenant.id)
        setMyRole(data.user.role)
      }
    } catch (err) {
      console.error('[Settings] Failed to fetch:', err)
    }
    setLoading(false)
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/proxy/v1/portal/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tenantName }),
      })
      if (res.ok) {
        setMessage({ ok: true, msg: 'Settings saved successfully' })
      } else {
        const data = await res.json()
        setMessage({ ok: false, msg: data.error })
      }
    } catch {
      setMessage({ ok: false, msg: 'Failed to save settings' })
    }
    setSaving(false)
  }

  async function handleLeave() {
    try {
      const res = await fetch('/api/proxy/v1/portal/leave', { method: 'POST' })
      if (res.ok) {
        await supabase.auth.signOut()
        router.push('/login')
      } else {
        const data = await res.json()
        setMessage({ ok: false, msg: data.error })
      }
    } catch {
      setMessage({ ok: false, msg: 'Failed to leave tenant' })
    }
  }

  async function handleTransferOwnership(e: React.FormEvent) {
    e.preventDefault()
    setTransferring(true)
    setMessage(null)

    try {
      // First find the user by email from the users list
      const usersRes = await fetch('/api/proxy/v1/portal/users')
      if (!usersRes.ok) throw new Error('Failed to fetch users')
      const { users } = await usersRes.json()
      const target = users.find((u: { email: string }) => u.email === transferEmail)
      if (!target) {
        setMessage({ ok: false, msg: 'User not found with that email' })
        setTransferring(false)
        return
      }

      const res = await fetch('/api/proxy/v1/portal/transfer-ownership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_owner_user_id: target.user_id }),
      })
      if (res.ok) {
        setMessage({ ok: true, msg: `Ownership transferred to ${transferEmail}. You are now an admin.` })
        setShowTransfer(false)
        setMyRole('admin')
      } else {
        const data = await res.json()
        setMessage({ ok: false, msg: data.error })
      }
    } catch {
      setMessage({ ok: false, msg: 'Failed to transfer ownership' })
    }
    setTransferring(false)
  }

  const isOwner = myRole === 'owner'
  const canManage = ['owner', 'admin'].includes(myRole)

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-gray-500">Loading settings...</p></div>
  }

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin={false} />

      <main className="mx-auto max-w-3xl space-y-8 px-6 py-8">
        <h2 className="text-xl font-bold">Tenant Settings</h2>

        {message && (
          <div className={`rounded-lg border p-4 text-sm ${message.ok ? 'border-green-800 bg-green-900/20 text-green-400' : 'border-red-800 bg-red-900/20 text-red-400'}`}>
            {message.msg}
          </div>
        )}

        {/* General settings */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">General</h3>
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Tenant Name</label>
              <input
                type="text"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                disabled={!canManage}
                className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Slug</label>
              <input
                type="text"
                value={tenantSlug}
                disabled
                className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-gray-600">Slug cannot be changed after creation</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Plan</label>
              <input
                type="text"
                value={planName}
                disabled
                className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Tenant ID</label>
              <input
                type="text"
                value={tenantId}
                disabled
                className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2 text-sm font-mono text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Created</label>
              <input
                type="text"
                value={formatDate(createdAt)}
                disabled
                className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
              />
            </div>
            {canManage && (
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-[#00E5D1] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </form>
        </div>

        {/* Danger zone */}
        <div className="rounded-xl border border-red-900/50 bg-red-900/10 p-6 backdrop-blur">
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-red-400">Danger Zone</h3>

          {isOwner && (
            <div className="space-y-4">
              {/* Transfer ownership */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Transfer ownership</p>
                  <p className="text-xs text-gray-500 mt-0.5">Give another user full control of this tenant</p>
                </div>
                <button
                  onClick={() => setShowTransfer(!showTransfer)}
                  className="rounded-lg border border-amber-700 px-4 py-2 text-sm text-amber-400 hover:bg-amber-900/20"
                >
                  Transfer
                </button>
              </div>

              {showTransfer && (
                <form onSubmit={handleTransferOwnership} className="flex gap-3">
                  <input
                    type="email"
                    value={transferEmail}
                    onChange={(e) => setTransferEmail(e.target.value)}
                    placeholder="Email of new owner"
                    className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:border-amber-500 focus:outline-none"
                    required
                  />
                  <button
                    type="submit"
                    disabled={transferring}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {transferring ? 'Transferring...' : 'Confirm'}
                  </button>
                </form>
              )}
            </div>
          )}

          {!isOwner && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Leave tenant</p>
                <p className="text-xs text-gray-500 mt-0.5">Remove yourself from this tenant</p>
              </div>
              {showLeave ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-400">Are you sure?</span>
                  <button onClick={handleLeave} className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700">Yes, leave</button>
                  <button onClick={() => setShowLeave(false)} className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setShowLeave(true)}
                  className="rounded-lg border border-red-700 px-4 py-2 text-sm text-red-400 hover:bg-red-900/20">
                  Leave
                </button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
