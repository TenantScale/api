'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import type { User } from '@supabase/supabase-js'

interface TenantDetail {
  id: string
  name: string
  slug: string
  plan_id: string
  features: Record<string, unknown>
  config: Record<string, unknown>
  settings: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
}

interface TenantUser {
  id: string
  user_id: string
  role: string
  joined_at: string
}

interface AuditEvent {
  id: string
  action: string
  resource: string
  details: Record<string, unknown>
  actor_type: string
  created_at: string
}

export default function TenantDetailPage() {
  const params = useParams()
  const router = useRouter()
  const supabase = createClient()
  const tenantId = params.id as string

  const [user, setUser] = useState<User | null>(null)
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  const [users, setUsers] = useState<TenantUser[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [impersonating, setImpersonating] = useState(false)
  const [impersonateResult, setImpersonateResult] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'users' | 'audit'>('overview')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)
      fetchDetails()
    })
  }, [])

  async function fetchDetails() {
    try {
      // Use server-side proxy to keep admin key secure
      const basePath = '/api/proxy/v1'

      // Fetch tenant
      const tenantRes = await fetch(`${basePath}/tenants/${tenantId}`)
      if (tenantRes.ok) {
        setTenant(await tenantRes.json())
      } else {
        console.error('[Admin Tenant Detail] Failed to fetch tenant:', tenantRes.status)
      }

      // Fetch audit events
      const auditRes = await fetch(`${basePath}/admin/audit?tenant_id=${tenantId}&limit=20`)
      if (auditRes.ok) {
        const data = await auditRes.json()
        setAuditEvents(data.events ?? [])
      } else {
        console.error('[Admin Tenant Detail] Failed to fetch audit:', auditRes.status)
      }

      setLoading(false)
    } catch (err) {
      console.error('[Admin Tenant Detail] Failed to fetch details:', err)
      setLoading(false)
    }
  }

  async function handleImpersonate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setImpersonating(true)
    setImpersonateResult(null)

    const formData = new FormData(e.currentTarget)
    const targetUserId = formData.get('user_id') as string

    try {
      const res = await fetch('/api/proxy/v1/admin/impersonate', {
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
        setImpersonateResult(
          `Impersonation session created! Token: ${data.token.slice(0, 12)}...`
        )
      } else {
        const err = await res.json()
        setImpersonateResult(`Error: ${err.error}`)
      }
    } catch (err) {
      console.error('[Admin Tenant Detail] Failed to impersonate:', err)
      setImpersonateResult('Failed to create impersonation session')
    } finally {
      setImpersonating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    )
  }

  if (!tenant) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-red-400">Tenant not found</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/tenants')}
              className="text-sm text-gray-400 hover:text-gray-200"
            >
              &larr; Back
            </button>
            <h1 className="text-lg font-semibold">{tenant.name}</h1>
            <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs capitalize">
              {tenant.plan_id}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        {/* Tab Bar */}
        <div className="flex gap-4 border-b border-gray-800">
          {(['overview', 'users', 'audit'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-1 py-3 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {tab === 'overview' && (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-gray-800 p-6">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">
                Tenant Info
              </h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-400">ID</dt>
                  <dd className="font-mono text-xs">{tenant.id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Slug</dt>
                  <dd className="font-mono text-xs">{tenant.slug}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Plan</dt>
                  <dd className="capitalize">{tenant.plan_id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Status</dt>
                  <dd>
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        tenant.is_active ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Created</dt>
                  <dd>{formatDate(tenant.created_at)}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-gray-800 p-6">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">
                Impersonation
              </h2>
              <form onSubmit={handleImpersonate} className="space-y-3">
                <div>
                  <label htmlFor="user_id" className="block text-sm text-gray-400">
                    Target User ID
                  </label>
                  <input
                    type="text"
                    name="user_id"
                    id="user_id"
                    placeholder="uuid of user to impersonate"
                    className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={impersonating}
                  className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {impersonating ? 'Creating...' : 'Impersonate User'}
                </button>
                {impersonateResult && (
                  <p className="text-xs text-gray-400">{impersonateResult}</p>
                )}
              </form>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {tab === 'users' && (
          <div className="rounded-xl border border-gray-800">
            <div className="p-6">
              <p className="text-sm text-gray-500">
                Users for this tenant. Connect to your database directly or use the API to manage users.
              </p>
            </div>
            {/* User list would go here — populated from tenant_users join */}
          </div>
        )}

        {/* Audit Tab */}
        {tab === 'audit' && (
          <div className="rounded-xl border border-gray-800">
            {auditEvents.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No audit events yet.</div>
            ) : (
              <div className="divide-y divide-gray-800">
                {auditEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-4 p-4">
                    <div className="mt-0.5">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          event.actor_type === 'admin_impersonation'
                            ? 'bg-amber-500'
                            : 'bg-blue-500'
                        }`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{event.action}</span>
                        <span className="text-xs text-gray-500">{event.resource}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {formatDate(event.created_at)}
                        {event.actor_type === 'admin_impersonation' && (
                          <span className="ml-2 rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-400">
                            impersonation
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
