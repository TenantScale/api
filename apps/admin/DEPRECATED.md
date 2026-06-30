# DEPRECATED — apps/portal is the unified UI

This dashboard has been superseded by `apps/portal/`.

## What changed

The old admin dashboard (`apps/admin`) and customer portal (`apps/portal`) have been merged into a single app at `apps/portal/` with role-gated views.

### Why

The portal now serves both roles:
- **Regular users** → Dashboard, Users, API Keys, Audit Log, Settings (tenant-scoped)
- **Super admins** → + Tenants list, Tenant detail, Plans management (cross-tenant)

### Migration

All features from this dashboard have been ported to `apps/portal/`:
- `/tenants` → `apps/portal/app/tenants/` (super_admin only)
- `/tenants/[id]` → `apps/portal/app/tenants/[id]/` (super_admin only)
- `/plans` → `apps/portal/app/plans/` (super_admin only)
- `/login` → `apps/portal/app/login/`

### Running the new portal

```bash
cd ~/tenantkit && pnpm dev --filter=@tenantscale/portal
# → http://localhost:3003
```

This file (`apps/admin/DEPRECATED.md`) and the `apps/admin/` directory can be deleted once you've confirmed the portal works for your workflow.
