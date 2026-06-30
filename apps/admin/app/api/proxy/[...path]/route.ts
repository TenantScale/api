// ──────────────────────────────────────────────────────
// API Proxy — forwards client requests to TenantScale API
// using the admin key from server-side env (never exposed to client)
// ──────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.TENANTSCALE_API_URL ?? 'http://localhost:3001'

export async function GET(request: NextRequest) {
  return proxy(request)
}

export async function POST(request: NextRequest) {
  return proxy(request)
}

export async function PATCH(request: NextRequest) {
  return proxy(request)
}

export async function DELETE(request: NextRequest) {
  return proxy(request)
}

async function proxy(request: NextRequest) {
  // CSRF protection: validate Origin/Referer for state-changing requests
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin')
    const referer = request.headers.get('referer')
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
    ]
    const requestOrigin = origin ?? (referer ? new URL(referer).origin : null)
    if (requestOrigin) {
      try {
        const originUrl = new URL(requestOrigin)
        const allowed = allowedOrigins.some(a => { try { return new URL(a).origin === originUrl.origin } catch { return false } })
        if (!allowed) {
          console.warn(`[TenantScale Admin] CSRF blocked: ${request.method} ${request.nextUrl.pathname} from ${requestOrigin}`)
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      } catch {
        console.warn(`[TenantScale Admin] CSRF blocked (invalid origin): ${request.method} ${request.nextUrl.pathname} from ${requestOrigin}`)
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
  }

  const adminKey = process.env.TENANTSCALE_ADMIN_KEY

  // Extract the path after /api/proxy/
  const { pathname, search } = request.nextUrl
  const apiPath = pathname.replace(/^\/api\/proxy\//, '/')

  // Forward to the TenantScale API
  const targetUrl = `${API_BASE}${apiPath}${search}`

  // Build request options
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // If admin key is configured, use it (otherwise rely on the user's own auth)
  if (adminKey) {
    headers['Authorization'] = `Bearer ${adminKey}`
  }

  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' ? await request.text() : undefined,
      signal: AbortSignal.timeout(10_000),
    })

    const body = await res.text()

    return new NextResponse(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (err) {
    console.error('[TenantScale Admin] Proxy error:', err)
    return NextResponse.json({ error: 'Failed to reach TenantScale API' }, { status: 502 })
  }
}
