# TenantScale Portal

**Customer-facing management portal for multi-tenant B2B SaaS.**

This is the Next.js portal that lets your tenants manage their account —
view API keys, browse audit logs, manage team members, configure webhooks,
and handle billing.

> **License:** Business Source License 1.1 (BSL) — free to use and modify.
> Becomes MIT on 2029-06-01. See [LICENSE](LICENSE) for full terms.

## Prerequisites

- Node.js >= 20
- pnpm >= 9

## Setup

```bash
# Install dependencies (from repo root)
pnpm install

# Copy and fill in env vars
cp apps/portal/.env.example apps/portal/.env.local

# Start the portal dev server
pnpm dev:portal
```

Opens at **http://localhost:3003**

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `NEXT_PUBLIC_API_URL` | No | TenantScale API base URL (default: http://localhost:3001) |

## Running the Full Stack

From the repo root:

```bash
# Start both API + Portal concurrently
pnpm dev
```

## Architecture

The Portal uses a server-side proxy (`/api/proxy/[...path]`) to forward API
requests to the TenantScale API backend. This keeps the Supabase session JWT
on the server side and avoids CORS issues during development.
