// ──────────────────────────────────────────────────────
// Email service — transactional email delivery
// ──────────────────────────────────────────────────────
// Uses Resend (https://resend.com) for email delivery.
//
// To enable:
//   1. Sign up at https://resend.com
//   2. Verify a domain (e.g., tenantscale.com)
//   3. Create an API key
//   4. Set RESEND_API_KEY in .env
//   5. Set RESEND_FROM (e.g., "TenantScale <noreply@tenantscale.com>")
//
// All send* functions gracefully return without error when
// RESEND_API_KEY is not set — emails are logged instead.
// ──────────────────────────────────────────────────────

import { logger } from './logger.js'

// ── Client ──

interface ResendPayload {
  from?: string
  to: string | string[]
  subject: string
  html: string
  text?: string
  tags?: Array<{ name: string; value: string }>
}

async function sendEmail(payload: ResendPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    logger.info(
      { to: payload.to, subject: payload.subject },
      '[Email] RESEND_API_KEY not set — email not sent (logged)',
    )
    return false
  }

  const from = process.env.RESEND_FROM || 'TenantScale <noreply@tenantscale.com>'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, from }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown')
      logger.error({ status: res.status, body }, '[Email] Failed to send')
      return false
    }

    logger.info({ to: payload.to, subject: payload.subject }, '[Email] Sent')
    return true
  } catch (err) {
    logger.error({ err }, '[Email] Failed to send — network error')
    return false
  }
}

// ── Templates ──

function welcomeHtml(name: string, tenantName: string, apiKey: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #080b18; color: #e2e8f0; padding: 40px 20px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background: #0f1322; border: 1px solid #1e293b; border-radius: 16px; padding: 32px;">
        <tr><td align="center" style="padding-bottom: 24px;">
          <span style="font-size: 24px; font-weight: 700; color: #e2e8f0;">TenantScale</span>
        </td></tr>
        <tr><td style="padding-bottom: 16px;">
          <h1 style="font-size: 20px; font-weight: 600; margin: 0; color: #e2e8f0;">Welcome to TenantScale, ${name}!</h1>
        </td></tr>
        <tr><td style="padding-bottom: 16px;">
          <p style="font-size: 15px; line-height: 1.5; color: #94a3b8; margin: 0;">
            Your tenant <strong style="color: #e2e8f0;">${tenantName}</strong> has been created and is ready to go.
          </p>
        </td></tr>
        <tr><td style="padding-bottom: 24px;">
          <p style="font-size: 15px; line-height: 1.5; color: #94a3b8; margin: 0;">
            Here's your default API key — save it somewhere safe. You won't see it again:
          </p>
          <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; margin-top: 12px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; color: #00E5D1; word-break: break-all;">
            ${apiKey}
          </div>
        </td></tr>
        <tr><td align="center" style="padding-bottom: 16px;">
          <a href="${process.env.PORTAL_URL ?? 'http://localhost:3003'}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #00E5D1); color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Go to Dashboard
          </a>
        </td></tr>
        <tr><td style="padding-top: 16px; border-top: 1px solid #1e293b;">
          <p style="font-size: 12px; color: #64748b; margin: 0;">
            If you didn't sign up for TenantScale, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function inviteHtml(inviterName: string, tenantName: string, portalUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #080b18; color: #e2e8f0; padding: 40px 20px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background: #0f1322; border: 1px solid #1e293b; border-radius: 16px; padding: 32px;">
        <tr><td align="center" style="padding-bottom: 24px;">
          <span style="font-size: 24px; font-weight: 700; color: #e2e8f0;">TenantScale</span>
        </td></tr>
        <tr><td style="padding-bottom: 16px;">
          <h1 style="font-size: 20px; font-weight: 600; margin: 0; color: #e2e8f0;">You've been invited!</h1>
        </td></tr>
        <tr><td style="padding-bottom: 16px;">
          <p style="font-size: 15px; line-height: 1.5; color: #94a3b8; margin: 0;">
            <strong style="color: #e2e8f0;">${inviterName}</strong> has invited you to join
            <strong style="color: #e2e8f0;">${tenantName}</strong> on TenantScale.
          </p>
        </td></tr>
        <tr><td align="center" style="padding-bottom: 16px;">
          <a href="${portalUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #00E5D1); color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Open Dashboard
          </a>
        </td></tr>
        <tr><td style="padding-top: 16px; border-top: 1px solid #1e293b;">
          <p style="font-size: 12px; color: #64748b; margin: 0;">
            If you weren't expecting this invitation, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ── Send functions ──

export interface SendWelcomeEmailOptions {
  email: string
  name?: string
  tenantName: string
  apiKey: string
}

export async function sendWelcomeEmail(opts: SendWelcomeEmailOptions): Promise<boolean> {
  return sendEmail({
    to: opts.email,
    subject: 'Welcome to TenantScale — Your tenant is ready',
    html: welcomeHtml(opts.name ?? opts.email, opts.tenantName, opts.apiKey),
    tags: [{ name: 'purpose', value: 'welcome' }],
  })
}

export interface SendInviteEmailOptions {
  email: string
  inviterName: string
  tenantName: string
  portalUrl: string
}

export async function sendInviteEmail(opts: SendInviteEmailOptions): Promise<boolean> {
  return sendEmail({
    to: opts.email,
    subject: `${opts.inviterName} invited you to ${opts.tenantName} on TenantScale`,
    html: inviteHtml(opts.inviterName, opts.tenantName, opts.portalUrl),
    tags: [{ name: 'purpose', value: 'invite' }],
  })
}

export interface SendPasswordResetEmailOptions {
  email: string
  resetLink: string
}

/**
 * Send a password reset email.
 * Note: if using Supabase Auth with SMTP configured, Supabase sends this
 * automatically. This function is provided for custom auth adapters or
 * as a fallback when Supabase SMTP is not configured.
 */
export async function sendPasswordResetEmail(opts: SendPasswordResetEmailOptions): Promise<boolean> {
  return sendEmail({
    to: opts.email,
    subject: 'Reset your TenantScale password',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #080b18; color: #e2e8f0; padding: 40px 20px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background: #0f1322; border: 1px solid #1e293b; border-radius: 16px; padding: 32px;">
        <tr><td align="center" style="padding-bottom: 24px;">
          <span style="font-size: 24px; font-weight: 700; color: #e2e8f0;">TenantScale</span>
        </td></tr>
        <tr><td style="padding-bottom: 16px;">
          <h1 style="font-size: 20px; font-weight: 600; margin: 0; color: #e2e8f0;">Reset your password</h1>
        </td></tr>
        <tr><td style="padding-bottom: 16px;">
          <p style="font-size: 15px; line-height: 1.5; color: #94a3b8; margin: 0;">
            Someone requested a password reset for your account. Click the button below to set a new password.
          </p>
        </td></tr>
        <tr><td align="center" style="padding-bottom: 16px;">
          <a href="${opts.resetLink}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #00E5D1); color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Reset Password
          </a>
        </td></tr>
        <tr><td style="padding-top: 16px; border-top: 1px solid #1e293b;">
          <p style="font-size: 12px; color: #64748b; margin: 0;">
            If you didn't request this, you can safely ignore this email. The link expires in 1 hour.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    tags: [{ name: 'purpose', value: 'password_reset' }],
  })
}
