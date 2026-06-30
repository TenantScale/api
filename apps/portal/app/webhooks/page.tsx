'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import NavBar from '@/components/NavBar'
import type { User } from '@supabase/supabase-js'
import type { Webhook, Delivery, DeliveryPage, WebhookEvent } from '@/components/webhooks/types'
import WebhookList from '@/components/webhooks/WebhookList'
import WebhookForm from '@/components/webhooks/WebhookForm'
import DeliveryLog from '@/components/webhooks/DeliveryLog'

export default function WebhooksPage() {
  const [user, setUser] = useState<User | null>(null)
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<string>('member')

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [createUrl, setCreateUrl] = useState('')
  const [createEvents, setCreateEvents] = useState<WebhookEvent[]>([])
  const [createDescription, setCreateDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Edit form
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null)
  const [editUrl, setEditUrl] = useState('')
  const [editEvents, setEditEvents] = useState<WebhookEvent[]>([])
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete confirmation
  const [deletingWebhook, setDeletingWebhook] = useState<Webhook | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Delivery log
  const [deliveryWebhook, setDeliveryWebhook] = useState<Webhook | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [deliveryPage, setDeliveryPage] = useState<number>(1)
  const [deliveryTotal, setDeliveryTotal] = useState<number>(0)
  const [deliveryLoading, setDeliveryLoading] = useState(false)
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)

  // Toggle
  const [toggling, setToggling] = useState<string | null>(null)

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUser(user)
      fetchWebhooks()
      fetchMyRole()
    })
  }, [])

  async function fetchMyRole() {
    try {
      const res = await fetch('/api/proxy/v1/portal/me')
      if (res.ok) {
        const data = await res.json()
        if (data.user) setMyRole(data.user.role)
      }
    } catch (err) {
      console.error('[Webhooks] Failed to fetch role:', err)
    }
  }

  async function fetchWebhooks() {
    try {
      const res = await fetch('/api/proxy/v1/portal/webhooks')
      if (res.ok) {
        const data = await res.json()
        setWebhooks(data.webhooks ?? data ?? [])
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to load webhooks')
      }
    } catch (err) {
      console.error('[Webhooks] Failed to fetch:', err)
      setError('Failed to load webhooks')
    }
    setLoading(false)
  }

  async function fetchDeliveries(webhookId: string, page: number = 1) {
    setDeliveryLoading(true)
    try {
      const res = await fetch(
        `/api/proxy/v1/portal/webhooks/${webhookId}/deliveries?page=${page}&limit=20`
      )
      if (res.ok) {
        const data: DeliveryPage = await res.json()
        setDeliveries(data.deliveries ?? [])
        setDeliveryTotal(data.total ?? 0)
        setDeliveryPage(data.page ?? page)
      }
    } catch (err) {
      console.error('[Webhooks] Failed to fetch deliveries:', err)
    }
    setDeliveryLoading(false)
  }

  function isValidUrl(url: string): boolean {
    try {
      const u = new URL(url)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }

  function openCreate() {
    setShowCreate(true)
    setCreateUrl('')
    setCreateEvents([])
    setCreateDescription('')
    setNewSecret(null)
    setValidationError(null)
  }

  function openEdit(webhook: Webhook) {
    setEditingWebhook(webhook)
    setEditUrl(webhook.url)
    setEditEvents([...webhook.events])
    setEditDescription(webhook.description ?? '')
    setValidationError(null)
  }

  function openDeliveries(webhook: Webhook) {
    setDeliveryWebhook(webhook)
    setDeliveries([])
    setDeliveryPage(1)
    setDeliveryTotal(0)
    setSelectedDelivery(null)
    fetchDeliveries(webhook.id, 1)
  }

  function closeDeliveries() {
    setDeliveryWebhook(null)
    setSelectedDelivery(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setValidationError(null)

    if (!isValidUrl(createUrl)) {
      setValidationError('Please enter a valid HTTP or HTTPS URL')
      return
    }
    if (createEvents.length === 0) {
      setValidationError('Please select at least one event')
      return
    }

    setCreating(true)
    try {
      const res = await fetch('/api/proxy/v1/portal/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: createUrl,
          events: createEvents,
          description: createDescription || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setNewSecret(data.secret ?? data.secret_key ?? null)
        setCreateUrl('')
        setCreateEvents([])
        setCreateDescription('')
        fetchWebhooks()
      } else {
        setValidationError(data.error || 'Failed to create webhook')
      }
    } catch {
      setValidationError('Failed to create webhook')
    }
    setCreating(false)
  }

  function dismissNewSecret() {
    setShowCreate(false)
    setNewSecret(null)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingWebhook) return
    setValidationError(null)

    if (!isValidUrl(editUrl)) {
      setValidationError('Please enter a valid HTTP or HTTPS URL')
      return
    }
    if (editEvents.length === 0) {
      setValidationError('Please select at least one event')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(
        `/api/proxy/v1/portal/webhooks/${editingWebhook.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: editUrl,
            events: editEvents,
            description: editDescription || undefined,
          }),
        }
      )
      if (res.ok) {
        setEditingWebhook(null)
        fetchWebhooks()
      } else {
        const data = await res.json().catch(() => ({}))
        setValidationError(data.error || 'Failed to update webhook')
      }
    } catch {
      setValidationError('Failed to update webhook')
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!deletingWebhook) return
    setDeleting(true)
    try {
      await fetch(`/api/proxy/v1/portal/webhooks/${deletingWebhook.id}`, {
        method: 'DELETE',
      })
      setDeletingWebhook(null)
      fetchWebhooks()
    } catch (err) {
      console.error('[Webhooks] Failed to delete:', err)
    }
    setDeleting(false)
  }

  async function handleToggle(webhook: Webhook) {
    setToggling(webhook.id)
    try {
      await fetch(`/api/proxy/v1/portal/webhooks/${webhook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !webhook.is_active }),
      })
      fetchWebhooks()
    } catch {}
    setToggling(null)
  }

  const canManage = ['owner', 'admin'].includes(myRole)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading webhooks...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <NavBar email={user?.email} isSuperAdmin={false} />

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Webhooks</h2>
            <p className="text-sm text-gray-400 mt-1">
              {webhooks.length} webhook{webhooks.length !== 1 ? 's' : ''}
            </p>
          </div>
          {canManage && (
            <button
              onClick={openCreate}
              className="rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Create Webhook
            </button>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-3 text-red-300 hover:text-red-200 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Webhooks table */}
        <WebhookList
          webhooks={webhooks}
          canManage={canManage}
          toggling={toggling}
          onToggle={handleToggle}
          onOpenDeliveries={openDeliveries}
          onOpenEdit={openEdit}
          onDeleteStart={setDeletingWebhook}
        />

        {/* Create modal */}
        <WebhookForm
          mode="create"
          isOpen={showCreate}
          onClose={() => setShowCreate(false)}
          url={createUrl}
          onUrlChange={setCreateUrl}
          events={createEvents}
          onToggleEvent={(event: WebhookEvent) => {
            setCreateEvents((prev) =>
              prev.includes(event)
                ? prev.filter((e) => e !== event)
                : [...prev, event]
            )
          }}
          description={createDescription}
          onDescriptionChange={setCreateDescription}
          submitting={creating}
          validationError={validationError}
          onSubmit={handleCreate}
          newSecret={newSecret}
          onDismissNewSecret={dismissNewSecret}
        />

        {/* Edit modal */}
        <WebhookForm
          mode="edit"
          isOpen={editingWebhook !== null}
          onClose={() => setEditingWebhook(null)}
          url={editUrl}
          onUrlChange={setEditUrl}
          events={editEvents}
          onToggleEvent={(event: WebhookEvent) => {
            setEditEvents((prev) =>
              prev.includes(event)
                ? prev.filter((e) => e !== event)
                : [...prev, event]
            )
          }}
          description={editDescription}
          onDescriptionChange={setEditDescription}
          submitting={saving}
          validationError={validationError}
          onSubmit={handleEdit}
        />

        {/* Delete confirmation */}
        {deletingWebhook && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onKeyDown={(e) => e.key === 'Escape' && setDeletingWebhook(null)}>
            <div className="w-full max-w-sm rounded-xl border border-red-500/20 bg-[#0d1137]/95 p-6 backdrop-blur-sm shadow-xl">
              <h3 className="text-lg font-semibold text-white mb-2">
                Delete Webhook
              </h3>
              <p className="text-sm text-gray-400 mb-6">
                Are you sure you want to delete this webhook? This action cannot
                be undone. This webhook will stop receiving events immediately.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeletingWebhook(null)}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg bg-red-600/20 border border-red-500/30 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-600/30 disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delivery log */}
        <DeliveryLog
          deliveryWebhook={deliveryWebhook}
          deliveries={deliveries}
          deliveryPage={deliveryPage}
          deliveryTotal={deliveryTotal}
          deliveryLoading={deliveryLoading}
          selectedDelivery={selectedDelivery}
          onClose={closeDeliveries}
          onSelectDelivery={setSelectedDelivery}
          onFetchDeliveries={fetchDeliveries}
        />
      </main>
    </div>
  )
}
