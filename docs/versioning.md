# API Versioning

This document explains how the TenantScale API handles versioning, the deprecation
policy, and how a future major version (`v2`) should be introduced.

## Current strategy: URL path prefix

The API uses **URL-based versioning**. Every endpoint is namespaced under a version
prefix in the URL path, currently `/v1`:

```
GET  /v1/tenants
POST /v1/tenants
GET  /v1/portal/me
GET  /v1/admin/plans
```

### How it is implemented

In `packages/api/src/app.ts` the `v1` router is created with Hono's `basePath` and
all route modules are mounted onto it:

```typescript
const v1 = app.basePath('/v1')
v1.use('*', createPlanRateLimiter())
v1.use('*', metricsMiddleware)
v1.route('/', tenantRoutes)
v1.route('/', auditRoutes)
// ... etc
```

Anything mounted *outside* `/v1` is intentionally unversioned infrastructure that
is not considered part of the public contract (e.g. `GET /health`, `GET /metrics`,
`GET /openapi.yaml`, and the Stripe webhook endpoint `POST /webhooks/stripe`).

## Version vs. application version

The URL prefix (`/v1`) is the **API contract version** — it only changes when we make
a *breaking* change to request/response shapes or semantics.

The application version (`APP_VERSION`, currently `0.1.0`, returned by `GET /health`)
is the internal build/release version and is **not** part of the public contract.
It may change on every release and is intended for operational diagnostics only.

## Breakage and adding non-breaking changes

- **Non-breaking changes** (adding a field, adding a new optional header, adding a
  brand-new endpoint) are added to the current version (`/v1`) and do **not** require
  a version bump.
- **Breaking changes** (removing/renaming a field, changing response types, changing
  auth semantics, removing an endpoint) require a **new major version** (`/v2`).

## Deprecation policy

When an endpoint or field is superseded, we communicate it before removing it:

1. **`Deprecation` header** — announce that a resource is deprecated and is planned
   for removal. Serve it on every response that uses the deprecated resource:

   ```
   Deprecation: true
   ```

   Optionally include the deprecation date as an HTTP date per
   [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594):

   ```
   Deprecation: Thu, 31 Jan 2030 23:59:59 GMT
   ```

2. **`Sunset` header** — announce *when* the deprecated resource will be removed or
   fully restricted, also as an HTTP date per [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594):

   ```
   Sunset: Thu, 31 Jan 2030 23:59:59 GMT
   ```

### Minimum notice period

- **Deprecation notice**: we will advertise `Deprecation` for **at least 12 months**
  before removal.
- **Sunset**: we will set a `Sunset` date at least **6 months** out and will not remove
  the resource before that date.
- Exceptions (e.g. security fixes) are announced and coordinated case-by-case.

## Introducing `v2`

The intended path for a future breaking release:

1. **Add** `v2` routes in `packages/api/src/app.ts` alongside the existing `v1` router:

   ```typescript
   const v2 = app.basePath('/v2')
   // mount v2 route modules...
   ```

   It is fine to serve `/v1` and `/v2` simultaneously for a transition window.

2. **Keep `/v1` running** for the duration of the migration window. Track usage of the
   deprecated endpoints (via logging/metrics) to gauge readiness for removal.
3. **When leftover `/v1` traffic drops** below an acceptable threshold (or the minimum
   notice period elapses), schedule removal with a `Sunset` header and announce it.
4. Remove `/v1` in a future release once the transition is complete.

## Migration guide

When a new major version ships, restructuring the SDK to target it:

1. Publish SDK changes that call the new endpoint paths (`/v2/...`).
2. Keep the old client/target happy by supporting both during the transition, or
   bump the SDK major version so downstream users opt in deliberately.
3. Document the breaking changes and map old → new request/response fields in the
   changelog and in the [docs](https://tenantscale-docs.vercel.app).

## Recommendation

URL-based versioning is the right call for this codebase: it is simple, debuggable,
caches naturally, and matches how the API is already structured. To operationalize it
we recommend:

- Enforce the deprecation headers via a small middleware so they are applied
  consistently rather than inline in route handlers.
- Advertise the current API version in the responses (e.g. via the existing
  `X-TenantScale-Version` header, which the server already allows in CORS) so clients
  can assert the contract version they are talking to.
- Document the versioned endpoints in the OpenAPI spec so the contract and its version
  are machine-readable.