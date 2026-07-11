import { Router } from 'express';
import { PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { getUnitReleaseStatus, releaseProjectUnit } from './payroll-release.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

function requireSiteIdQuery(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) {
    throw badRequest('A ?siteId= query parameter is required');
  }
  return raw;
}

/** Mounted at /api/v1/payroll-cycles/:cycleId/units — the Salary Release module's own routes,
 * nested under a cycle the same way Payroll Entry's are (docs/architecture/database/release.md
 * §12b). Mounted ahead of payrollCyclesRouter so Express matches this more specific path first,
 * same reasoning as payrollCycleEntriesRouter. */
export const payrollUnitReleasesRouter = Router({ mergeParams: true });

payrollUnitReleasesRouter.use(requireAuth);

// View access is shared with Payroll Staff (their own `payroll:entry` grant already implies
// view) — Finance's `payroll:view` is deliberately narrower and holds no edit permission.
const VIEW_PERMISSIONS = [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_VIEW];

payrollUnitReleasesRouter.get('/', requirePermission(VIEW_PERMISSIONS), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const siteId = requireSiteIdQuery(req.query.siteId);
    const units = await getUnitReleaseStatus(req.currentUser!, cycleId, siteId);
    res.status(200).json({ units });
  } catch (error) {
    next(error);
  }
});

// Finance-only (or Master User) — Payroll Staff never holds `payroll:release`
// (docs/architecture/authentication.md's "Finance's permission set").
payrollUnitReleasesRouter.post(
  '/:unitId/release',
  requirePermission(PERMISSIONS.PAYROLL_RELEASE),
  async (req, res, next) => {
    try {
      const cycleId = requireIdParam(req.params.cycleId);
      const unitId = requireIdParam(req.params.unitId);
      // releaseProjectUnit owns its own audit logging inside the release transaction — the route
      // never logs a second, redundant entry after the fact (same convention as createPayrollCycle).
      const result = await releaseProjectUnit(req.currentUser!, cycleId, unitId, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);
