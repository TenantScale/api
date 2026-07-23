'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
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
  price_monthly?: number
  features?: Record<string, unknown>
  max_users?: number | null
  api_calls_per_day?: number | null
}

interface UsageData {
  api_calls: number
  active_users: number
  plan_limits: { api_calls_per_day: number | null; max_users: number | null }
  overage_rates: { per_call: number | null; per_user: number | null }
  billing_period: { starts_at: string | null; ends_at: string | null; days_remaining: number | null }
  projected_overage: { api_calls_overage: number; seat_overage: number; total: number }
}

export default function BillingPage() {
  const [user, setUser] = useState<User | null>(null)
  const [data, setData] = useState<PortalData | null>(null)
  const [plans, setPlans] = useState<PlanTier[]>([])
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [plansLoading, setPlansLoading] = useState(true)
  const [usageLoading, setUsageLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upgrading, setUpgrading] = useState<string | null>(null)
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
        const d = await res.json()
        setData(d)
        fetchPlans()
        fetchUsage()
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
        setPlans(Array.isArray(body) ? body : (body.plans ?? []))
      }
    } catch (err) {
      console.error('[Billing] Failed to fetch plans:', err)
    }
    setPlansLoading(false)
  }

  async function fetchUsage() {
    setUsageLoading(true)
    try {
      const res = await fetch('/api/proxy/v1/portal/billing/usage')
      if (res.ok) {
        setUsage(await res.json())
      }
    } catch (err) {
      console.error('[Billing] Failed to fetch usage:', err)
    }
    setUsageLoading(false)
  }

  async function handleUpgrade(planId: string, billingInterval: string = 'month') {
    setUpgrading(planId)
    try {
      const res = await fetch('/api/proxy/v1/portal/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, billing_interval: billingInterval }),
      })
      if (res.ok) {
        const { url } = await res.json()
        if (url) {
          window.location.href = url
          return
        }
      }
      const body = await res.json()
      setError(body.error ?? 'Failed to start checkout')
    } catch {
      setError('Failed to connect to billing service')
    }
    setUpgrading(null)
  }

  function formatPrice(cents?: number) {
    if (cents === undefined || cents === null) return ''
    const fmt = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
    return fmt.format(cents / 100)
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
  const isOwner = data.user.role === 'owner'
  const hasUsageDashboard = data.tenant.features?.usage_dashboard === true
  const hasOverageApi = data.tenant.features?.overage_api_calls === true
  const hasOverageSeats = data.tenant.features?.overage_seats === true

  const dailyApiLimit = usage?.plan_limits.api_calls_per_day
  const monthlyApiEstimate = dailyApiLimit ? dailyApiLimit * 30 : null
  const apiPercent = dailyApiLimit
    ? Math.min(100, Math.round((usage?.api_calls ?? 0) / (dailyApiLimit * 30) * 100))
    : 0
  const userPercent = usage?.plan_limits.max_users
    ? Math.min(100, Math.round((usage?.active_users ?? 0) / usage.plan_limits.max_users * 100))
    : 0

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin={data?.user?.is_super_admin} />

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        {/* Page header */}
        <div>
          <h2 className="text-xl font-bold">Billing & Plan</h2>
          <p className="text-sm text-gray-400 mt-1">Manage your subscription and view usage</p>
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
              {isFreePlan ? 'Free' : 'Active'}
            </span>
          </div>
        </div>

        {/* Usage metrics */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* API calls */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">API Calls</p>
              {usageLoading && <span className="text-xs text-gray-500">...</span>}
            </div>
            <p className="mt-2 text-xl font-semibold">
              {usage?.api_calls?.toLocaleString() ?? '—'}
              {monthlyApiEstimate && (
                <span className="text-sm font-normal text-gray-500">
                  {' '}/ {monthlyApiEstimate.toLocaleString()} /mo
                </span>
              )}
            </p>
            {monthlyApiEstimate && usage && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                <div
                  className={`h-full rounded-full transition-all ${
                    apiPercent > 90 ? 'bg-red-500' : apiPercent > 70 ? 'bg-amber-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(apiPercent, 100)}%` }}
                />
              </div>
            )}
            {usage?.projected_overage.api_calls_overage ? (
              <p className="mt-1 text-xs text-amber-400">
                +${usage.projected_overage.api_calls_overage.toFixed(2)} overage projected
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                {dailyApiLimit ? `${dailyApiLimit.toLocaleString()} calls/day limit` : 'Unlimited'}
              </p>
            )}
          </div>

          {/* Active users */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Active Users</p>
              {usageLoading && <span className="text-xs text-gray-500">...</span>}
            </div>
            <p className="mt-2 text-xl font-semibold">
              {usage?.active_users ?? data.limits.current_users}
              {usage?.plan_limits.max_users && (
                <span className="text-sm font-normal text-gray-500">
                  {' '}/ {usage.plan_limits.max_users}
                </span>
              )}
            </p>
            {usage?.plan_limits.max_users && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                <div
                  className={`h-full rounded-full transition-all ${
                    userPercent > 90 ? 'bg-red-500' : userPercent > 70 ? 'bg-amber-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(userPercent, 100)}%` }}
                />
              </div>
            )}
            {usage?.projected_overage.seat_overage ? (
              <p className="mt-1 text-xs text-amber-400">
                +${usage.projected_overage.seat_overage.toFixed(2)} overage projected
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                {usage?.plan_limits.max_users ? `${usage.plan_limits.max_users} max` : 'Unlimited'}
              </p>
            )}
          </div>
        </div>

        {/* Billing period */}
        {usage?.billing_period.ends_at && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">
                Current billing period:{' '}
                {usage.billing_period.starts_at ? formatDate(usage.billing_period.starts_at) : '—'}
                {' → '}
                {formatDate(usage.billing_period.ends_at)}
              </span>
              {usage.billing_period.days_remaining !== null && (
                <span className="text-gray-500">
                  {usage.billing_period.days_remaining} days remaining
                </span>
              )}
            </div>
          </div>
        )}

        {/* Overage summary */}
        {usage?.projected_overage.total ? (
          <div className="rounded-xl border border-amber-900/50 bg-amber-900/10 p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-amber-300">Projected overage this period</span>
              <span className="text-lg font-bold text-amber-300">
                +${usage.projected_overage.total.toFixed(2)}
              </span>
            </div>
            <p className="mt-1 text-xs text-amber-400/70">
              API overage: ${usage.projected_overage.api_calls_overage.toFixed(2)}
              {usage.projected_overage.seat_overage > 0 && (
                <> · Seat overage: ${usage.projected_overage.seat_overage.toFixed(2)}</>
              )}
            </p>
          </div>
        ) : null}

        {/* Feature flags */}
        {Object.keys(data.tenant.features).length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">Plan Features</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(data.tenant.features).filter(([k]) => !k.startsWith('overage_')).map(([key, value]) => (
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

        {/* Available plans */}
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
                const upgradeTo = isCurrent ? null : plan.id
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
                      {plan.price_monthly ? (
                        <>{formatPrice(plan.price_monthly)}<span className="text-base font-normal text-gray-500">/mo</span></>
                      ) : (
                        <span className="text-base font-normal text-gray-500">Contact us</span>
                      )}
                    </p>

                    {plan.max_users && (
                      <p className="mt-2 text-xs text-gray-500">Up to {plan.max_users} users</p>
                    )}
                    {plan.api_calls_per_day && (
                      <p className="text-xs text-gray-500">{plan.api_calls_per_day.toLocaleString()} API calls/day</p>
                    )}

                    {!isCurrent && upgradeTo && isOwner && (
                      <div className="mt-4">
                        <button
                          onClick={() => handleUpgrade(upgradeTo)}
                          disabled={upgrading === upgradeTo}
                          className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-[#00E5D1] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {upgrading === upgradeTo ? 'Redirecting...' : 'Upgrade'}
                        </button>
                      </div>
                    )}

                    {!isCurrent && !isOwner && (
                      <p className="mt-4 text-xs text-gray-500 text-center">
                        Contact your tenant owner to upgrade
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Stripe billing portal */}
        {!isFreePlan && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium uppercase tracking-wider text-gray-500">Payment & Invoices</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Manage your payment method, view invoices, and update billing info.
                </p>
              </div>
              <button
                onClick={async () => {
                  const res = await fetch('/api/proxy/v1/portal/billing-portal', { method: 'POST' })
                  if (res.ok) {
                    const { url } = await res.json()
                    if (url) window.location.href = url
                  }
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Manage Billing
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
