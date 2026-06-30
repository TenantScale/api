# API Package Audit Report — TenantScale

**Audit date**: 2026-06-27  
**Scope**: All `.ts` files in `packages/api/` plus config files  
**Previous audits cleaned ~87 issues** — this report captures remaining findings.

---

## Issue Table (82 items)

| # | Severity | Area | File:Line | Problem | Suggested Fix |
|---|---|---|---|---|---|
| 1 | 🔴 | Git/CI | packages/api/tsconfig.json | No `outDir` set; `tsc` emits 27 `.js` files alongside `.ts` in `src/` (polluting the tree) | Set `"outDir": "./dist"` and add `src/**/*.js` to `.eslintignore` / `.gitignore` |
| 2 | 🔴 | Logging | packages/api/src/app.ts:55 | `pinoHttp` imported but never used (dead import) | Remove the import |
| 3 | 🔴 | Logging | packages/api/src/app.ts:149 | `console.error` in global error handler instead of pino logger | Use the `logger` instance: `logger.error(err, 'Unhandled error')` |
| 4 | 🔴 | Logging | packages/api/src/lib/audit.ts:31 | `console.error` instead of structured pino logging | Import and use pino logger (or export logger from app.ts) |
| 5 | 🔴 | Logging | packages/api/src/lib/webhook-dispatcher.ts:26,45,123,141 | 4× `console.error`/`console.warn` instead of pino | Replace with structured logger calls |
| 6 | 🔴 | Logging | packages/api/src/middleware/auth.ts:65 | `console.warn` instead of pino | Use structured logger |
| 7 | 🔴 | Logging | packages/api/src/routes/tenants.ts:103 | `console.warn` instead of pino | Use structured logger |
| 8 | 🔴 | Logging | packages/api/src/routes/events.ts:34-37 | `console.warn` about tech debt instead of structured log | Use pino logger with a dedicated warning level |
| 9 | 🔴 | Logging | packages/api/src/lib/shared-admin.ts:566 | `console.error` for registration failure | Use pino logger |
| 10 | 🟡 | Resilience | packages/api/src/index.ts:19-23 | No graceful shutdown handler (SIGTERM/SIGINT) | Add `process.on('SIGTERM', ...)` to close server gracefully |
| 11 | 🟡 | Resilience | packages/api/src/index.ts:8 | No timeout on `process.env.PORT` parsing | Add fallback validation |
| 12 | 🔴 | Error Handling | packages/api/src/lib/audit.ts:20-33 | `logAuditEvent` swallows all errors (empty catch with console.error) | At minimum, re-throw or attach to a global error aggregator |
| 13 | 🔴 | Error Handling | packages/api/src/app.ts:83 | Empty catch block on health check DB ping (`catch { /* db ping failed */ }`) | At minimum log the error with logger |
| 14 | 🟡 | Error Handling | packages/api/src/lib/webhook-dispatcher.ts:25-27 | Fire-and-forget `void deliverWebhooks(...)` — top-level rejection only logged, caller gets no feedback | Consider adding queue/retry or at minimum track failure metrics |
| 15 | 🟡 | Error Handling | packages/api/src/middleware/auth.ts:60-66 | Fire-and-forget `last_used_at` update — errors only logged, never surfaced | Acceptable pattern but should use pino not console |
| 16 | 🟡 | Error Handling | packages/api/src/routes/tenants.ts:98-104 | Same fire-and-forget `last_used_at` pattern | Same as #15 |
| 17 | 🟡 | Error Handling | packages/api/src/lib/shared-admin.ts:259 | `dispatchWebhook` called without `await` or `.catch()` — fire-and-forget | At minimum add `.catch()` with structured logging |
| 18 | 🟡 | Error Handling | packages/api/src/lib/shared-admin.ts:311-312 | Same fire-and-forget `dispatchWebhook` | Same as #17 |
| 19 | 🟡 | Error Handling | packages/api/src/routes/portal.ts:547 | Same fire-and-forget `dispatchWebhook` | Same as #17 |
| 20 | 🟡 | Error Handling | packages/api/src/lib/shared-admin.ts:450 | Transfer-ownership rollback: `await supabase.from(...)` not in try/catch — could throw | Wrap in try/catch |
| 21 | 🟡 | Error Handling | packages/api/src/lib/shared-admin.ts:521 | Empty catch block (`catch { /* best-effort cleanup */ }`) | At minimum log the error |
| 22 | 🟡 | Error Handling | packages/api/src/lib/shared-admin.ts:565 | Empty catch block | Same as #21 |
| 23 | 🟡 | Error Handling | packages/api/src/routes/portal.ts:511 | `catch (() => {})` — empty catch on user deletion rollback | Log the suppression |
| 24 | 🟡 | Error Handling | packages/api/src/routes/portal.ts:521-522 | Empty catch blocks on cleanup | Log the suppression |
| 25 | 🟡 | Error Handling | packages/api/src/routes/portal.ts:565 | Empty catch block on cleanup | Log the suppression |
| 26 | 🔴 | API Design | packages/api/src/routes/tenants.ts:118-127 | `GET /tenants` uses hardcoded `.limit(50)` — no pagination params, no pagination metadata in response | Add `getPaginationParams` + `paginationResponse` like other list endpoints |
| 27 | 🔴 | API Design | packages/api/src/lib/shared-admin.ts:179 | `GET .../tenants/:id/users` — no pagination (unpaginated list of users) | Add pagination params (or at minimum a limit) |
| 28 | 🟡 | API Design | packages/api/src/routes/portal.ts:98 | `GET /portal/users` — no pagination | Add pagination |
| 29 | 🟡 | API Design | packages/api/src/lib/shared-admin.ts:336-348 | `GET .../api-keys` — no pagination | Add pagination for large key sets |
| 30 | 🟡 | API Design | packages/api/src/routes/portal.ts:278-290 | `GET /portal/api-keys` — no pagination | Add pagination |
| 31 | 🔴 | API Design | packages/api/src/lib/response.ts:12 | `as unknown as Response` cast — the return type is declared as `Response` but returns `c.json(...)` which is `Response | Promise<Response>` | Fix return type to `Response | Promise<Response>` or remove unnecessary cast |
| 32 | 🟡 | API Design | packages/api/src/routes/audit.ts:25 | `actor_type: 'user'` is hardcoded for SDK audit events — ignores `body.actor_type` | Accept `actor_type` from request body (with schema validation) |
| 33 | 🟡 | API Design | packages/api/src/routes/tenants.ts:68 | Response returns raw Supabase `tenant` object (includes `features`, `config`, `settings` etc.) on create | Consider returning a leaner response shape |
| 34 | 🟡 | Consistency | packages/api/src/routes/schemas.ts:37 | Default scopes `['read', 'write']` for API keys from SDK, but `['read']` for portal (line 132) | Inconsistency may be intentional but should be documented |
| 35 | 🟢 | Consistency | packages/api/src/routes/webhooks.ts | Routes registered at `/v1/admin/tenants/:id/webhooks` but comment/doc in app.ts doesn't list them | Update app.ts endpoint comment block |
| 36 | 🟡 | Consistency | packages/api/src/middleware/session-auth.ts:83,95 | `user.email ?? ''` — empty string fallback silently loses email | Keep as `null` and let consumers handle |
| 37 | 🟢 | Consistency | packages/api/src/routes/portal.ts:113,116 | Hardcoded fallback email `'unknown@email.com'` | Use `'unknown'` or `null` for consistency |
| 38 | 🔴 | Security | packages/api/src/lib/webhook-dispatcher.ts:84 | `WEBHOOK_LOG_BODIES` defaults to `true` — sensitive PII may be logged in webhook_deliveries table | Default to `false` or add explicit opt-in |
| 39 | 🟡 | Security | packages/api/src/routes/schemas.ts:89-93 | `createImpersonationSchema` has no validation that `target_user_id` and `target_tenant_id` are valid UUIDs that belong together (validated at runtime in handler, but schema could be tighter) | Add custom refinement |
| 40 | 🟢 | Security | packages/api/src/middleware/auth.ts:52-57 | `raw` API key stored in context and accessible throughout request lifecycle | Consider clearing `raw` after use; low severity since it's in-memory per-request |
| 41 | 🟢 | Security | packages/api/src/routes/admin.ts:46 | `POST /auth/impersonate` accepts `{ token }` from JSON body — no validation schema | Add `z.object({ token: z.string() })` validation |
| 42 | 🔴 | Database | packages/api/src/lib/shared-admin.ts:165-175 | N+1: After fetching tenant, two separate queries for user count and key count | Combine with `select('*, tenant_users(count), api_keys(count)')` or a view |
| 43 | 🔴 | Database | packages/api/src/lib/shared-admin.ts:193 | `supabase.auth.admin.listUsers()` fetches ALL auth users (max 1000) per request — doesn't scale | Cache auth user data in a local `user_profiles` table and join |
| 44 | 🔴 | Database | packages/api/src/routes/portal.ts:112 | Same `listUsers()` scalability issue for user enrichment | Same as #43 |
| 45 | 🔴 | Database | packages/api/src/routes/portal.ts:128 | Same `listUsers()` in user invite flow | Same as #43 |
| 46 | 🟡 | Database | packages/api/src/lib/shared-admin.ts:157-175 | Non-atomic stats fetch — tenant and stats are fetched in separate queries (race condition possible) | Use a Supabase RPC or single query |
| 47 | 🟡 | Database | packages/api/src/routes/portal.ts:147-168 | Multiple back-to-back queries for plan/user limit check — could be a single query with join | Consolidate into one query |
| 48 | 🟢 | Database | packages/api/src/lib/shared-admin.ts:272 | `.update(body)` passes raw validated body — could update fields that shouldn't be writable | Explicitly whitelist updatable fields |
| 49 | 🟡 | Database | packages/api/src/lib/shared-admin.ts:470-477 | Same pattern as #48 for plans | Same fix |
| 50 | 🟡 | Clean Code | packages/api/src/lib/api-key.ts:18 | Magic string `'tk_'` prefix hardcoded | Extract to const `API_KEY_PREFIX = 'tk_'` |
| 51 | 🟡 | Clean Code | packages/api/src/app.ts:93 | Magic CORS origins hardcoded as fallback | Extract to config/constants |
| 52 | 🟡 | Clean Code | packages/api/src/app.ts:86 | Hardcoded version string `'0.1.0'` | Read from package.json or env var |
| 53 | 🟡 | Clean Code | packages/api/src/lib/pagination.ts:26 | Magic number `100` max limit hardcoded | Extract to `const MAX_PAGE_LIMIT = 100` |
| 54 | 🟢 | Clean Code | packages/api/src/lib/webhook-dispatcher.ts:75-76 | Hardcoded `MAX_RETRIES = 3` and `RETRY_DELAYS` array | Extract to module-level constants |
| 55 | 🟢 | Clean Code | packages/api/src/routes/events.ts:8-10 | Architectural tech debt documented in comment — good but should be tracked in ADR or issue tracker | Create GH issue / ADR entry |
| 56 | 🟢 | Clean Code | packages/api/src/routes/events.ts:22 | Module-level mutable state `_warnedAboutEventsTable` — side-effectful pattern | Use a Set or config flag in a singleton |
| 57 | 🟡 | Clean Code | packages/api/src/lib/shared-admin.ts:226 | `apiKeyInsert` typed as `Record<string, unknown>` loses type safety | Use a typed insert object |
| 58 | 🟢 | Clean Code | packages/api/src/lib/response.ts | `supabaseError` helper named generically — only handles 500 errors | Rename to `internalError` or make status configurable |
| 59 | 🟡 | Testing | packages/api/src/__tests__/routes.test.ts | No tests for: shared-admin routes, admin-portal, events routes (business logic), plan routes (business logic), audit routes (success case), webhooks routes (success cases) | Add integration tests for happy paths |
| 60 | 🟡 | Testing | packages/api/src/__tests__/routes.test.ts:16 | Network of mock setup — all tests use mocked Supabase. No integration tests with real DB | Add container-based integration test suite |
| 61 | 🟢 | Testing | packages/api/vitest.config.ts | Coverage thresholds are low (statements: 40, branches: 30, functions: 35) | Raise thresholds as coverage improves |
| 62 | 🟡 | Testing | packages/api/src/__tests__/routes.test.ts:16 | Tests import with `.js` extension (`'../db/supabase.js'`) — works in ESM but brittle | Use `.ts` extension or no extension with resolver config |
| 63 | 🟡 | Testing | packages/api/src/__tests__/webhook-dispatcher.test.ts:14 | Same `.js` extension pattern | Same as #62 |
| 64 | 🟡 | Testing | packages/api/src/__tests__/session-auth.test.ts:15 | Same `.js` extension pattern | Same as #62 |
| 65 | 🟡 | Testing | packages/api/src/__tests__/rate-limit.test.ts | No test for `cleanup` function attached to rate limiter middleware | Add test that calls `middlewareFn.cleanup` |
| 66 | 🟡 | Testing | packages/api/src/__tests__/rate-limit.test.ts | No test with real timer advancement verifying cleanup interval behavior | Add cleanup interval behavior test |
| 67 | 🔴 | Observability | packages/api/src/app.ts:70-73 | pino logger created but not exported — other modules can't use it | Export logger instance from app.ts or create a shared logger module |
| 68 | 🔴 | Observability | packages/api/src/app.ts:101-106 | Request ID middleware sets header on `c.res.headers` before `next()` but response may not be committed yet — could be lost | Use Hono's `c.header()` or set on context variable |
| 69 | 🟡 | Observability | packages/api/src/app.ts:111 | `c.res.headers.get('X-Request-Id')` reads from response before it's sent — fragile | Use a context variable as single source of truth |
| 70 | 🟡 | Observability | packages/api/src/middleware/rate-limit.ts:44-85 | Rate limiter headers set on response but no `X-RateLimit-Reset` in ISO format for human readability | Add `X-RateLimit-Reset-ISO` header |
| 71 | 🟢 | Clean Code | packages/api/src/middleware/rate-limit.ts:88-94 | `Object.defineProperty` to attach `cleanup` — non-standard pattern | Store cleanup in a WeakMap or export a separate `disposeRateLimiter` function |
| 72 | 🟡 | Project Structure | packages/api/src/routes/events.ts | Usage events stored in `audit_events` table (documented tech debt) | Create dedicated `usage_events` table and migration |
| 73 | 🟡 | Project Structure | packages/api/src/routes/portal.ts:389-421 | `PATCH /portal/settings` — business logic (update building) in route handler | Extract to a service function |
| 74 | 🟡 | Project Structure | packages/api/src/lib/shared-admin.ts:593 lines | Factory function is very large — consider splitting into smaller factories | Break into tenant/plan/impersonation/audit sub-factories |
| 75 | 🟡 | API Design | packages/api/src/routes/webhooks.ts | Webhook routes return secret on creation but there's no mechanism to regenerate it | Add a rotate endpoint for webhook secrets |
| 76 | 🟢 | API Design | packages/api/src/routes/webhooks.ts:37 | `createWebhookSchema` `url` validated as URL but no check for internal network SSRF | Consider blocking private IP ranges in webhook URLs |
| 77 | 🟡 | API Design | packages/api/src/app.ts:135-142 | All routes mounted at `/v1` but some routes have different base paths (e.g. `/admin`, `/portal`) mixed with `/` | Routes are namespaced correctly; this is fine |
| 78 | 🟡 | Resilience | packages/api/src/lib/webhook-dispatcher.ts:97 | `AbortSignal.timeout(10_000)` — good, but Supabase queries have no timeout | Add Supabase query timeout config |
| 79 | 🟡 | Resilience | packages/api/src/db/supabase.ts:23-28 | Supabase client created with no timeout configuration | Add `db: { schema: 'public' }` and timeout |
| 80 | 🟢 | Clean Code | packages/api/src/routes/schemas.ts | All schemas in one file (133 lines) — manageable but could split | Minor; consider splitting when schemas exceed 200 lines |
| 81 | 🟡 | Security | packages/api/src/lib/shared-admin.ts | Admin routes accept `:id` params for tenants — always scoped through Supabase `.eq()` in the factory, BUT the query builder doesn't add tenant ownership check for user-level data | Ensure all tenant-scoped queries include `tenant_id` check |
| 82 | 🟡 | API Design | packages/api/src/routes/portal.ts:123 | `POST /portal/users/invite` lists ALL auth users to find by email — doesn't scale | Use Supabase Auth admin `getUserByEmail` if available, or maintain local email index |

