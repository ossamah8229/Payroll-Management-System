import { Router } from 'express';
import { PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { getDashboard } from './dashboard.service';

/**
 * Dashboard Checkpoint 1A (backend foundation, approved Checkpoint 0 architecture,
 * `docs/architecture/workflows/dashboard.md`). Mounted at `/api/v1/dashboard` (`app.ts`) — the
 * backend counterpart of the `/` frontend route (frozen §3: reuses the project's established
 * any-of permission mechanism, `reports:view OR payroll:view`, the same Salary Release Report
 * precedent — no new `dashboard:view` permission).
 *
 * **Outer gate only decides route reachability — never widget content.** Every widget's own
 * permission is independently re-checked inside `dashboard.service.ts`'s `getDashboard`, which is
 * what actually decides whether a given field in the response is populated or `null` (§3/§22
 * hostile-review questions 1–3). A caller passing this gate with only `payroll:view` (e.g. Finance)
 * receives `reports:view`-only widgets (`netPayroll`, `deductionBreakdown`, `siteSummary`) as `null`.
 *
 * Read-only, single aggregation call — no route in this module ever writes to `PayrollEntry`,
 * `Employee`, `CorrectionRequest`, `Advance`, or any other payroll/financial record. Audited as
 * `report.viewed`/`reportType: 'dashboard'`, matching `reports.routes.ts`'s own "audit the view"
 * convention for every other read-only financial aggregation in this codebase.
 */
export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/',
  requirePermission([PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYROLL_VIEW]),
  async (req, res, next) => {
    try {
      const dashboard = await getDashboard(req.currentUser!);

      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'report.viewed',
        entityType: 'PayrollCycle',
        entityId: dashboard.cycle?.id ?? null,
        metadata: { reportType: 'dashboard' },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(dashboard);
    } catch (error) {
      next(error);
    }
  },
);
