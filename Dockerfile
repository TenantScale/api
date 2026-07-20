# ──────────────────────────────────────────────────────
# TenantScale API — Production Dockerfile
# ──────────────────────────────────────────────────────
# Multi-stage build for minimal production image
# Runs the Hono app as a long-lived Node.js process
# ──────────────────────────────────────────────────────

# ── Stage 1: Install deps + build ──
FROM node:22-alpine AS builder
WORKDIR /app

# Copy root workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy the API package
COPY packages/api ./packages/api

# Install all deps for the API package
RUN corepack enable && pnpm install --frozen-lockfile --filter @tenantscale/api

# Build TypeScript
RUN cd packages/api && npx tsc

# ── Stage 2: Production runtime ──
FROM node:22-alpine AS runner
WORKDIR /app

# Copy built output + production deps
COPY --from=builder /app/packages/api/dist ./dist
COPY --from=builder /app/packages/api/node_modules ./node_modules
COPY --from=builder /app/packages/api/package.json ./

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