---

## Summary by Severity

- **🔴 Critical**: 13 issues
- **🟡 Warning**: 41 issues
- **🟢 Suggestion**: 28 issues

## Summary by Area

| Area | Count |
|---|---|
| Logging & Observability | 9 |
| Error Handling | 13 |
| API Design | 10 |
| Database | 7 |
| Testing | 8 |
| Clean Code | 10 |
| Security | 5 |
| Resilience | 4 |
| Consistency | 4 |
| Project Structure | 3 |
| Git/CI | 1 |
| Other | 8 |

## Key Themes (What Previous Audits Missed)

1. **No `outDir` in tsconfig** causes `.js` file pollution in `src/` (27 files) — this is the most impactful structural issue.
2. **`pinoHttp` dead import** — imported but never used; the custom logger middleware replaced it.
3. **Logger not exported** — every module falls back to `console.log/error/warn` instead of structured pino logging (9 instances).
4. **Fire-and-forget patterns without error propagation** — `dispatchWebhook` and `last_used_at` updates are never awaited, errors silently swallowed.
5. **N+1 queries and `listUsers()` scaling** — auth user enrichment fetches all users and doesn't scale past 1000.
6. **Inconsistent pagination** — some list endpoints paginate, others use hardcoded limits.
7. **No graceful shutdown** — server doesn't handle SIGTERM/SIGINT.
8. **Empty catch blocks** — 6 instances of `catch { /* no-op */ }` or `catch(() => {})`.
