'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatDate, timeAgo } from '@/lib/utils'
import NavBar from '@/components/NavBar'
import type { User } from '@supabase/supabase-js'

interface Tenant {
  id: string
  name: string
  slug: string
  plan_id: string
  is_active: boolean
  created_at: string
}

interface Pagination {
  page: number
  total: number
  total_pages: number
}

export default function AdminTenantsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  // Create tenant modal
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [newPlan, setNewPlan] = useState('free')
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUser(user)
      checkAccess()
    })
  }, [])

  useEffect(() => {
    if (isSuperAdmin) fetchTenants()
  }, [isSuperAdmin, page, search])

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
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
      console.error('[Tenants] Failed to check access:', err)
      router.push('/dashboard')
    }
  }

  async function fetchTenants() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (search) params.set('search', search)

      const res = await fetch(`/api/proxy/v1/admin-portal/tenants?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTenants(data.tenants ?? [])
        setPagination(data.pagination ?? null)
      } else {
        setError('Failed to load tenants')
      }
    } catch (err) {
      console.error('[Tenants] Failed to fetch:', err)
      setError('Failed to connect')
    }
    setLoading(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateResult(null)
    setNewKey(null)

    try {
      const res = await fetch('/api/proxy/v1/admin-portal/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, slug: newSlug, plan_id: newPlan }),
      })
      const data = await res.json()
      if (res.ok) {
        setNewKey(data.api_key)
        setNewName('')
        setNewSlug('')
        setNewPlan('free')
        fetchTenants()
      } else {
        setCreateResult(data.error)
      }
    } catch {
      setCreateResult('Failed to create tenant')
    }
    setCreating(false)
  }

  if (!isSuperAdmin) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-gray-500">Checking access...</p></div>
  }

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">All Tenants</h2>
            {pagination && (
              <p className="text-sm text-gray-400 mt-1">{pagination.total} total tenants</p>
            )}
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-lg bg-gradient-to-r from-indigo-600 to-[#00E5D1] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Create Tenant
          </button>
        </div>

        {/* Create tenant form */}
        {showCreate && (
          <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
            <h3 className="mb-4 text-sm font-medium">Create a new tenant</h3>
            <form onSubmit={handleCreate} className="flex flex-wrap gap-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Tenant name"
                className="flex-1 min-w-[150px] rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                required
              />
              <input
                type="text"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value.replace(/[^a-z0-9-]/g, '').toLowerCase())}
                placeholder="slug"
                className="w-32 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                required
              />
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value)}
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="free">Free</option>
                <option value="indie">Indie</option>
                <option value="pro">Pro</option>
                <option value="business">Business</option>
              </select>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </form>
            {createResult && (
              <p className="mt-2 text-sm text-red-400">{createResult}</p>
            )}
            {newKey && (
              <div className="mt-3 rounded-lg border border-green-800 bg-green-900/20 p-3">
                <p className="text-xs font-medium text-green-400 mb-1">Tenant created! API key (shown once):</p>
                <code className="text-xs font-mono break-all text-green-300">{newKey}</code>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">{error}</div>
        )}

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by name or slug..."
            className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Tenants table */}
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className="px-4 py-3 text-left font-medium text-gray-400">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Slug</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Plan</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Created</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">Loading tenants...</td></tr>
              ) : tenants.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">No tenants found.</td></tr>
              ) : (
                tenants.map((t) => (
                  <tr key={t.id} className="border-b border-gray-800/50 transition-colors hover:bg-gray-900/50">
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{t.slug}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs capitalize">{t.plan_id}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block h-2 w-2 rounded-full ${t.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(t.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => router.push(`/tenants/${t.id}`)}
                        className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.total_pages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50">
              Previous
            </button>
            <span className="text-sm text-gray-500">Page {page} of {pagination.total_pages}</span>
            <button onClick={() => setPage(p => Math.min(pagination.total_pages, p + 1))}
              disabled={page >= pagination.total_pages}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50">
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
