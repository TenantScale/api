# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | ✅ Active development — security fixes prioritized |

## Reporting a Vulnerability

TenantScale API is the management plane for multi-tenant SaaS applications. It handles **tenant data, API key authentication, Stripe billing, JWT portal sessions, Supabase database access, and webhook delivery**. Security is our top priority.

**Please do not report security vulnerabilities through public GitHub issues or discussions.**

Instead, report via email to **matthew@thatdevmat.com**

You should receive a response within **48 hours**. If you don't, please follow up.

### What to include

To help us triage and fix the issue quickly, please include:

- **Type of issue** (e.g., SQL injection, authentication bypass, privilege escalation, SSRF, data leakage, rate limit bypass, etc.)
- **Affected endpoints or modules** — routes, middleware, or lib files involved
- **Deployment context** — Self-hosted or TenantScale Cloud? Default configuration or customized?
- **Step-by-step reproduction** — Minimal, complete instructions to reproduce the issue
- **Proof-of-concept** — Code or curl commands demonstrating the vulnerability (if possible)
- **Impact** — What an attacker could achieve (data access, tenant isolation bypass, denial of service, etc.)

### Scope

The following areas are in scope for security reports:

- **API routes** — tenant CRUD, API key management, portal sessions, webhooks, billing
- **Authentication** — API key validation, JWT session verification, scope enforcement
- **Authorization** — Tenant isolation, cross-tenant data access prevention
- **Input validation** — Zod schema gaps, SQL injection via query parameters
- **Rate limiting** — Bypass of IP or plan-based rate limits
- **Webhook security** — SSRF protection, signature verification, replay attacks
- **Billing** — Stripe webhook tampering, subscription manipulation
- **Dependencies** — Vulnerable npm packages with known CVEs

The following are **out of scope**:

- **Supabase platform itself** — Report Supabase vulnerabilities to [Supabase Security](https://supabase.com/security)
- **Vercel platform** — Report Vercel infrastructure issues to [Vercel Security](https://vercel.com/security)
- **Stripe platform** — Report Stripe issues to [Stripe Security](https://stripe.com/docs/security)
- **Browser/extension vulnerabilities**
- **Social engineering** of TenantScale maintainers or users

### Disclosure Timeline

We follow a **90-day disclosure timeline** for publicly disclosed vulnerabilities:

1. **Confirmation** — We acknowledge receipt within 48 hours
2. **Triage** — We assess severity and impact within 5 business days
3. **Fix** — We develop and test a patch (timeline depends on severity)
4. **Release** — We ship a patched version and update the changelog
5. **Disclosure** — After 90 days or when a fix is released (whichever comes first), we publish the details with attribution

### Severity Guidelines

| Severity | Response SLA | Fix Timeline | Disclosure |
|----------|-------------|--------------|------------|
| **Critical** (tenant data breach, auth bypass, RCE) | 24 hours | 7 days | Coordinated with reporter |
| **High** (SSRF, privilege escalation, SQL injection) | 48 hours | 14 days | Coordinated with reporter |
| **Medium** (rate limit bypass, info disclosure) | 72 hours | 30 days | After fix shipped |
| **Low** (minor info leak, best practice gap) | 1 week | 90 days | Next release |

### Self-Hosted Deployments

If you self-host the API:
- Keep your Supabase credentials (`SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `API_SECRET`) private and rotated regularly
- Use HTTPS in production (never expose the API over plain HTTP)
- Restrict access to admin endpoints (`/v1/admin/*`) by network policy
- Keep the `@tenantscale/api` npm package updated
- Monitor the [GitHub Security Advisories](https://github.com/TenantScale/api/security/advisories) feed

### Cloud-Hosted Deployments

If you use TenantScale Cloud:
- Security patches are deployed automatically
- We perform regular dependency audits (weekly automated scans)
- Database encryption at rest and in transit is handled by Supabase
- API rate limits protect against abuse

---

Thank you for helping keep TenantScale API and its users safe.
