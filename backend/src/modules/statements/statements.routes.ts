import { Router } from 'express';
import { PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { getEmployeeStatement } from './statements.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

/**
 * Phase 7A Checkpoint 1 — Employee Statement of Account (backend ledger only, no frontend surface).
 * Mounted at `/api/v1/employees/:employeeId/statement`, ahead of `employeesRouter`'s own blanket
 * mount, the same "more-specific-sub-resource-router-first" convention as every other
 * `:parentId`-nested route in `app.ts` (Payslips, Bank Sheets, Cash Receiving, Corrections).
 *
 * Gated by a dedicated `statements:view` permission (not `payroll:entry`/`payroll:view`/
 * `corrections:approve`/`reports:view`) — a Statement discloses one employee's full cross-cycle
 * financial history, materially more sensitive than any single-cycle document; default grant
 * matches `payslips:view` exactly (Phase 7 architecture report, approved decision 8). Site-scoping
 * is enforced entirely inside `getEmployeeStatement` itself (historical `PayrollEntry.siteId`, never
 * live `Employee.siteId` — see that function's own doc comment), never inferred here.
 */
export const employeeStatementRouter = Router({ mergeParams: true });

employeeStatementRouter.use(requireAuth);

employeeStatementRouter.get('/', requirePermission(PERMISSIONS.STATEMENTS_VIEW), async (req, res, next) => {
  try {
    const employeeId = requireIdParam(req.params.employeeId);
    const fromCycleId = typeof req.query.fromCycleId === 'string' ? req.query.fromCycleId : undefined;
    const toCycleId = typeof req.query.toCycleId === 'string' ? req.query.toCycleId : undefined;

    const statement = await getEmployeeStatement(req.currentUser!, employeeId, { fromCycleId, toCycleId });

    // Individual per-employee financial-history disclosure — the same sensitivity bar Payslips'
    // `payslip.viewed` already established (`payslips.routes.ts`), applied here since a Statement is
    // at least as sensitive (it additionally exposes Corrections/Balance Adjustment/Advance detail
    // Payslips never shows). Deliberately audited even though this route makes no attempt to mutate
    // anything (Statements are read-only, Phase 7 report §15) — this is exactly what an "audit the
    // view, not just the export" reads matters for.
    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'statement.viewed',
      entityType: 'Employee',
      entityId: employeeId,
      metadata: {
        fromCycleId: statement.range.fromCycle?.id ?? null,
        toCycleId: statement.range.toCycle?.id ?? null,
        entryCount: statement.entries.length,
      },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(statement);
  } catch (error) {
    next(error);
  }
});
