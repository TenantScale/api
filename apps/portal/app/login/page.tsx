'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  async function handleMagicLink() {
    if (!email) {
      setError('Enter your email first')
      return
    }
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setMagicLinkSent(true)
    setLoading(false)
  }

  async function handleForgotPassword() {
    if (!email) {
      setError('Enter your email first')
      return
    }
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    })

    if (error) {
      setError(error.message)
    } else {
      setError('Check your email for the password reset link')
    }
    setLoading(false)
  }

  if (magicLinkSent) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center backdrop-blur">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-900/50">
            <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mb-2 text-lg font-semibold">Check your email</h1>
          <p className="text-sm text-gray-400">
            We sent a magic link to <span className="text-gray-200">{email}</span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mb-2 inline-flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <path d="M16 2L30 10V22L16 30L2 22V10L16 2Z" fill="#6366f1" opacity="0.2"/>
              <path d="M16 6L24 10.5V19.5L16 24L8 19.5V10.5L16 6Z" fill="#00E5D1" opacity="0.6"/>
              <circle cx="16" cy="15" r="3" fill="#00E5D1"/>
              <circle cx="10" cy="10" r="1.5" fill="#00E5D1" opacity="0.4"/>
              <circle cx="22" cy="10" r="1.5" fill="#00E5D1" opacity="0.4"/>
              <circle cx="10" cy="20" r="1.5" fill="#00E5D1" opacity="0.4"/>
              <circle cx="22" cy="20" r="1.5" fill="#00E5D1" opacity="0.4"/>
            </svg>
            <span className="text-xl font-bold">
              <span className="text-gray-300">Tenant</span><span className="text-[#00E5D1]">Scale</span>
            </span>
          </div>
          <p className="text-sm text-gray-500">Customer Portal</p>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
          <h1 className="mb-6 text-lg font-semibold">Sign in to your tenant</h1>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm text-gray-400 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm text-gray-400 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <div className="flex items-center justify-between">
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-[#00E5D1] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={loading}
                className="text-sm text-gray-500 hover:text-gray-300"
              >
                Forgot password?
              </button>
            </div>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-800" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-gray-900/50 px-2 text-gray-500">or</span>
            </div>
          </div>

          <button
            onClick={handleMagicLink}
            disabled={loading}
            className="w-full rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Send magic link
          </button>

          <p className="mt-6 text-center text-sm text-gray-500">
            New here?{' '}
            <Link href="/register" className="text-indigo-400 hover:text-indigo-300">
              Create your organization
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
