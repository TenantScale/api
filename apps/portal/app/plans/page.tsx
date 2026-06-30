'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import NavBar from '@/components/NavBar'
import type { User } from '@supabase/supabase-js'

interface Plan {
  id: string
  name: string
  description: string
  price_monthly: number
  features: Record<string, unknown>
  max_users: number | null
  sort_order: number
}

export default function AdminPlansPage() {
  const [user, setUser] = useState<User | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [editingPlan, setEditingPlan] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ id: string; type: 'success' | 'error'; text: string } | null>(null)

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: '', description: '', price_monthly: 0, max_users: 0, allow_null: false,
    features: '{}',
  })

  const router = useRouter()
  const supabase = createClient()

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
        fetchPlans()
      } else {
        router.push('/dashboard')
      }
    } catch {
      router.push('/dashboard')
    }
  }

  async function fetchPlans() {
    try {
      const res = await fetch('/api/proxy/v1/admin-portal/plans')
      if (res.ok) {
        const data = await res.json()
        setPlans(data.plans ?? [])
      }
    } catch (err) {
      console.error('[Plans] Failed to fetch:', err)
    }
    setLoading(false)
  }

  function startEdit(plan: Plan) {
    setEditingPlan(plan.id)
    setEditForm({
      name: plan.name,
      description: plan.description ?? '',
      price_monthly: plan.price_monthly,
      max_users: plan.max_users ?? 0,
      allow_null: plan.max_users === null,
      features: JSON.stringify(plan.features, null, 2),
    })
  }

  async function handleSave(planId: string) {
    setSaving(true)
    try {
      let features: Record<string, unknown>
      try { features = JSON.parse(editForm.features) } catch {
        setSaveMsg({ id: planId, type: 'error', text: 'Invalid JSON in features field' })
        setSaving(false)
        return
      }

      const body: Record<string, unknown> = {
        name: editForm.name,
        description: editForm.description,
        price_monthly: editForm.price_monthly,
        max_users: editForm.allow_null ? null : editForm.max_users,
        features,
      }

      const res = await fetch(`/api/proxy/v1/admin-portal/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setEditingPlan(null)
        fetchPlans()
      }
    } catch (err) {
      console.error('[Plans] Failed to save:', err)
    }
    setSaving(false)
  }

  function formatPrice(cents: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(cents / 100)
  }

  if (!isSuperAdmin) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-gray-500">Checking access...</p></div>
  }

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold">Plan Management</h2>
          <p className="text-sm text-gray-400 mt-1">Edit plan tiers, pricing, and feature flags</p>
        </div>

        <div className="grid gap-6">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
              {editingPlan === plan.id ? (
                /* Edit mode */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">Editing {plan.id}</h3>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingPlan(null)}
                        className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">
                        Cancel
                      </button>
                      <button onClick={() => handleSave(plan.id)} disabled={saving}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-50">
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>

                  {saveMsg && saveMsg.id === plan.id && (
                    <p className={`text-xs ${saveMsg.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                      {saveMsg.text}
                    </p>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Name</label>
                      <input type="text" value={editForm.name}
                        onChange={e => setEditForm({...editForm, name: e.target.value})}
                        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Description</label>
                      <input type="text" value={editForm.description}
                        onChange={e => setEditForm({...editForm, description: e.target.value})}
                        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Price (cents/month)</label>
                      <input type="number" value={editForm.price_monthly}
                        onChange={e => setEditForm({...editForm, price_monthly: parseInt(e.target.value) || 0})}
                        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Max Users</label>
                      <div className="flex items-center gap-2">
                        <input type="number" value={editForm.max_users}
                          onChange={e => setEditForm({...editForm, max_users: parseInt(e.target.value) || 0})}
                          disabled={editForm.allow_null}
                          className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50" />
                        <label className="flex items-center gap-1.5 text-xs text-gray-400">
                          <input type="checkbox" checked={editForm.allow_null}
                            onChange={e => setEditForm({...editForm, allow_null: e.target.checked})}
                            className="rounded border-gray-600" />
                          Unlimited
                        </label>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Features (JSON)</label>
                    <textarea value={editForm.features}
                      onChange={e => setEditForm({...editForm, features: e.target.value})}
                      rows={6}
                      className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
              ) : (
                /* View mode */
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-lg">{plan.name}</h3>
                      <p className="text-sm text-gray-400">{plan.description}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-2xl font-bold">{formatPrice(plan.price_monthly)}<span className="text-sm font-normal text-gray-500">/mo</span></span>
                      <button onClick={() => startEdit(plan)}
                        className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">
                        Edit
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-6 text-sm">
                    <div>
                      <span className="text-gray-500">ID:</span>
                      <span className="ml-2 font-mono text-xs">{plan.id}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Max users:</span>
                      <span className="ml-2">{plan.max_users ?? 'Unlimited'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Sort order:</span>
                      <span className="ml-2">{plan.sort_order}</span>
                    </div>
                  </div>

                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-400">Features JSON</summary>
                    <pre className="mt-2 rounded-lg bg-gray-950 p-3 text-xs font-mono text-gray-400 overflow-x-auto">
                      {JSON.stringify(plan.features, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
