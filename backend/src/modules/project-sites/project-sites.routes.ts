import { Router } from 'express';
import multer from 'multer';
import { createProjectSiteSchema, PERMISSIONS, updateProjectSiteSchema } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { isMasterAdmin } from '../../common/authz-policy';
import { recordAuditLog } from '../audit-log/audit-log.service';
import {
  createProjectSite,
  deleteProjectSite,
  getProjectSite,
  listProjectSites,
  updateProjectSite,
} from './project-sites.service';
import {
  generateProjectSiteImportTemplate,
  importProjectSites,
  parseProjectSiteImportFile,
} from './project-sites-import-export.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const projectSitesRouter = Router();

projectSitesRouter.use(requireAuth);

/**
 * Post-Phase-5 Stabilization Checkpoint 4B remediation — `GET /sites`/`GET /sites/:id` previously
 * carried no permission gate at all (any authenticated user, any role), which let a direct URL to
 * the Project Sites admin page render for a role the sidebar hides it from (Checkpoint 4B
 * validation finding). `listProjectSites` (project-sites.service.ts) scope-filters its results
 * (Master Admin and any `sites:manage` holder see every site; everyone else only their own
 * `UserSiteAssignment` rows) — this permission check gates who can reach it in the first place.
 *
 * This is deliberately an any-of list, not `sites:manage` alone: this endpoint is the shared site
 * lookup nearly every operational page in the app depends on for a dropdown/filter (Employee
 * Registry, Payroll Entry, Salary Release, Bank Sheet, Cash Receiving, Advances, Payslips,
 * Corrections, User site-assignment) — gating it to `sites:manage` alone would have broken every
 * one of those legitimate payroll/employee workflows. Every permission below corresponds to a real,
 * grep-verified frontend consumer of `useProjectSites()`; a permission with no current site-data
 * consumer (`banks:manage`, `settings:manage`, `audit-log:view`, `tasks:manage`) is deliberately
 * excluded rather than added speculatively.
 */
const SITE_LOOKUP_PERMISSIONS = [
  PERMISSIONS.SITES_MANAGE,
  PERMISSIONS.EMPLOYEES_VIEW,
  PERMISSIONS.EMPLOYEES_CREATE,
  PERMISSIONS.EMPLOYEES_EDIT,
  PERMISSIONS.PAYROLL_ENTRY,
  PERMISSIONS.PAYROLL_VIEW,
  PERMISSIONS.PAYROLL_RELEASE,
  PERMISSIONS.BANK_SHEETS_VIEW,
  PERMISSIONS.CORRECTIONS_APPROVE,
  PERMISSIONS.ADVANCES_MANAGE,
  PERMISSIONS.PAYSLIPS_VIEW,
  PERMISSIONS.USERS_MANAGE,
];

projectSitesRouter.get('/', requirePermission(SITE_LOOKUP_PERMISSIONS), async (req, res, next) => {
  try {
    const sites = await listProjectSites(req.currentUser!);
    res.status(200).json({ sites });
  } catch (error) {
    next(error);
  }
});

// Import Template Contract checkpoint (Project Site extension) — registered ahead of `GET /:id`,
// a distinct static path that would otherwise be shadowed by the `:id` param route below (an
// upload to "/import-template" would resolve as `getProjectSite('import-template')` instead).
// Gated to `sites:manage` alone (not the broader `SITE_LOOKUP_PERMISSIONS`), the same permission
// `POST /sites` itself requires — Part 3: a user who cannot create a Project Site through the
// normal UI must not be able to download the import template or call the import endpoint either.
projectSitesRouter.get('/import-template', requirePermission(PERMISSIONS.SITES_MANAGE), async (_req, res, next) => {
  try {
    const buffer = await generateProjectSiteImportTemplate();
    res.setHeader('Content-Disposition', 'attachment; filename="project-site-import-template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

projectSitesRouter.post(
  '/import',
  requirePermission(PERMISSIONS.SITES_MANAGE),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw badRequest('No file uploaded — expected a multipart field named "file"');
      }

      const rows = await parseProjectSiteImportFile(req.file.buffer, req.file.originalname);
      const result = await importProjectSites(req.currentUser!, rows, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'project-site.import',
        entityType: 'ProjectSite',
        metadata: { created: result.created, skippedCount: result.skipped.length },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

projectSitesRouter.get('/:id', requirePermission(SITE_LOOKUP_PERMISSIONS), async (req, res, next) => {
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
    const site = await createProjectSite(req.currentUser!, input);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'project-site.created',
      entityType: 'ProjectSite',
      entityId: site.id,
      metadata: { name: site.name },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    // RBAC Creator Ownership checkpoint — distinct from `user.sites_changed` (a Master User
    // manually editing someone's site list): this entry exists so the audit trail can tell the two
    // apart. `createProjectSite` (project-sites.service.ts) already skipped this assignment for a
    // Master Admin creator, who has no `UserSiteAssignment` rows by design.
    if (!isMasterAdmin(req.currentUser!)) {
      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'project-site.creator_assigned',
        entityType: 'ProjectSite',
        entityId: site.id,
        metadata: { userId: req.currentUser!.id, reason: 'auto-assigned to creator on site creation' },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
    }

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
