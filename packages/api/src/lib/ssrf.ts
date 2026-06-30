// ──────────────────────────────────────────────────────
// SSRF protection — delegates to @tenantscale/sdk
// ──────────────────────────────────────────────────────

import { validateWebhookUrl as sdkValidateWebhookUrl } from '@tenantscale/sdk'

export const validateWebhookUrl = sdkValidateWebhookUrl
