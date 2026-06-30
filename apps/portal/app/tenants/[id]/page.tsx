'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatDate, roleBadgeColor, timeAgo } from '@/lib/utils'
import NavBar from '@/components/NavBar'
import type { User } from '@supabase/supabase-js'

interface TenantDetail {
  id: string; name: string; slug: string; plan_id: string
  is_active: boolean; created_at: string; updated_at: string
  features: Record<string, unknown>; config: Record<string, unknown>
  settings: Record<string, unknown>; metadata: Record<string, unknown>
  stats: { users: number; api_keys: number }
}

interface TenantUser {
  id: string; user_id: string; email: string; role: string; joined_at: string
}

export default function TenantDetailPage() {
  const params = useParams()
  const router = useRouter()
  const supabase = createClient()
  const tenantId = params.id as string

  const [user, setUser] = useState<User | null>(null)
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [tab, setTab] = useState<'overview' | 'users'>('overview')

  // Impersonation
  const [impersonating, setImpersonating] = useState(false)
  const [impersonateResult, setImpersonateResult] = useState<string | null>(null)

  // Toggle active
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUser(user)
      checkAccess()
    })
  }, [])

  async function checkAccess() {
    try {
      const res = await fetch('/api/proxy/v1/portal/me')
      if (res.ok) {
        const data = await res.json()
        if (!data.user?.is_super_admin) {
          router.push('/dashboard')
          return
        }
        setIsSuperAdmin(true)
        fetchTenant()
        fetchUsers()
      } else {
        router.push('/dashboard')
      }
    } catch {
      router.push('/dashboard')
    }
  }

  async function fetchTenant() {
    try {
      const res = await fetch(`/api/proxy/v1/admin-portal/tenants/${tenantId}`)
      if (res.ok) {
        setTenant(await res.json())
      } else {
        setError('Tenant not found')
      }
    } catch { setError('Failed to load tenant') }
    setLoading(false)
  }

  async function fetchUsers() {
    try {
      const res = await fetch(`/api/proxy/v1/admin-portal/tenants/${tenantId}/users`)
      if (res.ok) {
        const data = await res.json()
        setTenantUsers(data.users ?? [])
      }
    } catch (err) {
      console.error('[Tenant] Failed to fetch users:', err)
    }
  }

  async function handleImpersonate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setImpersonating(true)
    setImpersonateResult(null)

    const formData = new FormData(e.currentTarget)
    const targetUserId = formData.get('user_id') as string

    try {
      const res = await fetch('/api/proxy/v1/admin-portal/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_user_id: targetUserId,
          target_tenant_id: tenantId,
          expires_in_minutes: 15,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setImpersonateResult(`Token created: ${data.token.slice(0, 12)}...`)
      } else {
        const err = await res.json()
        setImpersonateResult(`Error: ${err.error}`)
      }
    } catch (err) {
      console.error('[Tenant] Failed to impersonate:', err)
      setImpersonateResult('Failed to create impersonation session')
    }
    setImpersonating(false)
  }

  async function handleToggleActive() {
    if (!tenant) return
    setToggling(true)
    try {
      const res = await fetch(`/api/proxy/v1/admin-portal/tenants/${tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !tenant.is_active }),
      })
      if (res.ok) {
        fetchTenant()
      }
    } catch (err) {
      console.error('[Tenant] Failed to toggle:', err)
    }
    setToggling(false)
  }

  if (!isSuperAdmin) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-gray-500">Checking access...</p></div>
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-gray-500">Loading tenant...</p></div>
  }

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin />

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error ? (
          <div className="rounded-xl border border-red-800 bg-red-900/20 p-8 text-center">
            <p className="text-red-400">{error}</p>
            <button onClick={() => router.push('/tenants')} className="mt-4 text-sm text-gray-400 hover:text-gray-200">
              &larr; Back to tenants
            </button>
          </div>
        ) : tenant ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <button onClick={() => router.push('/tenants')} className="text-sm text-gray-400 hover:text-gray-200">
                  ← Tenants
                </button>
                <h2 className="text-xl font-bold">{tenant.name}</h2>
                <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs capitalize">{tenant.plan_id}</span>
                <span className={`inline-block h-2 w-2 rounded-full ${tenant.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
              </div>
              <button
                onClick={handleToggleActive}
                disabled={toggling}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  tenant.is_active
                    ? 'border border-red-700 text-red-400 hover:bg-red-900/20'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {tenant.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>

            {/* Stats cards */}
            <div className="grid gap-4 sm:grid-cols-4 mb-8">
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                <p className="text-xs uppercase tracking-wider text-gray-500">Users</p>
                <p className="mt-1 text-2xl font-semibold">{tenant.stats.users}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                <p className="text-xs uppercase tracking-wider text-gray-500">API Keys</p>
                <p className="mt-1 text-2xl font-semibold">{tenant.stats.api_keys}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                <p className="text-xs uppercase tracking-wider text-gray-500">Created</p>
                <p className="mt-1 text-sm font-semibold">{formatDate(tenant.created_at)}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                <p className="text-xs uppercase tracking-wider text-gray-500">Slug</p>
                <p className="mt-1 text-sm font-mono font-semibold">{tenant.slug}</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 border-b border-gray-800 mb-6">
              {(['overview', 'users'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`border-b-2 px-1 py-3 text-sm font-medium capitalize transition-colors ${
                    tab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}>{t}</button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="rounded-xl border border-gray-800 p-6">
                  <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">Details</h3>
                  <dl className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-gray-400">ID</dt>
                      <dd className="font-mono text-xs">{tenant.id}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-400">Plan</dt>
                      <dd className="capitalize">{tenant.plan_id}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-400">Active</dt>
                      <dd>{tenant.is_active ? 'Yes' : 'No'}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-400">Updated</dt>
                      <dd>{formatDate(tenant.updated_at)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-gray-800 p-6">
                  <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">Impersonation</h3>
                  <form onSubmit={handleImpersonate} className="space-y-3">
                    <div>
                      <label htmlFor="user_id" className="block text-sm text-gray-400">Target User ID</label>
                      <input type="text" name="user_id" id="user_id"
                        placeholder="uuid of user to impersonate"
                        className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                        required />
                    </div>
                    <button type="submit" disabled={impersonating}
                      className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                      {impersonating ? 'Creating...' : 'Impersonate User'}
                    </button>
                    {impersonateResult && <p className="text-xs text-gray-400">{impersonateResult}</p>}
                  </form>
                </div>
              </div>
            )}

            {tab === 'users' && (
              <div className="rounded-xl border border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900/50">
                      <th className="px-4 py-3 text-left font-medium text-gray-400">Email</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-400">Role</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-400">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenantUsers.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-500">No users in this tenant.</td></tr>
                    ) : (
                      tenantUsers.map((tu) => (
                        <tr key={tu.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                          <td className="px-4 py-3">{tu.email}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2.5 py-0.5 text-xs ${roleBadgeColor(tu.role)}`}>{tu.role}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-400">{formatDate(tu.joined_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  )
}
