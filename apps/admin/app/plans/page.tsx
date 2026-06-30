'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

interface Plan {
  id: string
  name: string
  description: string
  price_monthly: number
  features: Record<string, boolean | number | string | null>
  max_users: number | null
  sort_order: number
}

export default function PlansPage() {
  const [user, setUser] = useState<User | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<{ id: string; type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)
      fetchPlans()
    })
  }, [])

  async function fetchPlans() {
    try {
      const res = await fetch('/api/proxy/v1/plans')
      if (res.ok) {
        const data = await res.json()
        setPlans(data.plans ?? [])
      } else {
        console.error('[Admin Plans] Failed to fetch plans:', res.status)
      }
    } catch (err) {
      console.error('[Admin Plans] Failed to fetch plans:', err)
    }
    setLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function updateFeature(planId: string, key: string, value: boolean | number | string | null) {
    setPlans((prev) =>
      prev.map((p) =>
        p.id === planId
          ? { ...p, features: { ...p.features, [key]: value } }
          : p
      )
    )
  }

  async function savePlan(plan: Plan) {
    setSaving(plan.id)
    setSaveMsg(null)

    try {
      const res = await fetch(`/api/proxy/v1/plans/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features: plan.features,
          name: plan.name,
          description: plan.description,
          price_monthly: plan.price_monthly,
          max_users: plan.max_users,
        }),
      })

      if (res.ok) {
        setSaveMsg({ id: plan.id, type: 'success', text: 'Plan updated' })
      } else {
        const err = await res.json()
        setSaveMsg({ id: plan.id, type: 'error', text: err.error ?? 'Failed to save' })
      }
    } catch {
      setSaveMsg({ id: plan.id, type: 'error', text: 'Network error' })
    } finally {
      setSaving(null)
    }
  }

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold">Plan Limits</h1>
            <nav className="flex gap-4 text-sm">
              <a href="/tenants" className="text-gray-400 hover:text-gray-200">Tenants</a>
              <span className="text-blue-400 font-medium">Plans</span>
            </nav>
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

      <main className="mx-auto max-w-5xl px-6 py-8">
        {loading ? (
          <div className="text-center text-sm text-gray-500 py-12">Loading plans...</div>
        ) : plans.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-12">No plans configured.</div>
        ) : (
          <div className="space-y-8">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                saving={saving === plan.id}
                saveMsg={saveMsg?.id === plan.id ? saveMsg : null}
                onFeatureChange={updateFeature}
                onSave={() => savePlan(plan)}
                formatPrice={formatPrice}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function PlanCard({
  plan,
  saving,
  saveMsg,
  onFeatureChange,
  onSave,
  formatPrice,
}: {
  plan: Plan
  saving: boolean
  saveMsg: { type: string; text: string } | null
  onFeatureChange: (planId: string, key: string, value: boolean | number | string | null) => void
  onSave: () => void
  formatPrice: (cents: number) => string
}) {
  const [showAddLimit, setShowAddLimit] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  function handleAddLimit() {
    if (!newKey) return
    const parsed: boolean | number | string | null =
      newValue === '' ? null
      : newValue === 'true' ? true
      : newValue === 'false' ? false
      : !isNaN(Number(newValue)) ? Number(newValue)
      : newValue
    onFeatureChange(plan.id, newKey, parsed)
    setNewKey('')
    setNewValue('')
    setShowAddLimit(false)
  }

  const isIndigo = plan.id === 'free' ? 'from-indigo-900/40 to-transparent' : ''

  return (
    <div className={`rounded-xl border border-gray-800 overflow-hidden ${isIndigo}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
        <div className="flex items-center gap-4">
          <h2 className="text-base font-semibold capitalize">{plan.name}</h2>
          <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-mono text-gray-400">
            {plan.id}
          </span>
          <span className="text-sm text-gray-400">{formatPrice(plan.price_monthly)}/mo</span>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Limits table */}
      <div className="p-6">
        {Object.keys(plan.features).length === 0 && !showAddLimit ? (
          <p className="text-sm text-gray-500">No limits configured for this plan.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(plan.features).map(([key, value]) => (
              <LimitRow
                key={key}
                label={key}
                value={value}
                onChange={(v) => onFeatureChange(plan.id, key, v)}
                onRemove={() => onFeatureChange(plan.id, key, null)}
              />
            ))}
          </div>
        )}

        {saveMsg && (
          <p className={`mt-3 text-xs ${saveMsg.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {saveMsg.text}
          </p>
        )}

        {/* Add limit */}
        {showAddLimit ? (
          <div className="mt-4 flex items-center gap-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="limit name (e.g. max_storage_gb)"
              className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs font-mono placeholder-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value (true, 100, null)"
              className="w-36 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs font-mono placeholder-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleAddLimit}
              className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600"
            >
              Add
            </button>
            <button
              onClick={() => setShowAddLimit(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddLimit(true)}
            className="mt-4 text-xs text-blue-400 hover:text-blue-300"
          >
            + Add limit
          </button>
        )}
      </div>
    </div>
  )
}

function LimitRow({
  label,
  value,
  onChange,
  onRemove,
}: {
  label: string
  value: boolean | number | string | null
  onChange: (v: boolean | number | string | null) => void
  onRemove: () => void
}) {
  const displayValue = value === null ? 'unlimited' : String(value)
  const isBool = typeof value === 'boolean'
  const isNum = typeof value === 'number'

  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-900/50 px-4 py-2.5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="text-xs font-mono text-gray-300 truncate">{label}</span>
        {isBool ? (
          <button
            onClick={() => onChange(!value)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              value ? 'bg-green-600' : 'bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                value ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`}
            />
          </button>
        ) : isNum ? (
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(parseInt(e.target.value) || 0)}
            className="w-24 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs font-mono text-center text-gray-200 focus:border-blue-500 focus:outline-none"
          />
        ) : value === null ? (
          <span className="text-xs text-gray-500 italic">unlimited</span>
        ) : (
          <input
            type="text"
            value={displayValue}
            onChange={(e) => onChange(e.target.value)}
            className="w-32 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs font-mono text-gray-200 focus:border-blue-500 focus:outline-none"
          />
        )}
      </div>
      <button
        onClick={onRemove}
        className="ml-2 text-xs text-red-500 hover:text-red-400 flex-shrink-0"
        title="Remove limit"
      >
        ✕
      </button>
    </div>
  )
}
