'use client'

import { formatDate } from '@/lib/utils'
import type { Webhook } from './types'

interface WebhookListProps {
  webhooks: Webhook[]
  canManage: boolean
  toggling: string | null
  onToggle: (webhook: Webhook) => void
  onOpenDeliveries: (webhook: Webhook) => void
  onOpenEdit: (webhook: Webhook) => void
  onDeleteStart: (webhook: Webhook) => void
}

/** Get a color-coded badge for the success rate percentage. */
function SuccessRateBadge({ rate }: { rate: number | null | undefined }) {
  if (rate == null) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-800 text-gray-500">
        No data
      </span>
    )
  }

  const clamped = Math.min(100, Math.max(0, rate))
  let bg: string
  let text: string
  let dot: string

  if (clamped >= 90) {
    bg = 'bg-green-900/40'
    text = 'text-green-300'
    dot = 'bg-green-500'
  } else if (clamped >= 70) {
    bg = 'bg-yellow-900/40'
    text = 'text-yellow-300'
    dot = 'bg-yellow-500'
  } else {
    bg = 'bg-red-900/40'
    text = 'text-red-300'
    dot = 'bg-red-500'
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${bg} ${text}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${dot}`} />
      {clamped.toFixed(0)}%
    </span>
  )
}

/** Format a duration_ms value into a human-readable string. */
function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export default function WebhookList({
  webhooks,
  canManage,
  toggling,
  onToggle,
  onOpenDeliveries,
  onOpenEdit,
  onDeleteStart,
}: WebhookListProps) {
  if (webhooks.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-indigo-500/20 bg-[#0d1137]/80 backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/50">
              <th className="px-4 py-3 text-left font-medium text-gray-400">URL</th>
              <th className="px-4 py-3 text-left font-medium text-gray-400">Events</th>
              <th className="px-4 py-3 text-left font-medium text-gray-400">Success Rate</th>
              <th className="px-4 py-3 text-left font-medium text-gray-400">Last Delivery</th>
              <th className="px-4 py-3 text-left font-medium text-gray-400">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-400">Created</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                No webhooks configured. Create one to receive event notifications.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-indigo-500/20 bg-[#0d1137]/80 backdrop-blur-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/50">
            <th className="px-4 py-3 text-left font-medium text-gray-400">URL</th>
            <th className="px-4 py-3 text-left font-medium text-gray-400">Events</th>
            <th className="px-4 py-3 text-left font-medium text-gray-400">Success Rate</th>
            <th className="px-4 py-3 text-left font-medium text-gray-400">Last Delivery</th>
            <th className="px-4 py-3 text-left font-medium text-gray-400">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-400">Created</th>
            <th className="px-4 py-3 text-right font-medium text-gray-400">Actions</th>
          </tr>
        </thead>
        <tbody>
          {webhooks.map((webhook) => (
            <tr
              key={webhook.id}
              className="border-b border-gray-800/50 transition-colors hover:bg-gray-900/30"
            >
              <td className="px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-gray-200 font-mono text-xs truncate max-w-[220px] block">
                    {webhook.url.length > 50
                      ? webhook.url.slice(0, 50) + '...'
                      : webhook.url}
                  </span>
                  {webhook.description && (
                    <span className="text-xs text-gray-500 mt-0.5 truncate max-w-[220px]">
                      {webhook.description}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1 max-w-[200px]">
                  {webhook.events.slice(0, 3).map((event) => (
                    <span
                      key={event}
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-900/40 text-indigo-300"
                    >
                      {event}
                    </span>
                  ))}
                  {webhook.events.length > 3 && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-800 text-gray-400">
                      +{webhook.events.length - 3}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <SuccessRateBadge rate={webhook.success_rate} />
              </td>
              <td className="px-4 py-3">
                {webhook.last_delivery ? (
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={`inline-flex items-center text-xs font-medium ${
                        webhook.last_delivery.status === 'delivered'
                          ? 'text-green-400'
                          : 'text-red-400'
                      }`}
                    >
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                          webhook.last_delivery.status === 'delivered'
                            ? 'bg-green-500'
                            : 'bg-red-500'
                        }`}
                      />
                      {webhook.last_delivery.status === 'delivered' ? 'Delivered' : 'Failed'}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {formatDate(webhook.last_delivery.created_at)}
                    </span>
                    {webhook.last_delivery.duration_ms != null && (
                      <span className="text-[10px] text-gray-500">
                        {formatDuration(webhook.last_delivery.duration_ms)}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-gray-500">No deliveries</span>
                )}
              </td>
              <td className="px-4 py-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={webhook.is_active}
                    disabled={toggling === webhook.id || !canManage}
                    onChange={() => onToggle(webhook)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-indigo-600 peer-checked:to-cyan-600"></div>
                  <span
                    className={`ml-2 text-xs ${
                      webhook.is_active ? 'text-green-400' : 'text-gray-500'
                    }`}
                  >
                    {webhook.is_active ? 'Active' : 'Inactive'}
                  </span>
                </label>
              </td>
              <td className="px-4 py-3 text-gray-400 text-xs">
                {formatDate(webhook.created_at)}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => onOpenDeliveries(webhook)}
                    className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                    title="View delivery log"
                  >
                    Deliveries
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => onOpenEdit(webhook)}
                        className="rounded px-2 py-1 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/30 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onDeleteStart(webhook)}
                        className="rounded px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
