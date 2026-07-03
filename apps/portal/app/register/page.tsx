'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'form' | 'done'>('form')
  const [apiKey, setApiKey] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  function autoSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/proxy/v1/portal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          tenant_name: tenantName,
          tenant_slug: tenantSlug || autoSlug(tenantName),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Registration failed')
        setLoading(false)
        return
      }

      // Sign in using the session from the API
      if (data.session?.access_token) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token ?? '',
        })
      }

      setApiKey(data.api_key)
      setStep('done')
    } catch (err) {
      console.error('[Register] Failed to register:', err)
      setError('Network error. Please try again.')
    }

    setLoading(false)
  }

  if (step === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-indigo-500/20 bg-[#0d1137]/80 p-8 backdrop-blur-sm">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-500/20">
                <svg className="h-7 w-7 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-white">Tenant created!</h1>
              <p className="mt-2 text-gray-400">
                Your organization <strong className="text-indigo-300">{tenantName}</strong> is ready.
              </p>
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-sm font-medium text-gray-400">
                Your default API key (shown once)
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={apiKey ?? ''}
                  className="flex-1 rounded-lg border border-indigo-500/20 bg-[#080b18] px-3 py-2 text-sm text-indigo-200 font-mono"
                />
                <button
                  onClick={() => { if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(apiKey ?? '') }}
                  className="rounded-lg border border-indigo-500/30 px-3 py-2 text-sm text-indigo-300 hover:bg-indigo-500/10"
                >
                  Copy
                </button>
              </div>
            </div>

            <button
              onClick={() => router.push('/dashboard')}
              className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-600 px-4 py-2.5 font-medium text-white transition hover:opacity-90"
            >
              Go to dashboard →
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">Create your organization</h1>
          <p className="mt-2 text-gray-400">
            Start with a free tenant and upgrade anytime
          </p>
        </div>

        <form onSubmit={handleRegister} className="rounded-xl border border-indigo-500/20 bg-[#0d1137]/80 p-8 backdrop-blur-sm">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-indigo-500/20 bg-[#080b18] px-3 py-2.5 text-white placeholder-gray-500 focus:border-indigo-400 focus:outline-none"
              placeholder="you@company.com"
              required
            />
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-400">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-indigo-500/20 bg-[#080b18] px-3 py-2.5 text-white placeholder-gray-500 focus:border-indigo-400 focus:outline-none"
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-400">Organization name</label>
            <input
              type="text"
              value={tenantName}
              onChange={e => {
                setTenantName(e.target.value)
                if (!tenantSlug || tenantSlug === autoSlug(tenantName)) {
                  setTenantSlug(autoSlug(e.target.value))
                }
              }}
              className="w-full rounded-lg border border-indigo-500/20 bg-[#080b18] px-3 py-2.5 text-white placeholder-gray-500 focus:border-indigo-400 focus:outline-none"
              placeholder="Acme Corp"
              required
            />
          </div>

          <div className="mb-6">
            <label className="mb-1 block text-sm font-medium text-gray-400">
              URL slug <span className="text-gray-500">(auto-generated)</span>
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-indigo-500/20 bg-[#080b18] px-3 py-2.5">
              <span className="text-gray-500 text-sm">/</span>
              <input
                type="text"
                value={tenantSlug}
                onChange={e => setTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none"
                placeholder="acme-corp"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-600 px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create organization'}
          </button>

          <p className="mt-4 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link href="/login" className="text-indigo-400 hover:text-indigo-300">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
