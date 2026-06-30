// ──────────────────────────────────────────────────────
// Webhook Dispatcher — fire-and-forget event delivery
// ──────────────────────────────────────────────────────

import { createHash, createHmac } from 'node:crypto'
import { supabase } from '../db/supabase'
import { logger } from '../lib/logger'
import { validateWebhookUrl } from './ssrf'

const MAX_RETRIES = 3
const RETRY_DELAYS = [1_000, 4_000, 15_000] // 1s, 4s, 15s

/** Exported for testability — override in tests: set __TEST_RETRIES.retries = 0 */
export const __TEST_RETRIES = {
  retries: 3,
  delays: [1_000, 4_000, 15_000],
}

export interface WebhookPayload {
  event: string
  tenant_id: string
  created_at: string
  data: Record<string, unknown>
}

/**
 * Dispatch an event to all active webhooks subscribed to this event type.
 * Fire-and-forget — doesn't block the caller.
 */
export async function dispatchWebhook(
  event: string,
  tenantId: string,
  data: Record<string, unknown>
): Promise<void> {
  // Don't await — intentionally non-blocking, fire-and-forget
  void deliverWebhooks(event, tenantId, data).catch(err => {
    logger.error(err, `[Webhook] Error dispatching ${event}`)
  })
}

async function deliverWebhooks(
  event: string,
  tenantId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    // Find active webhooks subscribed to this event
    const { data: webhooks, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .contains('events', [event])

    if (error) {
      logger.error({ error: error.message }, '[Webhook] Query error')
      return
    }

    if (!webhooks || webhooks.length === 0) return

    const payload: WebhookPayload = {
      event,
      tenant_id: tenantId,
      created_at: new Date().toISOString(),
      data,
    }

    const body = JSON.stringify(payload)

    // Deliver to each webhook in parallel
    const deliveries = webhooks.map(hook => sendWebhook(hook, body, event))
    await Promise.allSettled(deliveries)
  } catch (err) {
    logger.error(err, '[Webhook] Dispatch error')
  }
}

async function sendWebhook(
  hook: { id: string; url: string; secret: string },
  body: string,
  event: string,
  attempt = 1
): Promise<void> {
  const start = Date.now()

  // Sign the payload with HMAC-SHA256
  const signature = createHmac('sha256', hook.secret)
    .update(body)
    .digest('hex')

  // Check if body logging is enabled (protect PII — disabled by default)
  const logBodies = process.env.WEBHOOK_LOG_BODIES?.toLowerCase() === 'true'

  try {
    // SSRF protection: validate the URL before fetching
    let validatedUrl: URL
    try {
      validatedUrl = await validateWebhookUrl(hook.url)
    } catch (ssrfErr) {
      logger.error({ url: hook.url, error: ssrfErr instanceof Error ? ssrfErr.message : String(ssrfErr) }, `[Webhook] SSRF blocked delivery to ${hook.url}`)
      // Log the blocked delivery so the tenant knows it failed
      await supabase.from('webhook_deliveries').insert({
        webhook_id: hook.id,
        event_type: event,
        url: hook.url,
        request_body: null,
        response_status: null,
        response_body: null,
        status: 'failed',
        error_message: `Blocked: ${ssrfErr instanceof Error ? ssrfErr.message : 'SSRF validation failed'}`,
        duration_ms: Date.now() - start,
      })
      return
    }

    const response = await fetch(validatedUrl.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TenantScale-Webhook/1.0',
        'X-TenantScale-Event': event,
        'X-TenantScale-Signature': signature,
        'X-TenantScale-Delivery': createHash('sha256').update(body).digest('hex').slice(0, 12),
      },
      body,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    })

    const duration = Date.now() - start
    const responseText = await response.text().catch(() => '')

    // Log delivery
    await supabase.from('webhook_deliveries').insert({
      webhook_id: hook.id,
      event_type: event,
      url: hook.url,
      request_body: logBodies ? body.slice(0, 1000) : null,
      response_status: response.status,
      response_body: logBodies ? responseText.slice(0, 1000) : null,
      status: response.ok ? 'delivered' : 'failed',
      error_message: response.ok ? null : `HTTP ${response.status}`,
      duration_ms: duration,
    })

  } catch (err) {
    const duration = Date.now() - start
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'

    // Retry with exponential backoff
    if (attempt < __TEST_RETRIES.retries) {
      const delay = __TEST_RETRIES.delays[attempt - 1] ?? 5_000
      logger.warn({ attempt, maxRetries: __TEST_RETRIES.retries, url: hook.url, error: errorMsg, delay }, `[Webhook] Delivery failed, retrying in ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
      return sendWebhook(hook, body, event, attempt + 1)
    }

    // Final failure — log it
    await supabase.from('webhook_deliveries').insert({
      webhook_id: hook.id,
      event_type: event,
      url: hook.url,
      request_body: logBodies ? body.slice(0, 1000) : null,
      response_status: null,
      response_body: null,
      status: 'failed',
      error_message: `${errorMsg} (after ${__TEST_RETRIES.retries} attempts)`,
      duration_ms: duration,
    })

    logger.error({ url: hook.url, error: errorMsg, maxRetries: __TEST_RETRIES.retries }, `[Webhook] Delivery failed after ${__TEST_RETRIES.retries} attempts`)
  }
}
