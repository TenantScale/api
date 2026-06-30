# TenantScale API

**Multi-tenant SaaS backend — plan enforcement, billing, tenant management, and admin portal.**

This is the commercial backend for TenantScale. It provides the API server that B2B SaaS applications connect to for tenant isolation, rate limiting, audit logging, and plan enforcement.

## Packages

| Package | License | Description |
|---------|---------|-------------|
| `@tenantscale/api` | BSL 1.1 | Hono API server — plan enforcement, billing, webhooks, tenant CRUD |
| `@tenantscale/mcp` | MIT | MCP server for AI coding tools (Claude, Cursor, Copilot) |
| `@tenantscale/portal` | Proprietary | Customer dashboard — API keys, audit log, billing, settings |
| `@tenantscale/admin` | Proprietary | Super admin panel — tenant management, plan management |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐
│  Portal     │────▶│  API Server  │────▶│ Supabase  │
│  (Next.js)  │     │  (Hono)      │     │ (Postgres)│
└─────────────┘     └──────────────┘     └───────────┘
                           │
                    ┌──────┴──────┐
                    │  Stripe     │
                    │  (Billing)  │
                    └─────────────┘
```

The SDK (`@tenantscale/sdk` — published separately under MIT) is used as a dependency, just like any other customer would.

## Getting Started

```bash
pnpm install
pnpm --filter @tenantscale/api dev
```

Requires Supabase and Stripe credentials in `.env`.

## License

- `@tenantscale/api` — BSL 1.1 (source available, not free for production)
- `@tenantscale/portal` / `@tenantscale/admin` — Proprietary
- `@tenantscale/mcp` — MIT
