'use client'

import { formatDate } from '@/lib/utils'
import type { Webhook, Delivery } from './types'

interface DeliveryLogProps {
  deliveryWebhook: Webhook | null
  deliveries: Delivery[]
  deliveryPage: number
  deliveryTotal: number
  deliveryLoading: boolean
  selectedDelivery: Delivery | null
  onClose: () => void
  onSelectDelivery: (delivery: Delivery | null) => void
  onFetchDeliveries: (webhookId: string, page: number) => void
  /** Placeholder callback for resending a failed delivery. Actual resend is a future feature. */
  onResend?: (delivery: Delivery) => void
}

/** Color-coded latency bar showing relative speed. */
function LatencyDisplay({ ms }: { ms: number | null }) {
  if (ms == null) return <span className="text-xs text-gray-500">—</span>

  let color: string
  let bg: string
  let widthPercent: number

  if (ms < 200) {
    color = 'text-green-400'
    bg = 'bg-green-500'
    widthPercent = Math.min((ms / 200) * 50, 50)
  } else if (ms < 1000) {
    color = 'text-yellow-300'
    bg = 'bg-yellow-500'
    widthPercent = 50 + Math.min(((ms - 200) / 800) * 30, 30)
  } else {
    color = 'text-red-400'
    bg = 'bg-red-500'
    widthPercent = Math.min(80 + ((ms - 1000) / 9000) * 20, 100)
  }

  const label = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-gray-700 overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full ${bg} transition-all`}
          style={{ width: `${Math.max(4, widthPercent)}%` }}
        />
      </div>
      <span className={`text-xs font-mono ${color}`}>{label}</span>
    </div>
  )
}

export default function DeliveryLog({
  deliveryWebhook,
  deliveries,
  deliveryPage,
  deliveryTotal,
  deliveryLoading,
  selectedDelivery,
  onClose,
  onSelectDelivery,
  onFetchDeliveries,
  onResend,
}: DeliveryLogProps) {
  if (!deliveryWebhook) return null

  const PAGE_LIMIT = 20
  const totalPages = Math.ceil(deliveryTotal / PAGE_LIMIT)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-3xl max-h-[85vh] rounded-xl border border-indigo-500/20 bg-[#0d1137]/95 p-6 backdrop-blur-sm shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-white">Delivery Log</h3>
            <p className="text-xs text-gray-500 mt-0.5 font-mono truncate max-w-md">
              {deliveryWebhook.url.length > 60
                ? deliveryWebhook.url.slice(0, 60) + '...'
                : deliveryWebhook.url}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {selectedDelivery ? (
          /* Delivery detail view */
          <div className="flex-1 overflow-y-auto min-h-0">
            <button
              onClick={() => onSelectDelivery(null)}
              className="text-sm text-indigo-400 hover:text-indigo-300 mb-4 inline-flex items-center gap-1"
            >
              ← Back to deliveries
            </button>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-indigo-500/10 bg-[#080b18]/60 p-3">
                  <span className="text-xs text-gray-500 block mb-1">Event</span>
                  <span className="text-sm text-gray-200">
                    {selectedDelivery.event_type}
                  </span>
                </div>
                <div className="rounded-lg border border-indigo-500/10 bg-[#080b18]/60 p-3">
                  <span className="text-xs text-gray-500 block mb-1">Status</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      selectedDelivery.status === 'delivered'
                        ? 'bg-green-900/40 text-green-300'
                        : 'bg-red-900/40 text-red-300'
                    }`}
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                        selectedDelivery.status === 'delivered'
                          ? 'bg-green-500'
                          : 'bg-red-500'
                      }`}
                    />
                    {selectedDelivery.status}
                  </span>
                </div>
                <div className="rounded-lg border border-indigo-500/10 bg-[#080b18]/60 p-3">
                  <span className="text-xs text-gray-500 block mb-1">
                    Response Status
                  </span>
                  <span className="text-sm text-gray-200">
                    {selectedDelivery.response_status ?? 'N/A'}
                  </span>
                </div>
                <div className="rounded-lg border border-indigo-500/10 bg-[#080b18]/60 p-3">
                  <span className="text-xs text-gray-500 block mb-1">Duration</span>
                  <LatencyDisplay ms={selectedDelivery.duration_ms} />
                </div>
                <div className="rounded-lg border border-indigo-500/10 bg-[#080b18]/60 p-3 col-span-2">
                  <span className="text-xs text-gray-500 block mb-1">Timestamp</span>
                  <span className="text-sm text-gray-200">
                    {formatDate(selectedDelivery.created_at)}
                  </span>
                </div>
              </div>

              {selectedDelivery.request_body && (
                <div>
                  <span className="text-xs text-gray-500 block mb-1">
                    Request Body
                  </span>
                  <pre className="rounded-lg border border-indigo-500/10 bg-[#080b18]/80 p-3 text-xs text-gray-300 font-mono overflow-x-auto max-h-32 whitespace-pre-wrap">
                    {selectedDelivery.request_body}
                  </pre>
                </div>
              )}

              {selectedDelivery.response_body && (
                <div>
                  <span className="text-xs text-gray-500 block mb-1">
                    Response Body
                  </span>
                  <pre className="rounded-lg border border-indigo-500/10 bg-[#080b18]/80 p-3 text-xs text-gray-300 font-mono overflow-x-auto max-h-32 whitespace-pre-wrap">
                    {selectedDelivery.response_body}
                  </pre>
                </div>
              )}

              {selectedDelivery.error_message && (
                <div>
                  <span className="text-xs text-gray-500 block mb-1">Error</span>
                  <pre className="rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-xs text-red-300 font-mono overflow-x-auto whitespace-pre-wrap">
                    {selectedDelivery.error_message}
                  </pre>
                </div>
              )}

              {/* Resend button for failed deliveries */}
              {selectedDelivery.status === 'failed' && onResend && (
                <div className="pt-2">
                  <button
                    onClick={() => onResend(selectedDelivery)}
                    className="rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
                    title="This will attempt to redeliver the webhook event. Actual resend is a future feature."
                  >
                    ↻ Resend Delivery
                  </button>
                  <p className="text-xs text-gray-500 mt-1.5">
                    Resend is a placeholder — actual retry logic will be implemented in a future release.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Delivery list */
          <>
            {deliveryLoading ? (
              <div className="flex-1 flex items-center justify-center min-h-0">
                <p className="text-sm text-gray-500">Loading deliveries...</p>
              </div>
            ) : deliveries.length === 0 ? (
              <div className="flex-1 flex items-center justify-center min-h-0">
                <p className="text-sm text-gray-500">
                  No deliveries yet for this webhook.
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#0d1137]">
                    <tr className="border-b border-gray-800">
                      <th className="px-3 py-2 text-left font-medium text-gray-400 text-xs">
                        Event
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-400 text-xs">
                        Status
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-400 text-xs">
                        Response
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-400 text-xs">
                        Latency
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-400 text-xs">
                        Time
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-gray-400 text-xs">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((delivery) => (
                      <tr
                        key={delivery.id}
                        className="border-b border-gray-800/50 transition-colors hover:bg-gray-900/30"
                      >
                        <td
                          onClick={() => onSelectDelivery(delivery)}
                          className="px-3 py-2.5 text-xs text-gray-200 font-mono cursor-pointer"
                        >
                          {delivery.event_type}
                        </td>
                        <td
                          onClick={() => onSelectDelivery(delivery)}
                          className="px-3 py-2.5 cursor-pointer"
                        >
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              delivery.status === 'delivered'
                                ? 'bg-green-900/40 text-green-300'
                                : 'bg-red-900/40 text-red-300'
                            }`}
                          >
                            <span
                              className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                                delivery.status === 'delivered'
                                  ? 'bg-green-500'
                                  : 'bg-red-500'
                              }`}
                            />
                            {delivery.status === 'delivered'
                              ? 'Delivered'
                              : 'Failed'}
                          </span>
                        </td>
                        <td
                          onClick={() => onSelectDelivery(delivery)}
                          className="px-3 py-2.5 text-xs text-gray-400 cursor-pointer"
                        >
                          {delivery.response_status ?? '—'}
                        </td>
                        <td
                          onClick={() => onSelectDelivery(delivery)}
                          className="px-3 py-2.5 cursor-pointer"
                        >
                          <LatencyDisplay ms={delivery.duration_ms} />
                        </td>
                        <td
                          onClick={() => onSelectDelivery(delivery)}
                          className="px-3 py-2.5 text-xs text-gray-500 cursor-pointer"
                        >
                          {formatDate(delivery.created_at)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {delivery.status === 'failed' && onResend && (
                            <button
                              onClick={() => onResend(delivery)}
                              className="rounded px-2 py-1 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-900/30 transition-colors"
                              title="Resend (future feature)"
                            >
                              Resend
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {deliveryTotal > PAGE_LIMIT && (
              <div className="flex items-center justify-between pt-4 border-t border-gray-800 mt-4 shrink-0">
                <p className="text-xs text-gray-500">
                  Page {deliveryPage} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const prev = Math.max(1, deliveryPage - 1)
                      onFetchDeliveries(deliveryWebhook.id, prev)
                    }}
                    disabled={deliveryPage <= 1}
                    className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => {
                      const next = deliveryPage + 1
                      onFetchDeliveries(deliveryWebhook.id, next)
                    }}
                    disabled={deliveryPage >= totalPages}
                    className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
