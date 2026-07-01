# TenantScale API

**Multi-tenant management API for B2B SaaS — the backend powering tenant CRUD, authentication, billing, analytics, webhooks, and admin operations.**

This is the Hono-based API server that provides the management plane for TenantScale. It works alongside the open-source [SDK](https://github.com/TenantScale/sdk) to give you a full multi-tenant platform.

| Package | License | Description |
|---------|---------|-------------|
| [`packages/api`](packages/api) | **BSL 1.1** | Core API server — tenant CRUD, portal sessions, admin, billing, webhooks, analytics, metrics |
| [`packages/mcp`](packages/mcp) | **MIT** | MCP server for Claude & Cursor — lets AI tools inspect tenant data |

---

## 🔑 Licensing

- **`packages/api/`** — [BSL 1.1](LICENSE) (source available). Free to self-host in production as long as you don't compete with TenantScale's hosted service. Converts to Apache 2.0 on 2029-01-01.
- **`packages/mcp/`** — MIT (fully open).

> 💡 **The SDK** ([`@tenantscale/sdk`](https://github.com/TenantScale/sdk)) is MIT and has no restrictions whatsoever.

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/TenantScale/api.git
cd api

# Install & build
pnpm install
pnpm build

# Set up your Supabase project
cp .env.example .env
# Edit .env with your Supabase URL + service_role key

# Start dev server
pnpm dev
```

The API starts at **http://localhost:3001**.

## 📡 Endpoints

### Tenant Management
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/tenants` | Create a new tenant (returns API key) |
| `GET` | `/v1/tenants` | List tenants (admin key required) |
| `GET` | `/v1/tenants/me` | Current tenant (via API key) |
| `PATCH` | `/v1/tenants/:id` | Update tenant |
| `POST` | `/v1/tenants/:id/api-keys` | Generate API key for tenant |

### Portal (User Sessions)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/portal/register` | Sign up + create tenant |
| `GET` | `/v1/portal/me` | Current user + tenant info |
| `GET` | `/v1/portal/users` | List tenant users |
| `POST` | `/v1/portal/users/invite` | Invite user |
| `GET` | `/v1/portal/api-keys` | List API keys |
| `POST` | `/v1/portal/api-keys` | Create API key |
| `GET` | `/v1/portal/audit` | Tenant audit log |

### Admin (Cross-Tenant)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/tenants` | List all tenants |
| `GET` | `/v1/admin/tenants/:id` | Tenant detail with stats |
| `GET` | `/v1/admin/stats` | Platform stats |
| `POST` | `/v1/admin/impersonate` | Create impersonation session |

### Billing
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/subscriptions/checkout` | Create Stripe checkout session |
| `POST` | `/v1/subscriptions/portal` | Create Stripe customer portal |
| `POST` | `/webhooks/stripe` | Stripe event webhook |

### Observability
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (DB connectivity) |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/v1/status` | Version, uptime, service status |
| `POST` | `/v1/admin/cron/check-alerts` | Self-hosted alert check |

## 🧩 Architecture

```
┌──────────────────────────┐     ┌──────────────────────────┐
│   TenantScale Portal      │     │   Your App (with SDK)    │
│   (Next.js, proprietary)  │     │   (MIT, your process)    │
│   github.com/TenantScale/ │     │   github.com/TenantScale/│
│   portal                  │     │   sdk                    │
└─────────┬────────────────┘     └────────┬─────────────────┘
          │ HTTP                             │ Direct DB (service_role)
          ▼                                  ▼
┌──────────────────────────────────────────────────────────┐
│              TenantScale API (this repo)                  │
│              Hono + Supabase                              │
│                                                          │
│  /v1/tenants · /v1/portal · /v1/admin · /v1/subscriptions│
│  audit · webhooks · analytics · status · metrics          │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
               ┌──────────────────────┐
               │     Supabase/Postgres │
               │  (your infrastructure) │
               └──────────────────────┘
```

## 📦 Packages

| Package | Description |
|---------|-------------|
| [`packages/api`](packages/api) | Core Hono API server + all route handlers, middleware, and lib modules |
| [`packages/mcp`](packages/mcp) | MCP server exposing tenant data to Claude Desktop and Cursor |

## 🔧 Environment

Copy `.env.example` to `.env` with your Supabase credentials:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Optional:
```
STRIPE_SECRET_KEY=sk_...        # Billing support
STRIPE_WEBHOOK_SECRET=whsec_... # Stripe webhook verification
SENTRY_DSN=                     # Error tracking
CRON_SECRET=                    # Alert check endpoint auth
```

## 📄 License

- `packages/api/` — [BSL 1.1](LICENSE) (source available, free to self-host)
- `packages/mcp/` — MIT
