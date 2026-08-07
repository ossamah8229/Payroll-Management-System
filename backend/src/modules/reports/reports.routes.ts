import { Router } from 'express';
import { z } from 'zod';
import {
  DEDUCTION_REPORT_EXPORT_MAX_ROWS,
  deductionReportExportQuerySchema,
  deductionReportListQuerySchema,
  EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS,
  employeePayrollHistoryEmployeeLookupQuerySchema,
  employeePayrollHistoryExportQuerySchema,
  employeePayrollHistoryListQuerySchema,
  OVERTIME_REPORT_EXPORT_MAX_ROWS,
  overtimeReportExportQuerySchema,
  overtimeReportListQuerySchema,
  PERMISSIONS,
  PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS,
  projectSitePayrollReportExportQuerySchema,
  projectSitePayrollReportListQuerySchema,
  type DeductionReportExportLimitError,
  type EmployeePayrollHistoryExportLimitError,
  type OvertimeReportExportLimitError,
  type ProjectSitePayrollReportExportLimitError,
} from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { exportPayrollSummaryToCsv, exportPayrollSummaryToXlsx, getPayrollSummaryReport } from './reports.service';
import {
  buildEmployeePayrollHistoryExportData,
  exportEmployeePayrollHistoryToCsv,
  exportEmployeePayrollHistoryToXlsx,
  getEmployeePayrollHistoryDetail,
  getEmployeePayrollHistoryList,
  searchEmployeePayrollHistoryEmployees,
} from './employee-payroll-history.service';
import {
  buildProjectSitePayrollReportExportData,
  exportProjectSitePayrollReportToCsv,
  exportProjectSitePayrollReportToXlsx,
  getProjectSitePayrollReportList,
} from './project-site-payroll.service';
import {
  buildDeductionReportExportData,
  exportDeductionReportToCsv,
  exportDeductionReportToXlsx,
  getDeductionReportList,
} from './deduction-report.service';
import {
  buildOvertimeReportExportData,
  exportOvertimeReportToCsv,
  exportOvertimeReportToXlsx,
  getOvertimeReportList,
} from './overtime-report.service';

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

/**
 * Employee Payroll History (Phase 7 Reports, Checkpoint 1A). Gated by `statements:view`, not
 * `reports:view` (approved decision 1) — this report exposes one employee's cross-cycle payroll
 * history, the same sensitivity class Statements/Payslips already established a dedicated
 * permission for, not Payroll Summary's own company-wide-aggregate shape. Lives under this
 * module's `/api/v1/reports` mount for now (frontend navigation is a later checkpoint's own
 * decision, not this one's).
 *
 * **Route order matters**: `/employee-payroll-history/employees` and
 * `/employee-payroll-history/export` are both registered *before*
 * `/employee-payroll-history/:entryId` — Express matches routes in registration order, so if the
 * param route were registered first, a request to either static path would incorrectly match it
 * with `entryId` bound to the literal string `"employees"`/`"export"`.
 */
const EMPLOYEE_PAYROLL_HISTORY_PERMISSION = requirePermission(PERMISSIONS.STATEMENTS_VIEW);

