import { Router } from 'express';
import { createProjectSiteSchema, PERMISSIONS, updateProjectSiteSchema } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import {
  createProjectSite,
  deleteProjectSite,
  getProjectSite,
  listProjectSites,
  updateProjectSite,
} from './project-sites.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

export const projectSitesRouter = Router();

projectSitesRouter.use(requireAuth);

projectSitesRouter.get('/', async (req, res, next) => {
  try {
    const sites = await listProjectSites(req.currentUser!);
    res.status(200).json({ sites });
  } catch (error) {
    next(error);
  }
});

projectSitesRouter.get('/:id', async (req, res, next) => {
  try {
    const site = await getProjectSite(requireIdParam(req.params.id));
    res.status(200).json({ site });
  } catch (error) {
    next(error);
  }
});

projectSitesRouter.post('/', requirePermission(PERMISSIONS.SITES_MANAGE), async (req, res, next) => {
  try {
    const input = createProjectSiteSchema.parse(req.body);
    const site = await createProjectSite(input);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'project-site.created',
      entityType: 'ProjectSite',
      entityId: site.id,
      metadata: { name: site.name },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(201).json({ site });
  } catch (error) {
    next(error);
  }
});

projectSitesRouter.patch('/:id', requirePermission(PERMISSIONS.SITES_MANAGE), async (req, res, next) => {
  try {
    const input = updateProjectSiteSchema.parse(req.body);
    const site = await updateProjectSite(requireIdParam(req.params.id), input);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'project-site.updated',
      entityType: 'ProjectSite',
      entityId: site.id,
      metadata: { changes: input },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(200).json({ site });
  } catch (error) {
    next(error);
  }
});

projectSitesRouter.delete('/:id', requirePermission(PERMISSIONS.SITES_MANAGE), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    await deleteProjectSite(id);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'project-site.deleted',
      entityType: 'ProjectSite',
      entityId: id,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
