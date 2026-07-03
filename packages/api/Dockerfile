# ──────────────────────────────────────────────────────
# TenantScale API — Multi-stage Docker build
# ──────────────────────────────────────────────────────

# ── Stage 1: Install all deps + build ──
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy root workspace files first (caching layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy the API package
COPY packages/api/ packages/api/

# Install ALL dependencies (including devDeps for build)
RUN pnpm install --frozen-lockfile

# Build the API
RUN pnpm --filter @tenantscale/api build

# ── Stage 2: Production image ──
FROM node:22-alpine

WORKDIR /app

# Install pnpm in production image too (needed for prisma/runtime if added later)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy production deps manifest
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/

# Install production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy built output from builder
COPY --from=builder /app/packages/api/dist ./packages/api/dist

# Copy SQL migrations for the init container
COPY packages/api/supabase ./packages/api/supabase

# Copy entrypoint script
COPY packages/api/scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "packages/api/dist/index.js"]