reportsRouter.get('/employee-payroll-history', EMPLOYEE_PAYROLL_HISTORY_PERMISSION, async (req, res, next) => {
  try {
    const query = employeePayrollHistoryListQuerySchema.parse(req.query);
    const report = await getEmployeePayrollHistoryList(req.currentUser!, query);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.viewed',
      entityType: 'PayrollEntry',
      entityId: null,
      metadata: { reportType: 'employee_payroll_history', page: report.page, pageSize: report.pageSize, total: report.total },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
});

/** No audit log on this discovery endpoint — matches `statements.routes.ts`'s own
 * `statementEmployeesRouter` precedent for the identical historical-lookup query. */
reportsRouter.get('/employee-payroll-history/employees', EMPLOYEE_PAYROLL_HISTORY_PERMISSION, async (req, res, next) => {
  try {
    const query = employeePayrollHistoryEmployeeLookupQuerySchema.parse(req.query);
    const result = await searchEmployeePayrollHistoryEmployees(req.currentUser!, query);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Preflight-counts before generating any CSV/XLSX output (approved decision 2) —
 * `buildEmployeePayrollHistoryExportData` itself never fetches/maps a single row once
 * `totalMatching` exceeds `EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS`, so the structured
 * `EmployeePayrollHistoryExportLimitError` below is always returned *before* any expensive work,
 * never after a truncated attempt.
 */
reportsRouter.get('/employee-payroll-history/export', EMPLOYEE_PAYROLL_HISTORY_PERMISSION, async (req, res, next) => {
  try {
    const query = employeePayrollHistoryExportQuerySchema.parse(req.query);
    const data = await buildEmployeePayrollHistoryExportData(req.currentUser!, query);

    if (data.totalMatching > EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS) {
      const errorBody: EmployeePayrollHistoryExportLimitError = {
        code: 'EXPORT_ROW_LIMIT_EXCEEDED',
        matchingCount: data.totalMatching,
        maxRows: EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS,
        message: `This export matches ${data.totalMatching} rows, which exceeds the ${EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS}-row limit for a single export. Narrow your filters (employee, site, or cycle range) and try again.`,
      };
      res.status(413).json({ error: errorBody });
      return;
    }

    const { buffer, rowCount } =
      query.format === 'xlsx' ? await exportEmployeePayrollHistoryToXlsx(data.rows) : exportEmployeePayrollHistoryToCsv(data.rows);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.exported',
      entityType: 'PayrollEntry',
      entityId: null,
      metadata: { reportType: 'employee_payroll_history', format: query.format, rowCount },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const filename = `employee-payroll-history.${query.format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader(
      'Content-Type',
      query.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * Entry-oriented detail (approved decision 4) — authorizes strictly against the entry's own
 * historical `siteId`, returning 404 (never 403) for both a nonexistent and an inaccessible
 * entry, matching Statements'/Payslips' own "reveal nothing" posture for a single-record detail
 * endpoint. `entryId` is validated as a UUID before reaching the service — a malformed value is a
 * 400, never passed through to Prisma.
 */
reportsRouter.get('/employee-payroll-history/:entryId', EMPLOYEE_PAYROLL_HISTORY_PERMISSION, async (req, res, next) => {
  try {
    const entryId = z.string().uuid('entryId must be a valid UUID').parse(req.params.entryId);
    const detail = await getEmployeePayrollHistoryDetail(req.currentUser!, entryId);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.viewed',
      entityType: 'PayrollEntry',
      entityId: entryId,
      metadata: { reportType: 'employee_payroll_history_detail' },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(detail);
  } catch (error) {
    next(error);
  }
});

/**
 * Project Site Payroll Report (Phase 7 Reports, Checkpoint 1A, approved Checkpoint 0 architecture
 * review 2026-08-06). Gated by `reports:view` — the same permission Payroll Summary already uses,
 * never `statements:view` (frozen decision 2: this report is the row-level drill-down beneath
 * Payroll Summary's own site-aggregate rows, always scoped to exactly one cycle, not a
 * cross-cycle, employee-searchable history — Employee Payroll History's own, more sensitive,
 * disclosure class). No detail route exists in V1 (frozen decision 4) — every field the frontend
 * will ever need for this report lives on the list row itself.
 */
reportsRouter.get('/project-site-payroll', requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res, next) => {
  try {
    const query = projectSitePayrollReportListQuerySchema.parse(req.query);
    const report = await getProjectSitePayrollReportList(req.currentUser!, query);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.viewed',
      entityType: 'PayrollCycle',
      entityId: query.cycleId,
      metadata: { reportType: 'project_site_payroll', page: report.page, pageSize: report.pageSize, total: report.total },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
});

/**
 * Preflight-counts before generating any CSV/XLSX output, mirroring Employee Payroll History's
 * own `/employee-payroll-history/export` — `buildProjectSitePayrollReportExportData` itself never
 * fetches/maps a single row once `totalMatching` exceeds
 * `PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS`, so the structured
 * `ProjectSitePayrollReportExportLimitError` below is always returned *before* any expensive work.
 * Always the complete filtered dataset — no `page`/`pageSize` accepted at all.
 */
reportsRouter.get('/project-site-payroll/export', requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res, next) => {
  try {
    const query = projectSitePayrollReportExportQuerySchema.parse(req.query);
    const data = await buildProjectSitePayrollReportExportData(req.currentUser!, query);

    if (data.totalMatching > PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS) {
      const errorBody: ProjectSitePayrollReportExportLimitError = {
        code: 'EXPORT_ROW_LIMIT_EXCEEDED',
        matchingCount: data.totalMatching,
        maxRows: PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS,
        message: `This export matches ${data.totalMatching} rows, which exceeds the ${PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS}-row limit for a single export. Narrow your filters (site, unit, or row status) and try again.`,
      };
      res.status(413).json({ error: errorBody });
      return;
    }

    const { buffer, rowCount } =
      query.format === 'xlsx'
        ? await exportProjectSitePayrollReportToXlsx(data.rows)
        : exportProjectSitePayrollReportToCsv(data.rows);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.exported',
      entityType: 'PayrollCycle',
      entityId: query.cycleId,
      metadata: { reportType: 'project_site_payroll', format: query.format, rowCount },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const filename = `project-site-payroll.${query.format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader(
      'Content-Type',
      query.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * Deduction Report (Phase 7 Reports, Checkpoint 1A, approved Checkpoint 0 architecture review
 * 2026-08-07). Gated by `reports:view` — the same permission Payroll Summary/Project Site Payroll
 * Report already use, never `statements:view` (frozen decision: a single-cycle, site-scoped,
 * deduction-type-centric operational report, not a cross-cycle, employee-searchable history). No
 * detail route exists in V1 — every field the frontend will ever need for this report lives on the
 * list row itself.
 */
reportsRouter.get('/deduction-report', requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res, next) => {
  try {
    const query = deductionReportListQuerySchema.parse(req.query);
    const report = await getDeductionReportList(req.currentUser!, query);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.viewed',
      entityType: 'PayrollCycle',
      entityId: query.cycleId,
      metadata: { reportType: 'deduction_report', page: report.page, pageSize: report.pageSize, total: report.total },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
});

/**
 * Preflight-counts before generating any CSV/XLSX output, mirroring every other report's own
 * export route — `buildDeductionReportExportData` itself never fetches/maps a single row once
 * `totalMatching` exceeds `DEDUCTION_REPORT_EXPORT_MAX_ROWS`, so the structured
 * `DeductionReportExportLimitError` below is always returned *before* any expensive work. Always
 * the complete filtered dataset — no `page`/`pageSize` accepted at all.
 */
reportsRouter.get('/deduction-report/export', requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res, next) => {
  try {
    const query = deductionReportExportQuerySchema.parse(req.query);
    const data = await buildDeductionReportExportData(req.currentUser!, query);

    if (data.totalMatching > DEDUCTION_REPORT_EXPORT_MAX_ROWS) {
      const errorBody: DeductionReportExportLimitError = {
        code: 'EXPORT_ROW_LIMIT_EXCEEDED',
        matchingCount: data.totalMatching,
        maxRows: DEDUCTION_REPORT_EXPORT_MAX_ROWS,
        message: `This export matches ${data.totalMatching} rows, which exceeds the ${DEDUCTION_REPORT_EXPORT_MAX_ROWS}-row limit for a single export. Narrow your filters (site, unit, deduction type, or row status) and try again.`,
      };
      res.status(413).json({ error: errorBody });
      return;
    }

    const { buffer, rowCount } =
      query.format === 'xlsx' ? await exportDeductionReportToXlsx(data.rows) : exportDeductionReportToCsv(data.rows);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.exported',
      entityType: 'PayrollCycle',
      entityId: query.cycleId,
      metadata: { reportType: 'deduction_report', format: query.format, rowCount },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const filename = `deduction-report.${query.format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader(
      'Content-Type',
      query.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * Overtime Report (Phase 7 Reports, Checkpoint 1A, approved Checkpoint 0 architecture review
 * 2026-08-07). Gated by `reports:view` — the same permission Payroll Summary/Project Site Payroll
 * Report/Deduction Report already use, never `statements:view` (frozen decision: a single-cycle,
 * site-scoped operational report, not a cross-cycle, employee-searchable history).
 *
 * **Report grain is `PayrollEntryWorkLine`, not `PayrollEntry`** — an intentional, frozen
 * architectural exception from every sibling report in this module (see
 * `overtime-report.service.ts`'s own doc comment for the full rationale). An employee with 2 work
 * lines this cycle can appear as 2 rows. No detail route exists in V1 — every field the frontend
 * will ever need for this report lives on the list row itself.
 */
reportsRouter.get('/overtime-report', requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res, next) => {
  try {
    const query = overtimeReportListQuerySchema.parse(req.query);
    const report = await getOvertimeReportList(req.currentUser!, query);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.viewed',
      entityType: 'PayrollCycle',
      entityId: query.cycleId,
      metadata: { reportType: 'overtime_report', page: report.page, pageSize: report.pageSize, total: report.total },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
});

/**
 * Preflight-counts before generating any CSV/XLSX output, mirroring every other report's own
 * export route — `buildOvertimeReportExportData` itself never fetches/maps a single row once
 * `totalMatching` exceeds `OVERTIME_REPORT_EXPORT_MAX_ROWS`, so the structured
 * `OvertimeReportExportLimitError` below is always returned *before* any expensive work. Always
 * the complete filtered dataset — no `page`/`pageSize` accepted at all.
 */
reportsRouter.get('/overtime-report/export', requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res, next) => {
  try {
    const query = overtimeReportExportQuerySchema.parse(req.query);
    const data = await buildOvertimeReportExportData(req.currentUser!, query);

    if (data.totalMatching > OVERTIME_REPORT_EXPORT_MAX_ROWS) {
      const errorBody: OvertimeReportExportLimitError = {
        code: 'EXPORT_ROW_LIMIT_EXCEEDED',
        matchingCount: data.totalMatching,
        maxRows: OVERTIME_REPORT_EXPORT_MAX_ROWS,
        message: `This export matches ${data.totalMatching} rows, which exceeds the ${OVERTIME_REPORT_EXPORT_MAX_ROWS}-row limit for a single export. Narrow your filters (site, unit, or Has Overtime) and try again.`,
      };
      res.status(413).json({ error: errorBody });
      return;
    }

    const { buffer, rowCount } =
      query.format === 'xlsx' ? await exportOvertimeReportToXlsx(data.rows) : exportOvertimeReportToCsv(data.rows);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'report.exported',
      entityType: 'PayrollCycle',
      entityId: query.cycleId,
      metadata: { reportType: 'overtime_report', format: query.format, rowCount },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const filename = `overtime-report.${query.format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader(
      'Content-Type',
      query.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});
