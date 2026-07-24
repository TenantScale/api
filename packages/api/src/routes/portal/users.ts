// ──────────────────────────────────────────────────────
// Portal: /portal/users — User management endpoints
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { supabase } from '../../db/supabase.js'
import { inviteUserSchema, updateRoleSchema } from '../schemas.js'
import { requirePortalSession, requirePortalRole, getSession } from '../../middleware/session-auth.js'
import type { PortalSession } from '../../middleware/session-auth.js'
import { supabaseError } from '../../lib/response.js'
import { logAuditEvent } from '../../lib/audit.js'
import { getPaginationParams } from '../../lib/pagination.js'

export const usersRoutes = new Hono()

// ── GET /portal/users — List tenant users (paginated) ──
usersRoutes.get('/portal/users', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)
  const { page, limit, offset } = getPaginationParams(c)

  const { data: users, error, count } = await supabase
    .from('tenant_users')
    .select('id, user_id, role, joined_at, invited_by', { count: 'exact' })
    .eq('tenant_id', session.tenant_id)
    .order('joined_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) return supabaseError(c, error)

  // Fetch auth users with pagination (max 1000 per page).
  const { data: authUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const userMap = new Map((authUsers?.users ?? []).map(u => [u.id, u.email ?? null]))

  const fetchedCount = authUsers?.users?.length ?? 0
  if (fetchedCount >= 1000) {
    c.header('X-Warning', 'Auth user list may be incomplete - consider using a user_profiles table for large deployments')
  }

  const enriched = users.map(u => ({
    ...u,
    email: userMap.get(u.user_id) ?? null,
    is_self: u.user_id === session.user_id,
  }))

  return c.json({ users: enriched })
})

// ── POST /portal/users/invite — Invite a user to the tenant ──
usersRoutes.post('/portal/users/invite', requirePortalSession, requirePortalRole('owner', 'admin'), zValidator('json', inviteUserSchema), async (c) => {
  const session: PortalSession = getSession(c)
  const body = c.req.valid('json')

  const { data: authUsers } = await supabase.auth.admin.listUsers()
  const targetUser = (authUsers?.users ?? []).find(u => u.email === body.email)

  if (!targetUser) {
    return c.json({ error: 'No user found with this email. They must sign up first.' }, 404)
  }

  const { data: existing } = await supabase
    .from('tenant_users')
    .select('id')
    .eq('tenant_id', session.tenant_id)
    .eq('user_id', targetUser.id)
    .maybeSingle()

  if (existing) {
    return c.json({ error: 'User is already a member of this tenant' }, 409)
  }

  // Check max_users limit
  const { data: tenant } = await supabase
    .from('tenants')
    .select('plan_id')
    .eq('id', session.tenant_id)
    .single()

  const { data: plan } = await supabase
    .from('plans')
    .select('max_users')
    .eq('id', tenant?.plan_id)
    .single()

  if (plan?.max_users) {
    const { count } = await supabase
      .from('tenant_users')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', session.tenant_id)

    if (count && count >= plan.max_users) {
      return c.json({ error: `Plan limit reached (${plan.max_users} users). Upgrade to add more.` }, 403)
    }
  }

  const { data: membership, error } = await supabase
    .from('tenant_users')
    .insert({
      tenant_id: session.tenant_id,
      user_id: targetUser.id,
      role: body.role,
      invited_by: session.membership_id,
    })
    .select()
    .single()

  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'user.invited',
    resource: `user:${targetUser.id}`,
    details: { invited_email: body.email, role: body.role, invited_by: session.email },
  })

  return c.json({ ...membership, email: body.email }, 201)
})

// ── DELETE /portal/users/:id — Remove user from tenant ──
usersRoutes.delete('/portal/users/:id', requirePortalSession, requirePortalRole('owner', 'admin'), async (c) => {
  const session: PortalSession = getSession(c)
  const membershipId = c.req.param('id')

  const { data: target } = await supabase
    .from('tenant_users')
    .select('*')
    .eq('id', membershipId)
    .eq('tenant_id', session.tenant_id)
    .single()

  if (!target) return c.json({ error: 'User not found in this tenant' }, 404)
  if (target.role === 'owner') return c.json({ error: 'Cannot remove the tenant owner' }, 403)
  if (target.user_id === session.user_id) return c.json({ error: 'Use the leave endpoint to remove yourself' }, 400)

  const { error } = await supabase.from('tenant_users').delete().eq('id', membershipId)
  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'user.removed',
    resource: `user:${target.user_id}`,
    details: { removed_by: session.email },
  })

  return c.json({ success: true })
})

// ── PATCH /portal/users/:id/role — Change user role ──
usersRoutes.patch('/portal/users/:id/role', requirePortalSession, requirePortalRole('owner', 'admin'), zValidator('json', updateRoleSchema), async (c) => {
  const session: PortalSession = getSession(c)
  const membershipId = c.req.param('id')
  const body = c.req.valid('json')

  const { data: target } = await supabase
    .from('tenant_users')
    .select('*')
    .eq('id', membershipId)
    .eq('tenant_id', session.tenant_id)
    .single()

  if (!target) return c.json({ error: 'User not found in this tenant' }, 404)
  if (target.role === 'owner') return c.json({ error: 'Cannot change the tenant owner role' }, 403)

  const { data: updated, error } = await supabase
    .from('tenant_users')
    .update({ role: body.role })
    .eq('id', membershipId)
    .select()
    .single()

  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'user.role_changed',
    resource: `user:${target.user_id}`,
    details: { from_role: target.role, to_role: body.role, changed_by: session.email },
  })

  return c.json(updated)
})

// ── POST /portal/leave — Leave the current tenant ──
usersRoutes.post('/portal/leave', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)

  if (session.role === 'owner') {
    return c.json({ error: 'Transfer ownership before leaving, or delete the tenant' }, 403)
  }

  const { error } = await supabase.from('tenant_users').delete().eq('id', session.membership_id)
  if (error) return supabaseError(c, error)

  return c.json({ success: true })
})
