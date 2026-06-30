export const ALL_EVENTS = [
  'tenant.created',
  'tenant.updated',
  'tenant.deleted',
  'user.invited',
  'user.removed',
  'user.role_changed',
  'api_key.created',
  'api_key.revoked',
  'plan.changed',
] as const

export type WebhookEvent = (typeof ALL_EVENTS)[number]

export interface Webhook {
  id: string
  url: string
  events: WebhookEvent[]
  description: string | null
  is_active: boolean
  secret: string | null
  created_at: string
  updated_at: string
}

export interface Delivery {
  id: string
  event_type: string
  status: 'delivered' | 'failed'
  response_status: number | null
  duration_ms: number | null
  request_body: string | null
  response_body: string | null
  error_message: string | null
  created_at: string
}

export interface DeliveryPage {
  deliveries: Delivery[]
  total: number
  page: number
  limit: number
}
