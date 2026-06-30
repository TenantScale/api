'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import type { User } from '@supabase/supabase-js'

interface Tenant {
  id: string
  name: string
  slug: string
  plan_id: string
  is_active: boolean
  created_at: string
}

export default function TenantsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const router = useRouter()
  const supabase = createClient()

  // TODO: Extract auth check + redirect into shared hook or HOC.
  // This pattern is repeated across every page.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)
      fetchTenants()
    })
  }, [])

  async function fetchTenants() {
    try {
      // Uses server-side proxy route so the admin key stays server-only
      const res = await fetch('/api/proxy/v1/tenants')
      if (res.ok) {
        const data = await res.json()
        setTenants(data.tenants ?? [])
      } else {
        console.error('[Admin Tenants] Failed to fetch tenants:', res.status)
      }
    } catch (err) {
      console.error('[Admin Tenants] Failed to fetch tenants:', err)
    }
    setLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const filtered = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">TenantScale Admin</h1>
            <nav className="flex gap-4 text-sm ml-6">
              <span className="text-blue-400 font-medium">Tenants</span>
              <Link href="/plans" className="text-gray-400 hover:text-gray-200">Plans</Link>
            </nav>
            <span className="rounded-md bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
              {tenants.length} tenants
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{user?.email}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-300"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tenants by name or slug..."
            className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Tenant Table */}
        {loading ? (
          <div className="text-center text-sm text-gray-500 py-12">Loading tenants...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-12">
            {tenants.length === 0 ? 'No tenants yet. Create one to get started.' : 'No tenants match your search.'}
          </div>
        ) : (
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
                {filtered.map((tenant) => (
                  <tr
                    key={tenant.id}
                    className="border-b border-gray-800/50 transition-colors hover:bg-gray-900/50"
                  >
                    <td className="px-4 py-3 font-medium">{tenant.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{tenant.slug}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs capitalize">
                        {tenant.plan_id}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          tenant.is_active ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(tenant.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => router.push(`/tenants/${tenant.id}`)}
                        className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
