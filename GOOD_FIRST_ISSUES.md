# Good First Issues — @tenantscale/api

~15 scoped, low-priority issues for OSS contributors. File them at https://github.com/TenantScale/api/issues/new

---

## 1. Add Dependabot configuration

**Description:** No `.github/dependabot.yml` exists. The repo has ~15 direct dependencies with no automated security or version updates.

**Difficulty:** `trivial`  
**Files:** `.github/dependabot.yml` (new)  
**Acceptance criteria:** Add Dependabot config for pnpm with weekly updates, grouping non-major bumps together.

---

## 2. Add CODEOWNERS file

**Description:** No auto-reviewer assignment. PRs have no automatic review assignment.

**Difficulty:** `trivial`  
**Files:** `.github/CODEOWNERS` (new)  
**Acceptance criteria:** Create CODEOWNERS that assigns `@TenantScale/maintainers` (or the repo owner) as default reviewer for all files.

---

## 3. Create CONTRIBUTING.md

**Description:** The SDK repo has a CONTRIBUTING.md but the API repo does not. Contributors have no guidance on local dev setup, test runner, or PR process.

**Difficulty:** `trivial`  
**Files:** `CONTRIBUTING.md` (new)  
**Acceptance criteria:** Create CONTRIBUTING.md covering: clone instructions, `pnpm install`, `cp .env.example .env`, `pnpm dev`, how to run tests, pre-PR checklist.

---

## 4. Create SECURITY.md

**Description:** No security policy file exists. Researchers or users who find a vulnerability have no disclosure process to follow.

**Difficulty:** `trivial`  
**Files:** `SECURITY.md` (new)  
**Acceptance criteria:** Create SECURITY.md with contact email and disclosure process. Include PGP key if applicable.

---

## 5. Add dedicated health check endpoint tests

**Description:** The `/health` endpoint is tested only incidentally via route tests. No tests cover degraded DB state, timing regression, or response shape.

**Difficulty:** `easy`  
**Files:** `packages/api/src/__tests__/routes.test.ts`, `packages/api/src/app.ts`  
**Acceptance criteria:** Add tests: health returns 200 with DB connected, health returns degraded status when DB is unreachable, status endpoint returns correct shape with version/uptime/deployment fields, Stripe configured/not-configured variants.

---

## 6. Add JSDoc to route handler functions

**Description:** Many route handlers lack JSDoc. `admin.ts` handlers have no JSDoc. `cron.ts`, `analytics.ts`, and `alerts.ts` routes are undocumented. `events.ts` has JSDoc on some but not all handlers.

**Difficulty:** `trivial`  
**Files:** `packages/api/src/routes/events.ts`, `packages/api/src/routes/admin.ts`, `packages/api/src/routes/cron.ts`, `packages/api/src/routes/analytics.ts`, `packages/api/src/routes/alerts.ts`  
**Acceptance criteria:** All route handlers have JSDoc documenting: HTTP method + path, auth requirements, expected input, response shape, possible error codes.

---

## 7. Add Zod validation for `GET /events/summary` query parameters

**Description:** The `since` and `metric` query params on `GET /v1/events/summary` are read raw from `c.req.query()` with no Zod validation. Invalid date strings or excessively long metric names are not caught.

**Difficulty:** `easy`  
**Files:** `packages/api/src/routes/events.ts`, `packages/api/src/routes/schemas.ts`  
**Acceptance criteria:** Add a `eventSummaryQuerySchema` in schemas.ts with: `since` as optional ISO date string, `metric` as optional string with max length. Wire via `zValidator('query', ...)`.

---

## 8. Add OpenAPI / Swagger documentation endpoint

**Description:** The API has no OpenAPI spec or Swagger UI. Several existing Zod schemas in `schemas.ts` could be used to auto-generate OpenAPI via `@hono/zod-openapi`.

**Difficulty:** `medium`  
**Files:** `packages/api/src/app.ts`, `packages/api/package.json`  
**Acceptance criteria:** Add `GET /openapi` returning a valid OpenAPI 3.1 spec. Add `GET /docs` with Swagger UI. Wire existing Zod schemas into path/request/response schemas. Update README with link.

