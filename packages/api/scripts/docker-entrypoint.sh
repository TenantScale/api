#!/bin/sh
# ──────────────────────────────────────────────────────
# TenantScale API — Docker Entrypoint
# ──────────────────────────────────────────────────────
# Runs before the main process starts:
#   1. Validates required environment variables
#   2. Optionally applies database migrations
#   3. Executes the CMD (node dist/index.js)
#
# Migrations are run by default if SUPABASE_URL is set and
# the migrations directory exists. Set SKIP_MIGRATIONS=1
# to disable (e.g. if using external migration tooling).
# ──────────────────────────────────────────────────────

set -e

# ── Colors for output ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { printf "${GREEN}[TenantScale]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[TenantScale]${NC} %s\n" "$1"; }
error() { printf "${RED}[TenantScale]${NC} %s\n" "$1"; }

# ── Validate required env vars ──
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  error "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
  error "Set them in .env or pass them via docker compose's environment block."
  exit 1
fi

info "SUPABASE_URL configured ✓"

# ── Optional: warn about unset Stripe/Sentry ──
if [ -z "$STRIPE_SECRET_KEY" ]; then
  warn "STRIPE_SECRET_KEY not set — billing routes will return 501"
fi
if [ -z "$SENTRY_DSN" ]; then
  warn "SENTRY_DSN not set — error tracking disabled"
fi

# ── Set deployment mode ──
export DEPLOYMENT_MODE="${DEPLOYMENT_MODE:-self_hosted}"
info "Deployment mode: $DEPLOYMENT_MODE"

# ── Run migrations ──
MIGRATIONS_DIR="/app/packages/api/supabase/migrations"
if [ "${SKIP_MIGRATIONS}" != "1" ] && [ -d "$MIGRATIONS_DIR" ]; then
  info "Checking for pending database migrations..."

  # Use a temporary Node script to apply migrations via Supabase's REST API
  # This works with any Supabase project (cloud or local) without needing psql.
  node -e "
    const { createClient } = require('@supabase/supabase-js');
    const fs = require('fs');
    const path = require('path');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const migrationsDir = '$MIGRATIONS_DIR';
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    async function run() {
      // Check which migrations have already been applied
      const { data: applied } = await supabase
        .from('_migrations')
        .select('name')
        .catch(() => ({ data: null }));

      const appliedNames = new Set((applied || []).map(r => r.name));

      for (const file of files) {
        if (appliedNames.has(file)) {
          console.log('  ✓', file, '(already applied)');
          continue;
        }

        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        console.log('  → Applying', file, '...');

        const { error } = await supabase.rpc('exec_sql', { sql }).catch(() => {
          // Fallback: run via direct SQL REST endpoint
          return supabase.from('_sql').insert({ sql }).single();
        });

        if (error) {
          // If exec_sql doesn't exist yet (first migration), create the tracking table manually
          if (!applied) {
            console.log('  → Initializing migration tracking table ...');
            const initSql = \`
              create table if not exists public._migrations (
                name text primary key,
                applied_at timestamptz default now()
              );
              insert into public._migrations (name) values ('_init');
            \`;
            await supabase.rpc('exec_sql', { sql: initSql });
            // Re-run current migration
            await supabase.rpc('exec_sql', { sql });
            await supabase.from('_migrations').insert({ name: file });
            console.log('  ✓', file);
            continue;
          }
          throw error;
        }

        // Record migration as applied
        await supabase.from('_migrations').insert({ name: file }).catch(() => {});
        console.log('  ✓', file);
      }

      console.log('\\nMigrations complete.');
    }

    run().catch(err => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
  "
fi

# ── Start the server ──
info "Starting TenantScale API..."
exec "$@"
