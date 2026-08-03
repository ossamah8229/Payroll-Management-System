import { Router } from 'express';
import { PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { exportPayrollSummaryToCsv, exportPayrollSummaryToXlsx, getPayrollSummaryReport } from './reports.service';

function requireCycleIdQuery(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) {
    throw badRequest('A ?cycleId= query parameter is required');
  }
  return raw;
}

function parseSiteIdsQuery(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  const ids = values.flatMap((value) => String(value).split(',')).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function parsePageQuery(raw: unknown): number | undefined {
  return typeof raw === 'string' && raw ? Number(raw) : undefined;
}

/**
 * Phase 8B Checkpoint 1 — Reports module. Mounted at `/api/v1/reports` (`app.ts`), gated exclusively
 * by the existing, already-seeded `reports:view` permission (Phase 8A investigation report §11 —
 * reused as-is, no new `reports:export` or other permission created this checkpoint; view and export
 * share the same gate, matching Bank Sheets'/Statements'/Payslips' own precedent of a single
 * view-and-export permission per module).
 *
 * Read-only throughout — no route in this module ever writes to `PayrollEntry`, `PayrollCycle`,
 * `Employee`, `Correction`, `BalanceAdjustment`, `Advance`, or any other payroll/financial record
 * (Checkpoint 1 brief, architectural decision 2).
 *
 * Both the JSON view and every export are audited (`report.viewed`/`report.exported`), following the
 * "audit the view, not just the export" convention `statements.routes.ts` already established —
 * `metadata.reportType` distinguishes which report within this module, so future reports (Employee
 * Payroll History, Deduction Report, etc.) reuse the same two action names rather than minting a new
 * one per report.
 */
export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get('/payroll-summary', requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res, next) => {
  try {
    const cycleId = requireCycleIdQuery(req.query.cycleId);
    const siteIds = parseSiteIdsQuery(req.query.siteIds);
    const page = parsePageQuery(req.query.page);
    const pageSize = parsePageQuery(req.query.pageSize);

    const report = await getPayrollSummaryReport(req.currentUser!, { cycleId, siteIds, page, pageSize });

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.viewed',
      entityType: 'PayrollCycle',
      entityId: cycleId,
      metadata: {
        reportType: 'payroll_summary',
        siteIds: report.filters.siteIds,
        page: report.page,
        pageSize: report.pageSize,
        siteRowCount: report.total,
      },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
});

/** Writes its own summary `AuditLog` entry per export, one per operation (mirrors Bank Sheet's/
 * Statements' own `*.export`/`*.exported` precedent) — never one row per site. Always exports the
 * complete filtered report, never just the requesting client's current pagination page (see
 * `reports.service.ts`'s own doc comment). */
reportsRouter.get('/payroll-summary/export', requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res, next) => {
  try {
    const cycleId = requireCycleIdQuery(req.query.cycleId);
    const siteIds = parseSiteIdsQuery(req.query.siteIds);
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';

    const { buffer, rowCount, cycle } =
      format === 'xlsx'
        ? await exportPayrollSummaryToXlsx(req.currentUser!, { cycleId, siteIds })
        : await exportPayrollSummaryToCsv(req.currentUser!, { cycleId, siteIds });

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.exported',
      entityType: 'PayrollCycle',
      entityId: cycleId,
      metadata: { reportType: 'payroll_summary', format, siteIds: siteIds ?? null, rowCount },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const period = `${cycle.year}-${String(cycle.month).padStart(2, '0')}`;
    const filename = `payroll-summary-${period}.${format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader(
      'Content-Type',
      format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
    );
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});
