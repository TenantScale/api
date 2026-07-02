# Contributing to TenantScale API

First off, thanks for taking the time to contribute! 🎉

> **Every contributor gets listed in our README.** Whether it's a typo fix, a new endpoint, or a test improvement — you show up.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [What We're Building](#what-were-building)
- [🎯 Good First Issues](#-good-first-issues)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Code Style & Quality](#code-style--quality)
- [Getting Help](#getting-help)

---

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the maintainers.

---

## What We're Building

TenantScale API is the **management plane** for multi-tenant B2B SaaS apps. It handles:

- **Tenant CRUD** — Create, read, update, and delete tenants
- **API Key Management** — Generate, revoke, and scope API keys
- **Billing & Plans** — Stripe integration for subscription management
- **Portal Sessions** — JWT-based admin portal authentication
- **Audit Logging** — Track every tenant-level change
- **Analytics** — Usage metrics per tenant, per plan
- **Webhook Delivery** — Configurable webhook dispatch with retries
- **Rate Limiting** — IP and plan-based rate enforcement
- **Health & Status** — API health checks and deployment metadata

The API is built with [Hono.js](https://hono.dev/) on [Supabase](https://supabase.com/) (PostgreSQL + Auth) and is designed to be self-hosted or used through the TenantScale cloud.

**The mission:** Make multi-tenancy a 10-minute setup instead of a 2-month project.

---

## 🎯 Good First Issues

These are issues specifically scoped for first-time contributors. Each should take **a few hours to a weekend** to complete.

Browse them on GitHub: [github.com/TenantScale/api/issues?q=is%3Aopen+label%3A%22good+first+issue%22](https://github.com/TenantScale/api/issues?q=is%3Aopen+label%3A%22good+first+issue%22)

### Beginner

| Issue | What You'll Do | Skills |
|-------|---------------|--------|
| **Improve .env.example documentation** | Add missing optional env vars with clear comments | Markdown |
| **Add JSDoc to route handlers** | Document undocumented endpoint handlers | TypeScript |
| **Add API versioning docs** | Write the versioning policy in README | Markdown |
| **Create SECURITY.md** | Write a security disclosure policy | Markdown |
| **Fix typos / improve docs** | Clean up documentation across the repo | English, Markdown |

### Intermediate

| Issue | What You'll Do | Skills |
|-------|---------------|--------|
| **Add Zod validation for query params** | Add schema validation to raw query params | TypeScript, Zod |
| **Add CORS origin validation tests** | Write tests verifying CORS header behavior | TypeScript, Vitest |
| **Add database seed data script** | Create a script to populate dev DB with starter data | TypeScript, Supabase |
| **Improve stripe setup error handling** | Add retry logic, idempotency to the Stripe setup script | TypeScript, Stripe |
| **Standardize rate limit error responses** | Make DDOS guard and plan rate limiter return consistent error shapes | TypeScript |
| **Add health check endpoint tests** | Write tests for degraded DB state, response shape | TypeScript, Vitest |
| **Add Dependabot config** | Automate dependency updates | YAML |
| **Add CODEOWNERS file** | Auto-assign PR reviewers | GitHub |

### Advanced

| Issue | What You'll Do | Skills |
|-------|---------------|--------|
| **Add OpenAPI / Swagger docs** | Auto-generate OpenAPI spec from Zod schemas | TypeScript, OpenAPI |
| **Add Docker setup** | Create Dockerfile + docker-compose for local dev | Docker, Supabase |
| **Add integration tests with real DB** | Write tests against a real Supabase instance | TypeScript, PostgreSQL, TestContainers |

> **Don't see something you like?** Open an issue or start a [Discussion](https://github.com/TenantScale/sdk/discussions) with your idea.

---

## Getting Started

### Prerequisites

- **Node.js** >= 20 (we recommend using [nvm](https://github.com/nvm-sh/nvm) — `.nvmrc` is included)
- **pnpm** >= 9 (install via `npm install -g pnpm` or `corepack enable && corepack prepare pnpm@latest --activate`)
- **Supabase CLI** (optional — needed for full local development with a real database)
  - Install: `npm install -g supabase` or `winget install supabase.cli`
  - Or use the [Supabase dashboard](https://supabase.com) for a remote project

### Quick Setup

```bash
# Clone the repo
git clone https://github.com/TenantScale/api.git
cd api

# Install dependencies
pnpm install

# Copy environment variables
cp packages/api/.env.example packages/api/.env

# Build
pnpm build

# Run tests
pnpm test
```

### Full Local Development (with Supabase)

```bash
# Start local Supabase
supabase start

# Get the local connection string
supabase status

# Set DATABASE_URL in packages/api/.env to the local Supabase URL
# Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the local values

# Run migrations
# (Supabase local applies migrations from supabase/migrations/ automatically)

# Run the API
pnpm dev
```

The API will start at `http://localhost:3001`.

### Common Commands

```bash
pnpm dev              # Start the API in watch mode (hot reload)
pnpm build            # Compile TypeScript
pnpm start            # Start the compiled production server
pnpm test             # Run all tests
pnpm test -- --filter=@tenantscale/api   # Same — single package
pnpm test -- --coverage                   # Generate coverage report
pnpm lint             # Lint source files
```

### Environment Variables

The API requires these environment variables (see `packages/api/.env.example` for defaults):

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key (admin access) |
| `SUPABASE_ANON_KEY` | ✅ | Anon key (for portal session validation) |
| `API_SECRET` | ✅ | Secret for internal cron/webhook routes |
| `JWT_SECRET` | ✅ | Secret for portal session JWT signing |
| `STRIPE_SECRET_KEY` | 🟡 | Stripe secret key (for billing) |
| `STRIPE_WEBHOOK_SECRET` | 🟡 | Stripe webhook signing secret |
| `PORT` | ❌ | Server port (default: 3001) |
| `LOG_LEVEL` | ❌ | Pino log level (default: "info") |

> **Note:** Tests run with mocked Supabase — you don't need to configure Supabase to run `pnpm test`.

---

## Project Structure

```
tenantscale-api/
├── packages/
│   └── api/                   # The API application (@tenantscale/api)
│       ├── src/
│       │   ├── index.ts        # Server entry point
│       │   ├── app.ts          # Hono app setup — middleware, routes, error handling
│       │   ├── config.ts       # Environment config parsing
│       │   ├── routes/         # Route handlers organized by domain
│       │   │   ├── tenants.ts      # Tenant CRUD endpoints
│       │   │   ├── api-keys.ts     # API key management
│       │   │   ├── portal.ts       # Portal sessions
│       │   │   ├── webhooks.ts     # Webhook management
│       │   │   ├── subscriptions.ts # Stripe subscription integration
│       │   │   ├── invoices.ts     # Stripe invoice management
│       │   │   ├── analytics.ts    # Usage analytics
│       │   │   ├── events.ts       # Event/audit log queries
│       │   │   ├── status.ts       # Health check
│       │   │   ├── cron.ts         # Scheduled maintenance tasks
│       │   │   ├── alerts.ts       # Alert configuration
│       │   │   ├── admin.ts        # Super admin operations
│       │   │   ├── plans.ts        # Plan definitions
│       │   │   └── metrics.ts      # Prometheus metrics
│       │   ├── middleware/     # Hono middleware
│       │   │   ├── auth.ts        # Auth middleware (API key validation)
│       │   │   ├── session-auth.ts # Portal session auth middleware
│       │   │   └── rate-limit.ts  # Rate limiting middleware
│       │   ├── lib/           # Core business logic
│       │   │   ├── supabase.ts    # Supabase client initialization
│       │   │   ├── auth.ts        # API key + scope verification
│       │   │   ├── sdk.ts         # TenantScale SDK wrapper
│       │   │   ├── plan-store.ts  # Plan/feature resolution
│       │   │   ├── pagination.ts  # Pagination helpers
│       │   │   ├── response.ts    # Standard API response shapes
│       │   │   ├── stripe.ts      # Stripe billing logic
│       │   │   ├── metrics.ts     # Prometheus metrics setup
│       │   │   ├── webhook.ts     # Webhook delivery logic
│       │   │   ├── audit.ts       # Audit event helpers
│       │   │   ├── api-key.ts     # API key generation
│       │   │   ├── ssrf.ts        # SSRF protection for webhook URLs
│       │   │   └── errors.ts      # Error classes
│       │   ├── db/             # Database utilities
│       │   │   └── supabase.ts    # Supabase schema types
│       │   ├── schemas/        # Zod schemas (TODO)
│       │   │   └── ...           # Route-specific schemas
│       │   ├── scripts/        # CLI scripts
│       │   │   ├── setup-stripe-products.ts  # One-time Stripe product setup
│       │   │   └── seed.ts                   # Database seeding (TODO)
│       │   └── __tests__/      # Vitest test suite (370+ tests)
│       ├── api/               # Vercel serverless bundle output
│       ├── vercel.json        # Vercel deployment configuration
│       └── .env.example       # Environment variable template
├── .github/
│   └── workflows/ci.yml       # CI pipeline (build + test)
├── supabase/
│   └── migrations/            # Database migrations
├── vitest.config.ts           # Vitest configuration
└── turbo.json                 # Turborepo configuration
```

### Key Architecture Decisions

- **Hono.js** — Lightweight, fast, TypeScript-native web framework
- **Supabase** — PostgreSQL with built-in Auth and RLS
- **Service-role pattern** — All API routes use the Supabase service role key (RLS is bypassed). The API itself enforces auth and tenant isolation.
- **Zod validation** — All request bodies are validated with Zod schemas (see `schemas/`)
- **Pino logging** — Structured JSON logging with request IDs and error context
- **esbuild bundle** — Deployed as a single bundled file on Vercel (serverless)

---

## Development Workflow

### 1. Find or Create an Issue

- Browse [good first issues](https://github.com/TenantScale/api/issues?q=is%3Aopen+label%3A%22good+first+issue%22) or [help wanted](https://github.com/TenantScale/api/issues?q=is%3Aopen+label%3A%22help+wanted%22) labels
- Comment on the issue to let others know you're working on it
- If you have a new idea, open a feature request first

### 2. Fork & Branch

```bash
git checkout -b feat/my-feature          # New feature
git checkout -b fix/description          # Bug fix
git checkout -b docs/description         # Documentation
```

Branch naming:
- `feat/` — new features or endpoints
- `fix/` — bug fixes
- `docs/` — documentation
- `refactor/` — code improvements without behaviour change
- `test/` — adding or fixing tests

### 3. Make Changes

```bash
# Start the dev server (auto-reload on changes)
pnpm dev

# Run tests in watch mode
cd packages/api && pnpm exec vitest --watch
```

### 4. Run Tests

```bash
# Full test suite (expect this to pass before pushing)
pnpm test

# With coverage
cd packages/api && pnpm exec vitest run --coverage

# Run a single test file
cd packages/api && pnpm exec vitest run src/__tests__/tenants.test.ts

# Run tests matching a pattern
cd packages/api && pnpm exec vitest run -t "health"
```

### 5. Commit

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): description in imperative mood
│      │
│      └─ scope: tenants, api-keys, billing, middleware, lib, etc.
│
└─ type: feat, fix, chore, docs, refactor, test, perf, ci, style
```

**Examples:**

```bash
git commit -m "feat(tenants): add tenant search by domain"
git commit -m "fix(api-keys): handle missing scope gracefully"
git commit -m "docs(events): add JSDoc to event summary handler"
git commit -m "test(cors): verify preflight OPTIONS response"
```

### 6. Push & Open a PR

```bash
git push -u origin HEAD
```

Then open a pull request on GitHub targeting `main`. Link the issue you're fixing in the description.

---

## Making Changes

### Adding a New Endpoint

1. **Define schemas** in `packages/api/src/routes/schemas.ts` (Zod validation for body, params, query)
2. **Create the route handler** in `packages/api/src/routes/` — follow the existing pattern:
   ```typescript
   import { zValidator } from '@hono/zod-validator'
   import { z } from 'zod'
   
   const mySchema = z.object({ ... })
   
   app.post('/v1/my-resource', zValidator('json', mySchema), async (c) => {
     // ... handler logic
     return c.json({ data: result }, 201)
   })
   ```
3. **Register the route** in `packages/api/src/app.ts`
4. **Add tests** in `packages/api/src/__tests__/`

### Adding a New Middleware

1. Create the file in `packages/api/src/middleware/`
2. Export a Hono middleware function
3. Register it in `packages/api/src/app.ts` (global or per-route)
4. Add tests

### Adding a New Lib Module

1. Create the file in `packages/api/src/lib/`
2. Export pure functions where possible (testable without mocks)
3. Import from centralized `supabase.ts` client for DB access
4. Use `logger` from the config for structured logging
5. Add tests in `packages/api/src/__tests__/`

### Testing Patterns

The test suite uses **Vitest** with mocked Supabase:

```typescript
// Create a mock Supabase client
const mockSupabase = createMockSupabase()

// Mock specific queries
mockSupabase.from('tenants').select.mockResolvedValue({
  data: [{ id: 'tenant-1', name: 'Test' }],
  error: null,
})

// Test error cases
mockSupabase.from('tenants').select.mockResolvedValue({
  data: null,
  error: new Error('DB connection failed'),
})
```

See existing test files in `packages/api/src/__tests__/` for patterns.

---

## Pull Request Process

### Before you open

- [ ] All tests pass locally (`pnpm test`)
- [ ] `pnpm build` completes without errors
- [ ] `pnpm lint` reports zero errors
- [ ] New code has corresponding tests
- [ ] Changed public API is documented
- [ ] PR description explains _what_ and _why_

### CI checks

When you open a PR, CI automatically runs:

1. **Lint** — ESLint (warnings don't block)
2. **Build** — TypeScript compilation
3. **Test** — Full test suite with coverage
4. **Coverage** — Report generated (doesn't block)

All must pass before merge. If a check fails, check the Actions tab for details.

### Merge

PRs are **squash merged** into `main`. The squash commit title becomes the changelog entry.

---

## Code Style & Quality

| Rule | Standard |
|------|----------|
| **Language** | TypeScript with strict mode |
| **Formatting** | Prettier (run `pnpm format` before committing) |
| **Linting** | ESLint with `typescript-eslint` |
| **Testing** | Vitest — tests in `src/__tests__/` |
| **Coverage** | Aim for 80%+ on new code |
| **Logging** | Use `logger` from config, never `console.log` |
| **Errors** | Use `TenantScaleError` classes from `lib/errors.ts` |
| **Async** | Always `await` or explicitly `.catch()` |
| **Imports** | Use `.js` extensions in source files (ESM convention) |
| **Response shape** | Always return `{ data, error }` or `{ error }` consistently |

### Response Conventions

Successful responses follow this shape:

```typescript
// Single resource
{ data: { id: string, ... } }

// List with pagination
{ data: [...], total: number, page: number, limit: number }

// Created resource
{ data: { id: string, ... } }  // status 201
```

Error responses follow this shape:

```typescript
{ error: string, code: string, details?: unknown }
```

---

## Getting Help

- **GitHub Discussions:** [Start a discussion](https://github.com/TenantScale/sdk/discussions) — best for longer conversations
- **Issues:** Open an issue for bugs or feature requests
- **Maintainers:** Tag `@TenantScale/maintainers` in your PR for review

### Issue Labels

| Label | Meaning |
|-------|---------|
| `good first issue` | Perfect for first-time contributors |
| `help wanted` | Maintainers would love help with this |
| `needs reproduction` | Bug needs a minimal reproduction |
| `blocked` | Waiting on something else |
| `design needed` | Needs discussion before implementation |

---

*Thank you for contributing to TenantScale API! 🚀*
