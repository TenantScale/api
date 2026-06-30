'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatDate, humanizeKey, isTenantAdmin } from '@/lib/utils'
import NavBar from '@/components/NavBar'
import type { User } from '@supabase/supabase-js'

interface PortalData {
  user: { id: string; email: string; role: string; is_super_admin: boolean }
  tenant: {
    id: string; name: string; slug: string; plan: string; plan_name: string
    features: Record<string, unknown>; settings: Record<string, unknown>
    config: Record<string, unknown>; created_at: string
  }
  limits: { max_users: number | null; current_users: number }
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null)
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
      fetchDashboard()
    })
  }, [])

  async function fetchDashboard() {
    try {
      const res = await fetch('/api/proxy/v1/portal/me')
      if (res.ok) {
        setData(await res.json())
      } else if (res.status === 403) {
        setError('You don\'t have access to any tenant. Ask your admin to add you.')
      } else {
        setError('Failed to load dashboard')
      }
    } catch (err) {
      console.error('[Dashboard] Failed to fetch:', err)
      setError('Failed to connect to API')
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading dashboard...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center backdrop-blur">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-900/50">
            <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-semibold">{error}</h2>
          <button onClick={() => supabase.auth.signOut().then(() => router.push('/login'))}
            className="mt-4 text-sm text-gray-400 hover:text-gray-200">
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const isAdmin = isTenantAdmin(data.user.role)
  const userPercent = data.limits.max_users
    ? Math.round((data.limits.current_users / data.limits.max_users) * 100)
    : 0

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin={data?.user?.is_super_admin} />

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        {/* Welcome + Plan */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">
              {data.tenant.name}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {data.tenant.plan_name} plan &middot; <span className="font-mono">{data.tenant.slug}</span>
            </p>
          </div>
          <span className="rounded-full bg-gray-800 px-3 py-1 text-xs capitalize text-gray-300">
            {data.user.role}
          </span>
        </div>

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Plan</p>
            <p className="mt-2 text-xl font-semibold">{data.tenant.plan_name}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Users</p>
            <p className="mt-2 text-xl font-semibold">
              {data.limits.current_users}
              {data.limits.max_users && (
                <span className="text-sm font-normal text-gray-500"> / {data.limits.max_users}</span>
              )}
            </p>
            {data.limits.max_users && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                <div
                  className={`h-full rounded-full transition-all ${
                    userPercent > 90 ? 'bg-red-500' : userPercent > 70 ? 'bg-amber-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(userPercent, 100)}%` }}
                />
              </div>
            )}
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Created</p>
            <p className="mt-2 text-xl font-semibold">{formatDate(data.tenant.created_at)}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Role</p>
            <p className="mt-2 text-xl font-semibold capitalize">{data.user.role}</p>
          </div>
        </div>

        {/* Quick actions */}
        {isAdmin && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">Quick Actions</h3>
            <div className="flex flex-wrap gap-3">
              <a
                href="/users"
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-[#00E5D1] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Invite Users
              </a>
              <a
                href="/api-keys"
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800"
              >
                Manage API Keys
              </a>
              <a
                href="/settings"
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800"
              >
                Tenant Settings
              </a>
            </div>
          </div>
        )}

        {/* Feature list */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">
            Plan Features
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(data.tenant.features).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 text-sm">
                {value ? (
                  <svg className="h-4 w-4 flex-shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 flex-shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                <span className={value ? 'text-gray-300' : 'text-gray-600'}>
                  {humanizeKey(key)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
