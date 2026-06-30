// ──────────────────────────────────────────────────────
// Portal API Proxy — forwards client requests to TenantScale API
// using the user's Supabase session JWT (never exposed to client)
// ──────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

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
          console.warn(`[TenantScale Portal] CSRF blocked: ${request.method} ${request.nextUrl.pathname} from ${requestOrigin}`)
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      } catch {
        console.warn(`[TenantScale Portal] CSRF blocked (invalid origin): ${request.method} ${request.nextUrl.pathname} from ${requestOrigin}`)
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
  }

  // Extract the path after /api/proxy/
  const { pathname, search } = request.nextUrl
  const apiPath = pathname.replace(/^\/api\/proxy\//, '/')

  // Get the user's session token from the request cookie
  // The Supabase session cookie is set by @supabase/ssr
  const cookies = request.cookies
  const sbAccessToken =
    cookies.get('sb-access-token')?.value ??
    cookies.get('supabase-auth-token')?.value

  // Forward to the TenantScale API
  const targetUrl = `${API_BASE}${apiPath}${search}`

  // Build request options
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Forward the Supabase session JWT as Bearer token
  if (sbAccessToken) {
    headers['Authorization'] = `Bearer ${sbAccessToken}`
  }

  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
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
    console.error('[TenantScale Portal] Proxy error:', err)
    return NextResponse.json({ error: 'Failed to reach TenantScale API' }, { status: 502 })
  }
}
