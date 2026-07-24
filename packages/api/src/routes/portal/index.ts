// ──────────────────────────────────────────────────────
// Portal routes — aggregator that mounts all sub-routers
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { meRoutes } from './me.js'
import { usersRoutes } from './users.js'
import { apiKeysRoutes } from './api-keys.js'
import { auditRoutes } from './audit.js'
import { tenantMgmtRoutes } from './tenant-mgmt.js'
import { registerRoutes } from './register.js'

export const portalRoutes = new Hono()

portalRoutes.route('/', meRoutes)
portalRoutes.route('/', usersRoutes)
portalRoutes.route('/', apiKeysRoutes)
portalRoutes.route('/', auditRoutes)
portalRoutes.route('/', tenantMgmtRoutes)
portalRoutes.route('/', registerRoutes)
