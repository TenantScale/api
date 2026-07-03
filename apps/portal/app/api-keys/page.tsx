'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatDate, timeAgo, truncateId } from '@/lib/utils'
import NavBar from '@/components/NavBar'
import type { User } from '@supabase/supabase-js'

interface ApiKey {
  id: string
  label: string
  key_prefix: string
  scopes: string[]
  is_active: boolean
  expires_at: string | null
  last_used_at: string | null
  created_at: string
  created_by: string | null
}

export default function ApiKeysPage() {
  const [user, setUser] = useState<User | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create key form
  const [showCreate, setShowCreate] = useState(false)
  const [keyLabel, setKeyLabel] = useState('')
  const [keyScopes, setKeyScopes] = useState<string[]>(['read'])
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)

  // Revoke
  const [revoking, setRevoking] = useState<string | null>(null)

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUser(user)
      fetchKeys()
    })
  }, [])

  async function fetchKeys() {
    try {
      const res = await fetch('/api/proxy/v1/portal/api-keys')
      if (res.ok) {
        const data = await res.json()
        setKeys(data.api_keys ?? [])
      }
    } catch (err) {
      console.error('[API Keys] Failed to fetch:', err)
    }
    setLoading(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setNewKey(null)

    try {
      const res = await fetch('/api/proxy/v1/portal/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: keyLabel, scopes: keyScopes }),
      })
      const data = await res.json()
      if (res.ok) {
        setNewKey(data.raw_key)
        setKeyLabel('')
        setKeyScopes(['read'])
        fetchKeys()
      } else {
        setError(data.error)
      }
    } catch {
      setError('Failed to create key')
    }
    setCreating(false)
  }

  async function handleRevoke(keyId: string) {
    try {
      const res = await fetch(`/api/proxy/v1/portal/api-keys/${keyId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setRevoking(null)
        fetchKeys()
      }
    } catch (err) {
      console.error('[API Keys] Failed to revoke:', err)
    }
  }

  const [myRole, setMyRole] = useState<string>('member')

  useEffect(() => {
    if (user) {
      fetch('/api/proxy/v1/portal/me').then(r => r.json()).then(d => {
        if (d.user) setMyRole(d.user.role)
      }).catch(() => {})
    }
  }, [user])

  const canManage = ['owner', 'admin'].includes(myRole)
  const TABLE_COLUMNS = 7

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-gray-500">Loading API keys...</p></div>
  }

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin={false} />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">API Keys</h2>
            <p className="text-sm text-gray-400 mt-1">{keys.length} key{keys.length !== 1 ? 's' : ''}</p>
          </div>
          {canManage && (
            <button
              onClick={() => { setShowCreate(!showCreate); setNewKey(null) }}
              className="rounded-lg bg-gradient-to-r from-indigo-600 to-[#00E5D1] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Create Key
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">{error}</div>
        )}

        {/* Create form */}
        {showCreate && canManage && (
          <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
            <h3 className="mb-4 text-sm font-medium">Create a new API key</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Label</label>
                <input
                  type="text"
                  value={keyLabel}
                  onChange={(e) => setKeyLabel(e.target.value)}
                  placeholder="e.g. Production, CI/CD, Staging"
                  className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Scopes</label>
                <div className="flex flex-wrap gap-3">
                  {['read', 'write', 'admin'].map((scope) => (
                    <label key={scope} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={keyScopes.includes(scope)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setKeyScopes([...keyScopes, scope])
                          } else {
                            setKeyScopes(keyScopes.filter(s => s !== scope))
                          }
                        }}
                        className="rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-gray-300">{scope}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Key'}
              </button>
            </form>

            {newKey && (
              <div className="mt-4 rounded-lg border border-green-800 bg-green-900/20 p-4">
                <p className="text-sm font-medium text-green-400 mb-2">Key created! Copy it now — you won't see it again.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-gray-900 px-3 py-2 text-sm font-mono break-all">{newKey}</code>
                  <button
                    onClick={() => { if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(newKey) }}
                    className="rounded bg-gray-800 px-3 py-2 text-xs text-gray-300 hover:bg-gray-700"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Keys table */}
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className="px-4 py-3 text-left font-medium text-gray-400">Label</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Key</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Scopes</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Last Used</th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">Created</th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLUMNS} className="px-4 py-12 text-center text-gray-500">
                    No API keys yet. Create one to get started.
                  </td>
                </tr>
              ) : (
                keys.map((key) => (
                  <tr key={key.id} className="border-b border-gray-800/50 transition-colors hover:bg-gray-900/50">
                    <td className="px-4 py-3 font-medium">{key.label}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">
                      {key.key_prefix}...
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map(s => (
                          <span key={s} className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block h-2 w-2 rounded-full ${key.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {key.last_used_at ? timeAgo(key.last_used_at) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(key.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {canManage && key.is_active && (
                        <button
                          onClick={() => setRevoking(key.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Revoke confirmation */}
        {revoking && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onKeyDown={(e) => e.key === 'Escape' && setRevoking(null)}>
            <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-6 backdrop-blur">
              <h3 className="text-lg font-semibold mb-2">Revoke API Key?</h3>
              <p className="text-sm text-gray-400 mb-6">
                This will immediately invalidate the key. Any services using it will lose access.
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setRevoking(null)}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800">
                  Cancel
                </button>
                <button onClick={() => handleRevoke(revoking)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700">
                  Revoke
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
