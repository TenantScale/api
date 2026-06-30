// ──────────────────────────────────────────────────────
// @tenantscale/mcp — MCP Server
// Gives AI coding tools (Claude, Cursor, Copilot)
// real-time tenant schema, RLS validation, and
// endpoint structure during development.
// ──────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// ── Tools ──

const TOOLS = [
  {
    name: 'get_tenant_schema',
    description: 'Look up existing tenant structures (tables, columns, RLS policies) from a connected Supabase project',
    inputSchema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: 'Optional table name to scope the lookup (e.g. "audit_events"). Omitting returns all tenant-related tables.',
        },
      },
    },
  },
  {
    name: 'validate_tenant_query',
    description: 'Check a SQL query for tenant isolation — ensures every SELECT/INSERT/UPDATE/DELETE includes a tenant_id filter',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The SQL query to validate' },
        table: { type: 'string', description: 'The primary table being queried' },
      },
      required: ['query', 'table'],
    },
  },
  {
    name: 'generate_rls_policy',
    description: 'Generate a Row-Level Security policy for a new table, scoped to tenant_id',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'The new table name' },
        schema: { type: 'string', description: 'Database schema (default: public)', default: 'public' },
      },
      required: ['table'],
    },
  },
  {
    name: 'suggest_endpoint_structure',
    description: 'Get the recommended route patterns for a new feature — consistent with TenantScale conventions',
    inputSchema: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: 'Feature name, e.g. "billing", "webhooks", "invitations"' },
        methods: {
          type: 'array',
          items: { type: 'string' },
          description: 'HTTP methods needed: GET, POST, PATCH, DELETE',
        },
      },
      required: ['feature'],
    },
  },
]

// ── Tool Handlers ──

async function handleGetTenantSchema(table?: string) {
  if (table) {
    return `-- Schema for "${table}" follows TenantScale conventions:
--   id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
--   tenant_id   UUID NOT NULL
--   ...feature columns...
--   created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- RLS: ENABLE ROW LEVEL SECURITY;
-- POLICY tenant_isolation_${table}: FOR ALL USING (tenant_id = current_setting('app.tenant_id')::UUID)
`
  }

  return `TenantScale standard tables:
  • tenants          — Core tenant records, plan, feature flags
  • tenant_users     — User-tenant membership
  • api_keys         — Scoped API keys per tenant
  • audit_events     — Immutable audit trail (tenant-scoped)
  • impersonation_sessions  — Admin impersonation tokens
  • plans            — Plan tiers and feature entitlements

Every new tenant-scoped table should:
  1. Include a "tenant_id UUID NOT NULL"
  2. Enable RLS with a tenant-scoped policy
  3. Add a GIN index on tenant_id`
}

function handleValidateQuery(query: string, table: string) {
  const upper = query.toUpperCase()
  const issues: string[] = []

  if (upper.includes('WHERE')) {
    const whereClause = query.split(/WHERE/i)[1]
    if (whereClause && !whereClause.toLowerCase().includes('tenant_id')) {
      issues.push(`⚠️  WHERE clause found but does not reference "tenant_id". Add: AND tenant_id = current_setting('app.tenant_id')::UUID`)
    }
  } else {
    if (upper.startsWith('SELECT') && !upper.includes('COUNT')) {
      issues.push(`⚠️  No WHERE clause on SELECT from "${table}". All tenant queries must filter by tenant_id.`)
    }
  }

  if (!upper.includes('tenant_id') && (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE'))) {
    issues.push(`⚠️  Mutation on "${table}" missing tenant_id reference. Did you forget to scope to the current tenant?`)
  }

  if (issues.length === 0) {
    return `✅ Query looks tenant-safe. The query references "tenant_id" correctly.`
  }

  return issues.join('\n')
}

function handleGenerateRLSPolicy(table: string, schema: string) {
  return `-- Generated RLS policy for "${schema}"."${table}"
ALTER TABLE "${schema}"."${table}" ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy (read/write scoped to current tenant)
CREATE POLICY "tenant_isolation_${table}" ON "${schema}"."${table}"
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Admin override policy (service_role bypasses RLS)
-- Note: service_role always bypasses RLS by default

-- Index for tenant-scoped queries
CREATE INDEX idx_${table}_tenant_id ON "${schema}"."${table}" (tenant_id);

-- Grant access to authenticated + anon roles as needed
-- GRANT SELECT, INSERT, UPDATE, DELETE ON "${schema}"."${table}" TO authenticated;
`
}

function handleSuggestEndpoint(feature: string, methods: string[] = []) {
  const routes = methods.map(m => {
    const method = m.toUpperCase()
    switch (method) {
      case 'GET':
        return [
          `GET    /v1/${feature}          — List ${feature} for current tenant`,
          `GET    /v1/${feature}/:id      — Get single ${feature} entry`,
        ]
      case 'POST':
        return [`POST   /v1/${feature}          — Create new ${feature} entry`]
      case 'PATCH':
        return [`PATCH  /v1/${feature}/:id      — Update ${feature} entry`]
      case 'DELETE':
        return [`DELETE /v1/${feature}/:id      — Delete ${feature} entry`]
      default:
        return []
    }
  }).flat()

  const notes = [
    '',
    `Admin routes (if needed):`,
    `GET    /v1/admin/${feature}    — Cross-tenant ${feature} view (requires admin key)`,
    '',
    `Middleware to apply:`,
    `  • ${feature} routes → ts.protect(), ts.audit()`,
    `  • Admin routes     → ts.requireAdmin()`,
    '',
    `Schema reference:`,
    `  • tenant_id FK is required on every new table`,
    `  • See TENANTSCALE.md for the standard column pattern`,
  ]

  return [...routes, ...notes].join('\n')
}

// ── Server Setup ──

const server = new Server(
  { name: '@tenantscale/mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'get_tenant_schema': {
      const text = await handleGetTenantSchema(args?.table as string | undefined)
      return { content: [{ type: 'text', text }] }
    }

    case 'validate_tenant_query': {
      const { query, table } = args as { query: string; table: string }
      const text = handleValidateQuery(query, table)
      return { content: [{ type: 'text', text }] }
    }

    case 'generate_rls_policy': {
      const { table, schema = 'public' } = args as { table: string; schema?: string }
      const text = handleGenerateRLSPolicy(table, schema)
      return { content: [{ type: 'text', text }] }
    }

    case 'suggest_endpoint_structure': {
      const { feature, methods } = args as { feature: string; methods?: string[] }
      const text = handleSuggestEndpoint(feature, methods)
      return { content: [{ type: 'text', text }] }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
})

// ── Start ──

const transport = new StdioServerTransport()
try {
  await server.connect(transport)
  console.error('@tenantscale/mcp running on stdio')
} catch (err) {
  console.error('[TenantScale] MCP server failed to start:', err)
  process.exit(1)
}
