'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatDate, timeAgo } from '@/lib/utils'
import NavBar from '@/components/NavBar'
import type { User } from '@supabase/supabase-js'

interface PortalData {
  user: { id: string; email: string; role: string; is_super_admin: boolean }
  tenant: {
    id: string; name: string; slug: string; plan: string; plan_name: string
    description?: string; price?: number; currency?: string; interval?: string
    features: Record<string, unknown>; settings: Record<string, unknown>
    config: Record<string, unknown>; created_at: string
  }
  limits: { max_users: number | null; current_users: number }
}

interface PlanTier {
  id: string
  name: string
  description?: string
  price?: number
  currency?: string
  interval?: string
  features?: Record<string, unknown>
}

export default function BillingPage() {
  const [user, setUser] = useState<User | null>(null)
  const [data, setData] = useState<PortalData | null>(null)
  const [plans, setPlans] = useState<PlanTier[]>([])
  const [loading, setLoading] = useState(true)
  const [plansLoading, setPlansLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)
      fetchPortalData()
    })
  }, [])

  async function fetchPortalData() {
    try {
      const res = await fetch('/api/proxy/v1/portal/me')
      if (res.ok) {
        setData(await res.json())
        fetchPlans()
      } else if (res.status === 403) {
        setError("You don't have access to any tenant. Ask your admin to add you.")
      } else {
        setError('Failed to load billing info')
      }
    } catch {
      setError('Failed to connect to API')
    }
    setLoading(false)
  }

  async function fetchPlans() {
    setPlansLoading(true)
    try {
      const res = await fetch('/api/proxy/v1/plans')
      if (res.ok) {
        const body = await res.json()
        // Handle both { plans: [...] } and direct array responses
        setPlans(Array.isArray(body) ? body : (body.plans ?? []))
      }
    } catch (err) {
      console.error('[Billing] Failed to fetch plans:', err)
      // Plans are supplemental — don't surface an error for this
    }
    setPlansLoading(false)
  }

  function formatPrice(price?: number, currency?: string, interval?: string) {
    if (price === undefined || price === null) return ''
    const fmt = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
    const label = fmt.format(price)
    return interval ? `${label}/${interval}` : label
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading billing...</p>
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
          <button
            onClick={() => supabase.auth.signOut().then(() => router.push('/login'))}
            className="mt-4 text-sm text-gray-400 hover:text-gray-200"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const isFreePlan = data.tenant.plan === 'free' || data.tenant.plan_name?.toLowerCase() === 'free'
  const userPercent = data.limits.max_users
    ? Math.round((data.limits.current_users / data.limits.max_users) * 100)
    : 0

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin={data?.user?.is_super_admin} />

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        {/* Page header */}
        <div>
          <h2 className="text-xl font-bold">Billing & Plan</h2>
          <p className="text-sm text-gray-400 mt-1">Manage your subscription and view available plans</p>
        </div>

        {/* Current plan card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Current Plan</p>
              <h3 className="mt-2 text-2xl font-bold">{data.tenant.plan_name}</h3>
              {data.tenant.description && (
                <p className="mt-1 text-sm text-gray-400">{data.tenant.description}</p>
              )}
            </div>
            <span className="rounded-full bg-indigo-900/40 px-3 py-1 text-xs font-medium text-indigo-300">
              Active
            </span>
          </div>
        </div>

        {/* Usage & Limits */}
        <div className="grid gap-4 sm:grid-cols-2">
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
            {!data.limits.max_users && (
              <p className="mt-1 text-xs text-gray-500">Unlimited users</p>
            )}
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Created</p>
            <p className="mt-2 text-xl font-semibold">{formatDate(data.tenant.created_at)}</p>
          </div>
        </div>

        {/* Feature flags */}
        {Object.keys(data.tenant.features).length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">Plan Features</h3>
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
                    {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* View plans — all available tiers */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">Available Plans</h3>

          {plansLoading && (
            <p className="text-sm text-gray-500">Loading plans...</p>
          )}

          {!plansLoading && plans.length === 0 && (
            <p className="text-sm text-gray-500">No additional plans available at this time.</p>
          )}

          {!plansLoading && plans.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => {
                const isCurrent = plan.id === data.tenant.plan || plan.name === data.tenant.plan_name
                return (
                  <div
                    key={plan.id}
                    className={`relative rounded-xl border p-5 transition-colors ${
                      isCurrent
                        ? 'border-indigo-700 bg-indigo-900/10'
                        : 'border-gray-700 bg-gray-900/30 hover:border-gray-600'
                    }`}
                  >
                    {isCurrent && (
                      <span className="absolute -top-2.5 right-3 rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
                        Current
                      </span>
                    )}
                    <h4 className="text-lg font-semibold">{plan.name}</h4>
                    {plan.description && (
                      <p className="mt-1 text-sm text-gray-400">{plan.description}</p>
                    )}
                    <p className="mt-3 text-2xl font-bold">
                      {formatPrice(plan.price, plan.currency, plan.interval) || (
                        <span className="text-base font-normal text-gray-500">Contact us</span>
                      )}
                    </p>

                    {plan.features && Object.keys(plan.features).length > 0 && (
                      <ul className="mt-4 space-y-1.5">
                        {Object.entries(plan.features).map(([k, v]) => (
                          <li key={k} className="flex items-center gap-1.5 text-xs text-gray-400">
                            {v ? (
                              <svg className="h-3 w-3 flex-shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="h-3 w-3 flex-shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            )}
                            {k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                          </li>
                        ))}
                      </ul>
                    )}

                    {!isCurrent && (
                      <div className="mt-4">
                        {isFreePlan ? (
                          <button
                            disabled
                            title="Upgrade to Pro — Coming in Phase 2"
                            className="w-full rounded-lg bg-gradient-to-r from-indigo-600/50 to-[#00E5D1]/50 px-4 py-2 text-sm font-medium text-white/50 cursor-not-allowed"
                          >
                            Upgrade to Pro — Coming in Phase 2
                          </button>
                        ) : (
                          <button
                            disabled
                            className="w-full rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-500 cursor-not-allowed"
                          >
                            Contact Sales
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Stripe Bridge placeholder */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium uppercase tracking-wider text-gray-500">Payment Method</h3>
              <p className="mt-1 text-sm text-gray-400">
                Stripe Bridge integration is coming soon. You'll be able to manage your payment method and invoices here.
              </p>
            </div>
            <span className="rounded-full bg-amber-900/40 px-3 py-1 text-xs font-medium text-amber-300">
              Phase 2
            </span>
          </div>
        </div>
      </main>
    </div>
  )
}
