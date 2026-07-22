import { Router } from 'express';
import { createRoleSchema, duplicateRoleSchema, PERMISSION_GROUPS, PERMISSIONS, updateRoleSchema } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { prisma } from '../../lib/prisma';
import { createRole, deleteRole, duplicateRole, getRoleDetail, listRoles, listRoleUsers, updateRole } from './roles.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

const requestMetaFrom = (req: { ip?: string; get: (name: string) => string | undefined }) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/**
 * Mounted at /api/v1/roles (Administration & Security Management Phase 1). Every route requires
 * `users:manage` — the closest existing administration permission (docs/architecture/
 * authentication.md); this phase does not introduce a separate `roles:manage` permission, since
 * "who may administer users" and "who may administer the roles those users hold" are the same
 * governance responsibility in this system's own design.
 */
export const rolesRouter = Router();

rolesRouter.use(requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE));

/**
 * The permission catalog — every real `Permission` row, enriched with the shared, presentational
 * `PERMISSION_GROUPS` metadata for the frontend's permission-matrix UI. Mounted ahead of `/:id`
 * (a literal path segment can never collide with route matching regardless of order, but this
 * keeps the "more specific first" convention this codebase already follows elsewhere, e.g.
 * `payroll-cycles/:cycleId/entries` mounted ahead of `payroll-cycles/:id`).
 */
rolesRouter.get('/permissions', async (_req, res, next) => {
  try {
    const permissions = await prisma.permission.findMany({ orderBy: { key: 'asc' } });
    const catalog = permissions.map((permission) => {
      const meta = PERMISSION_GROUPS[permission.key as keyof typeof PERMISSION_GROUPS];
      const [, action] = permission.key.split(':');
      return {
        id: permission.id,
        key: permission.key,
        label: meta?.label ?? permission.key,
        group: meta?.group ?? 'Other',
        action: action ?? permission.key,
      };
    });
    res.status(200).json({ permissions: catalog });
  } catch (error) {
    next(error);
  }
});

rolesRouter.get('/', async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const roles = await listRoles({ includeInactive });
    res.status(200).json({ roles });
  } catch (error) {
    next(error);
  }
});

rolesRouter.get('/:id', async (req, res, next) => {
  try {
    const role = await getRoleDetail(requireIdParam(req.params.id));
    res.status(200).json({ role });
  } catch (error) {
    next(error);
  }
});

rolesRouter.get('/:id/users', async (req, res, next) => {
  try {
    const users = await listRoleUsers(requireIdParam(req.params.id));
    res.status(200).json({ users });
  } catch (error) {
    next(error);
  }
});

rolesRouter.post('/', async (req, res, next) => {
  try {
    const input = createRoleSchema.parse(req.body);
    const role = await createRole(input, req.currentUser!.id, requestMetaFrom(req));
    res.status(201).json({ role });
  } catch (error) {
    next(error);
  }
});

rolesRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = updateRoleSchema.parse(req.body);
    const role = await updateRole(id, input, req.currentUser!.id, requestMetaFrom(req));
    res.status(200).json({ role });
  } catch (error) {
    next(error);
  }
});

rolesRouter.post('/:id/duplicate', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = duplicateRoleSchema.parse(req.body);
    const role = await duplicateRole(id, input, req.currentUser!.id, requestMetaFrom(req));
    res.status(201).json({ role });
  } catch (error) {
    next(error);
  }
});

rolesRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    await deleteRole(id, req.currentUser!.id, requestMetaFrom(req));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