---

## 9. Add Docker setup for local development

**Description:** No `Dockerfile` or `docker-compose.yml`. Local dev requires manual Supabase setup. A Docker Compose file with Supabase local + the API would simplify onboarding.

**Difficulty:** `medium`  
**Files:** `Dockerfile` (new), `docker-compose.yml` (new)  
**Acceptance criteria:** Create a multi-stage Dockerfile for the API (dev + production). Create docker-compose.yml that starts the API alongside Supabase local (or documents Supabase CLI dependency).

---

## 10. Add integration tests against a real database

**Description:** All 9 test files mock `supabase` completely. No tests run against a real database. SQL queries, migrations, and DB constraints are never exercised in tests.

**Difficulty:** `medium`  
**Files:** `packages/api/src/__tests__/*.test.ts`, `vitest.config.ts`  
**Acceptance criteria:** Add test setup that starts Supabase local (or uses testcontainers), runs migrations, and allows key tests (tenant creation, API key validation, plan lookups) against a real DB. Document required infrastructure.

---

## 11. Add CORS origin validation tests

**Description:** CORS is configured in `app.ts` but there are no tests verifying that allowed origins get correct headers or disallowed origins are blocked.

**Difficulty:** `easy`  
**Files:** `packages/api/src/__tests__/routes.test.ts`, `packages/api/src/app.ts`  
**Acceptance criteria:** Add CORS tests: allowed origin returns `Access-Control-Allow-Origin`, disallowed origin doesn't, preflight OPTIONS returns 204 with correct headers, custom `allowHeaders` are exposed.

---

## 12. Improve `.env.example` documentation

**Description:** `.env.example` is missing some optional-but-useful vars: `API_VERSION`, `VERCEL_ENV`/`VERCEL_URL`, `LOG_LEVEL` default value, `DEPLOYMENT_ID` for version tracking.

**Difficulty:** `trivial`  
**Files:** `packages/api/.env.example`  
**Acceptance criteria:** Add missing optional env vars with clear comments explaining purpose and default values.

---

## 13. Add database seed data script

**Description:** No seed script exists to populate dev/test databases with starter data (plans, sample tenants, API keys). Developers must manually insert data after running migrations.

**Difficulty:** `easy`  
**Files:** `packages/api/src/scripts/seed.ts` (new), `packages/api/package.json`  
**Acceptance criteria:** Create a seed script that inserts 3 plans (Free, Hobby, Pro) with proper feature flags, a sample tenant, and a sample API key. Add `"seed"` npm script to `package.json`.

---

## 14. Add API versioning strategy documentation

**Description:** Routes are under `/v1` but no documentation explains versioning convention, deprecation policy, or how to introduce v2.

**Difficulty:** `trivial`  
**Files:** `packages/api/README.md`  
**Acceptance criteria:** Add a "Versioning" section to README explaining: URL-based versioning (`/v1/`), deprecation header policy (`Sunset` + `Deprecation` headers), minimum notice period, migration guide.

---

## 15. Improve setup-stripe-products error handling

**Description:** The Stripe setup script lacks handling for Stripe API rate limits (429 errors), network timeouts, and partial failures. It also doesn't resume if interrupted mid-run.

**Difficulty:** `easy`  
**Files:** `packages/api/src/scripts/setup-stripe-products.ts`  
**Acceptance criteria:** Add retry logic with exponential backoff for Stripe API errors. Abort on unrecoverable errors with clear message. Report partial success/failure per plan. Make the script idempotent so re-running picks up where it left off.

---

## 16. Standardize rate limit error responses

**Description:** The DDOS guard returns `{ error: 'Too many requests', retry_after: number }` while the plan-based rate limiter returns a different shape. This inconsistency makes client-side error handling harder.

**Difficulty:** `easy`  
**Files:** `packages/api/src/middleware/rate-limit.ts`  
**Acceptance criteria:** Both middleware return the same error shape: `{ error: string, code: string, retry_after?: number }`. Plan rate limiter also returns `Retry-After` header. Existing tests updated to match.
