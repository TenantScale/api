'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import NavBar from '@/components/NavBar'
import type { User } from '@supabase/supabase-js'

interface AuditEvent {
  id: string
  action: string
  resource: string
  details: Record<string, unknown>
  actor_type: string
  actor_id: string | null
  created_at: string
}

export default function AuditPage() {
  const [user, setUser] = useState<User | null>(null)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [actionFilter, setActionFilter] = useState('')
  const [myRole, setMyRole] = useState<string>('member')

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUser(user)
      // Fetch role
      fetch('/api/proxy/v1/portal/me').then(r => r.json()).then(d => {
        if (d.user) setMyRole(d.user.role)
      }).catch(() => {})
    })
  }, [])

  useEffect(() => {
    if (user) fetchAudit()
  }, [user, page, actionFilter])

  async function fetchAudit() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (actionFilter) params.set('action', actionFilter)

      const res = await fetch(`/api/proxy/v1/portal/audit?${params}`)
      if (res.ok) {
        const data = await res.json()
        setEvents(data.events ?? [])
        setTotalPages(data.pagination?.total_pages ?? 1)
      }
    } catch (err) {
      console.error('[Audit] Failed to fetch:', err)
      setError('Failed to load audit log')
    }
    setLoading(false)
  }

  function getActionColor(action: string): string {
    if (action.startsWith('user.')) return 'bg-blue-900/50 text-blue-400 border-blue-800'
    if (action.startsWith('api_key.')) return 'bg-amber-900/50 text-amber-400 border-amber-800'
    if (action.startsWith('tenant.')) return 'bg-purple-900/50 text-purple-400 border-purple-800'
    return 'bg-gray-800 text-gray-400 border-gray-700'
  }

  const isOwner = myRole === 'owner'

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin={false} />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">Audit Log</h2>
            <p className="text-sm text-gray-400 mt-1">
              {isOwner || myRole === 'admin' ? 'All events across your tenant' : 'Your activity'}
            </p>
          </div>
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
            className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">All actions</option>
            <option value="user.invited">Invitations</option>
            <option value="user.removed">Removals</option>
            <option value="user.role_changed">Role changes</option>
            <option value="api_key.created">Key created</option>
            <option value="api_key.revoked">Key revoked</option>
            <option value="tenant.settings_updated">Settings</option>
            {isOwner && <option value="tenant.ownership_transferred">Ownership</option>}
          </select>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">{error}</div>
        )}

        {/* Events */}
        <div className="rounded-xl border border-gray-800">
          {loading ? (
            <div className="p-12 text-center text-sm text-gray-500">Loading audit log...</div>
          ) : events.length === 0 ? (
            <div className="p-12 text-center text-sm text-gray-500">No audit events yet.</div>
          ) : (
            <div className="divide-y divide-gray-800">
              {events.map((event) => (
                <div key={event.id} className="flex items-start gap-4 p-4">
                  <div className="mt-0.5">
                    <div className={`h-2 w-2 rounded-full ${event.actor_type === 'admin_impersonation' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`rounded border px-2 py-0.5 text-xs font-medium ${getActionColor(event.action)}`}>
                        {event.action}
                      </span>
                      <span className="text-sm text-gray-400">{event.resource}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {formatDate(event.created_at)}
                      {event.details && Object.keys(event.details).length > 0 && (
                        <span className="ml-2 text-gray-600">
                          — {JSON.stringify(event.details).slice(0, 120)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
