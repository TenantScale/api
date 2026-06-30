'use client'

import { ALL_EVENTS } from './types'
import type { WebhookEvent } from './types'

interface WebhookFormProps {
  mode: 'create' | 'edit'
  isOpen: boolean
  onClose: () => void
  url: string
  onUrlChange: (url: string) => void
  events: WebhookEvent[]
  onToggleEvent: (event: WebhookEvent) => void
  description: string
  onDescriptionChange: (description: string) => void
  submitting: boolean
  validationError: string | null
  onSubmit: (e: React.FormEvent) => void
  /** Only used in create mode – shows secret display after creation */
  newSecret?: string | null
  onDismissNewSecret?: () => void
}

export default function WebhookForm({
  mode,
  isOpen,
  onClose,
  url,
  onUrlChange,
  events,
  onToggleEvent,
  description,
  onDescriptionChange,
  submitting,
  validationError,
  onSubmit,
  newSecret,
  onDismissNewSecret,
}: WebhookFormProps) {
  if (!isOpen) return null

  const isCreate = mode === 'create'
  const title = isCreate ? 'Create Webhook' : 'Edit Webhook'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-xl border border-indigo-500/20 bg-[#0d1137]/95 p-6 backdrop-blur-sm shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {isCreate && newSecret ? (
          /* Secret display after creation */
          <div>
            <div className="rounded-lg border border-green-700/50 bg-green-900/20 p-4 mb-4">
              <p className="text-sm font-medium text-green-400 mb-2">
                Webhook created successfully!
              </p>
              <p className="text-xs text-green-400/70 mb-3">
                Copy the secret key now. You won&apos;t be able to see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-indigo-500/20 bg-[#080b18] px-3 py-2 text-sm font-mono text-cyan-300 break-all select-all">
                  {newSecret}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(newSecret)}
                  className="rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-600 px-3 py-2 text-xs font-medium text-white hover:opacity-90 shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
            <button
              onClick={onDismissNewSecret}
              className="rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 w-full"
            >
              Done
            </button>
          </div>
        ) : (
          /* Form */
          <form onSubmit={onSubmit} className="space-y-4">
            {validationError && (
              <div className="rounded-lg border border-red-800 bg-red-900/20 p-3 text-sm text-red-400">
                {validationError}
              </div>
            )}

            {/* URL */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                URL <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="https://example.com/webhook"
                className="w-full rounded-lg border border-indigo-500/20 bg-[#080b18] px-3 py-2 text-white placeholder-gray-500 focus:border-indigo-400 focus:outline-none"
                required
              />
            </div>

            {/* Events */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Events <span className="text-red-400">*</span>
              </label>
              <div className="max-h-48 overflow-y-auto space-y-2 rounded-lg border border-indigo-500/10 bg-[#080b18]/60 p-3">
                {ALL_EVENTS.map((event) => (
                  <label
                    key={event}
                    className="flex items-center gap-2 text-sm cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={events.includes(event)}
                      onChange={() => onToggleEvent(event)}
                      className="rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0"
                    />
                    <span className="text-gray-300 group-hover:text-gray-100 transition-colors">
                      {event}
                    </span>
                  </label>
                ))}
              </div>
              {events.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {events.length} event{events.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Description{' '}
                <span className="text-gray-600">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => onDescriptionChange(e.target.value)}
                placeholder="e.g. Slack notifications"
                className="w-full rounded-lg border border-indigo-500/20 bg-[#080b18] px-3 py-2 text-white placeholder-gray-500 focus:border-indigo-400 focus:outline-none"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {isCreate
                  ? submitting
                    ? 'Creating...'
                    : 'Create Webhook'
                  : submitting
                    ? 'Saving...'
                    : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
