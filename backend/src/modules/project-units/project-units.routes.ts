import { Router } from 'express';
import { createProjectUnitSchema, PERMISSIONS, updateProjectUnitSchema } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { requireSiteAccess } from '../../common/middleware/require-site-access';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import {
  createProjectUnit,
  deleteProjectUnit,
  listProjectUnits,
  updateProjectUnit,
} from './project-units.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

export const projectUnitsRouter = Router();

projectUnitsRouter.use(requireAuth);

// Nested under a Project Site — list/create are scoped by `requireSiteAccess`, the same
// middleware docs/architecture/authentication.md documents for exactly this route shape (Master
// Admin bypasses it; Payroll Staff must be assigned to the site). `sites:manage` is also passed as
// this route's global-authority permission (System-Wide RBAC Consistency remediation) — the same
// permission that already grants unrestricted Project Site *visibility* (`listProjectSites`) must
// grant the same unrestricted authority over that site's Units, or a `sites:manage` holder with no
// individual `UserSiteAssignment` row could list every site but manage none of their units, exactly
// the production contradiction this fix closes.
projectUnitsRouter.get(
  '/sites/:siteId/units',
  requireSiteAccess((req) => req.params.siteId, { globalPermission: PERMISSIONS.SITES_MANAGE }),
  async (req, res, next) => {
    try {
      const units = await listProjectUnits(requireIdParam(req.params.siteId));
      res.status(200).json({ units });
    } catch (error) {
      next(error);
    }
  },
);

projectUnitsRouter.post(
  '/sites/:siteId/units',
  requireSiteAccess((req) => req.params.siteId, { globalPermission: PERMISSIONS.SITES_MANAGE }),
  requirePermission(PERMISSIONS.SITES_MANAGE),
  async (req, res, next) => {
    try {
      const siteId = requireIdParam(req.params.siteId);
      const input = createProjectUnitSchema.parse(req.body);
      const unit = await createProjectUnit(siteId, input);

      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'project-unit.created',
        entityType: 'ProjectUnit',
        entityId: unit.id,
        metadata: { name: unit.name, siteId: unit.siteId },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(201).json({ unit });
    } catch (error) {
      next(error);
    }
  },
);

// Update/delete address a unit directly by its own id — gated by `sites:manage` alone (Master
// Admin only, per the seeded RolePermission grants), so no separate site-scoping check is needed
// here: Master Admin already bypasses site-scoping everywhere, and Payroll Staff never holds this
// permission, matching how ProjectSite's own PATCH/DELETE routes are gated.
projectUnitsRouter.patch(
  '/units/:id',
  requirePermission(PERMISSIONS.SITES_MANAGE),
  async (req, res, next) => {
    try {
      const id = requireIdParam(req.params.id);
      const input = updateProjectUnitSchema.parse(req.body);
      const unit = await updateProjectUnit(id, input);

      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'project-unit.updated',
        entityType: 'ProjectUnit',
        entityId: unit.id,
        metadata: { changes: input },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(200).json({ unit });
    } catch (error) {
      next(error);
    }
  },
);

projectUnitsRouter.delete(
  '/units/:id',
  requirePermission(PERMISSIONS.SITES_MANAGE),
  async (req, res, next) => {
    try {
      const id = requireIdParam(req.params.id);
      await deleteProjectUnit(id);

      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'project-unit.deleted',
        entityType: 'ProjectUnit',
        entityId: id,
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
