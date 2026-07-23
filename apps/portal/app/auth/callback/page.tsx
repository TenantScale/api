'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function AuthCallbackPage() {
  const router = useRouter()
  const supabase = createClient()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleAuthCallback = async () => {
      // Supabase OAuth returns the session as URL hash params.
      // The @supabase/ssr client automatically picks them up
      // via onAuthStateChange, but we need to wait for it.
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (sessionError) {
        setError(sessionError.message)
        return
      }

      if (session) {
        // Check if they have a tenant membership
        try {
          const res = await fetch('/api/proxy/v1/portal/me')
          if (res.ok) {
            const data = await res.json()
            if (data.tenant) {
              router.push('/dashboard')
            } else {
              // Logged in but no tenant — send them to create/join one
              router.push('/tenants')
            }
          } else {
            // Session might not be fully established yet — try dashboard
            router.push('/dashboard')
          }
        } catch {
          router.push('/dashboard')
        }
        router.refresh()
      } else {
        // No session found yet — wait for the hash to be processed
        const unsubscribe = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session) {
            unsubscribe.data.subscription.unsubscribe()
            router.push('/dashboard')
            router.refresh()
          }
        })

        // Timeout after 10 seconds
        setTimeout(() => {
          unsubscribe.data.subscription.unsubscribe()
          setError('Authentication timed out. Please try again.')
        }, 10000)
      }
    }

    handleAuthCallback()
  }, [])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-red-800 bg-red-900/20 p-8 text-center backdrop-blur">
          <h1 className="mb-2 text-lg font-semibold text-red-400">Sign in failed</h1>
          <p className="text-sm text-red-300">{error}</p>
          <a
            href="/login"
            className="mt-4 inline-block rounded-lg bg-gradient-to-r from-indigo-600 to-[#00E5D1] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Back to login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-4">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
        <p className="text-sm text-gray-400">Completing sign in...</p>
      </div>
    </div>
  )
}
