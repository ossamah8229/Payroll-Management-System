import { Router } from 'express';
import { PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { periodSlug, slugify } from '../payslips/payslips.routes';
import {
  exportStatementToCsv,
  exportStatementToXlsx,
  generateStatementPdf,
  getEmployeeStatement,
  searchStatementEmployees,
} from './statements.service';
import type { StatementEmployeeIdentity, StatementRange } from './statements.types';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

/** `{from-period}` or `{from-period}-to-{to-period}` (or `all` when no `PayrollCycle` exists at
 * all system-wide, the true empty-install case `resolveStatementRange` itself already special-
 * cases) — reuses Payslip's own `periodSlug` rather than adding a fourth independent "YYYY-MM,
 * zero-padded" implementation alongside Payslip's, Bank Sheet's, and Cash Receiving's. A single-
 * cycle Statement range collapses to one period slug, never a degenerate `X-to-X`. */
function rangeSlug(range: StatementRange): string {
  if (!range.fromCycle || !range.toCycle) return 'all';
  const from = periodSlug(range.fromCycle.year, range.fromCycle.month);
  const to = periodSlug(range.toCycle.year, range.toCycle.month);
  return from === to ? from : `${from}-to-${to}`;
}

/** `employee-statement-{employee-code-or-short-id}-{period-slug}` — the shared name stem every
 * Statement export filename is built from (Phase 7B Checkpoint 1: PDF; Checkpoint 2: XLSX/CSV).
 * Deliberately excludes CNIC and every banking field (§12 of Checkpoint 1's own requirements),
 * matching Payslip's own archive-entry-name fallback (`payslips.routes.ts`'s
 * `buildArchiveEntryName`): a blank/all-stripped employee code (e.g. an all-emoji code, `slugify`'s
 * own edge case) falls back to the first 8 characters of the employee's id rather than producing an
 * empty filename segment. Not exported — `buildStatementPdfFilename`/`buildStatementExportFilename`
 * below are the only public filename builders, each appending its own extension. */
function buildStatementFilenameStem(employee: StatementEmployeeIdentity, range: StatementRange): string {
  const codeOrShortId = employee.employeeCode?.trim() || employee.employeeId.slice(0, 8);
  const base = slugify(codeOrShortId) || 'employee';
  return `employee-statement-${base}-${rangeSlug(range)}`;
}

/** `employee-statement-{employee-code-or-short-id}-{period-slug}.pdf` — the dedicated PDF filename
 * builder, kept as its own named function (rather than a generic `extension` parameter) so the
 * `/pdf` route's own call site reads as "build the PDF filename," not "build an export filename,
 * happening to be PDF this time." */
function buildStatementPdfFilename(employee: StatementEmployeeIdentity, range: StatementRange): string {
  return `${buildStatementFilenameStem(employee, range)}.pdf`;
}

/** `employee-statement-{employee-code-or-short-id}-{period-slug}.{extension}` — the shared XLSX/CSV
 * filename builder (Phase 7B Checkpoint 2). PDF has its own dedicated `buildStatementPdfFilename`
 * above, not this function — XLSX and CSV are similar enough (both new in the same checkpoint, both
 * data-export formats) to justify one parameterized builder between the two of them. */
function buildStatementExportFilename(
  employee: StatementEmployeeIdentity,
  range: StatementRange,
  extension: 'xlsx' | 'csv',
): string {
  return `${buildStatementFilenameStem(employee, range)}.${extension}`;
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

/**
 * Phase 7B Checkpoint 1 — Statement PDF export. Mounted at the same `:employeeId/statement` base
 * as the JSON route above (`/api/v1/employees/:employeeId/statement/pdf`), gated by the identical
 * `statements:view` permission — no separate `statements:export` key, matching `PAYSLIPS_VIEW`'s
 * own precedent of gating view and export uniformly (Phase 7B architecture review, approved
 * decision). Accepts the exact same `fromCycleId`/`toCycleId` range parameters as the JSON route,
 * resolved by the identical `getEmployeeStatement()` call — every RBAC/historical-site-scope/
 * concealment rule (including the deliberate "reveal nothing" 404 for zero Site overlap) is
 * enforced there, never re-implemented or weakened here.
 *
 * **Always `Content-Disposition: attachment` — no `?disposition=inline` mode** (Phase 7B
 * Checkpoint 1 refinement, post-review). Unlike Payslips (whose single `/pdf` route deliberately
 * serves both in-app preview and download, `payslips.routes.ts`'s own doc comment, §8), a Statement
 * will get its own dedicated browser-Print workflow in a later Phase 7B checkpoint — this endpoint's
 * one responsibility is the official downloadable PDF, never an inline preview, so there is nothing
 * for a second disposition mode to serve here. Standardizing on attachment keeps the route, its
 * tests, and any future frontend caller simpler than maintaining two rarely-differentiated modes.
 *
 * Audited as a distinct `statement.exported` action — never `statement.viewed` (reserved for the
 * JSON route above), matching Payslip's own `payslip.viewed`/`payslip.exported` split exactly. No
 * salary/ledger content is ever recorded in the audit metadata, only identifiers/counts/range.
 */
employeeStatementRouter.get('/pdf', requirePermission(PERMISSIONS.STATEMENTS_VIEW), async (req, res, next) => {
  try {
    const employeeId = requireIdParam(req.params.employeeId);
    const fromCycleId = typeof req.query.fromCycleId === 'string' ? req.query.fromCycleId : undefined;
    const toCycleId = typeof req.query.toCycleId === 'string' ? req.query.toCycleId : undefined;

    const { buffer, employee, range, entryCount } = await generateStatementPdf(
      req.currentUser!,
      employeeId,
      { fromCycleId, toCycleId },
      { generatedByName: req.currentUser!.name, generatedAt: new Date() },
    );

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'statement.exported',
      entityType: 'Employee',
      entityId: employeeId,
      metadata: {
        format: 'pdf',
        requestedFromCycleId: fromCycleId ?? null,
        requestedToCycleId: toCycleId ?? null,
        resolvedFromCycleId: range.fromCycle?.id ?? null,
        resolvedToCycleId: range.toCycle?.id ?? null,
        entryCount,
        disposition: 'attachment',
      },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const filename = buildStatementPdfFilename(employee, range);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * Phase 7B Checkpoint 2 — Statement XLSX/CSV export. Mounted at the same `:employeeId/statement`
 * base as `/pdf` (Checkpoint 1), gated by the identical `statements:view` permission — no separate
 * `statements:export` key, matching `/pdf`'s own precedent exactly. Every RBAC/historical-site-
 * scope/concealment rule is enforced entirely inside `getEmployeeStatement()`, called exactly once
 * by `exportStatementToXlsx`/`exportStatementToCsv` — never re-implemented or weakened here, the
 * same relationship `/pdf` already establishes with `generateStatementPdf`.
 *
 * Always `Content-Disposition: attachment`, matching `/pdf`'s own "no inline mode" rule — a
 * Statement export has exactly one responsibility (download), never an inline preview.
 *
 * Audited as the same `statement.exported` action `/pdf` already uses — never a per-format action
 * name (`statement.exported.xlsx`/`.csv`) — with `metadata.format` distinguishing `'xlsx'`/`'csv'`
 * from `/pdf`'s own `'pdf'`, matching Bank Sheets'/Cash Receiving's own "one action, format in
 * metadata" convention for a module with more than one export format.
 */
employeeStatementRouter.get('/xlsx', requirePermission(PERMISSIONS.STATEMENTS_VIEW), async (req, res, next) => {
  try {
    const employeeId = requireIdParam(req.params.employeeId);
    const fromCycleId = typeof req.query.fromCycleId === 'string' ? req.query.fromCycleId : undefined;
    const toCycleId = typeof req.query.toCycleId === 'string' ? req.query.toCycleId : undefined;

    const { buffer, employee, range, entryCount } = await exportStatementToXlsx(
      req.currentUser!,
      employeeId,
      { fromCycleId, toCycleId },
      { generatedByName: req.currentUser!.name, generatedAt: new Date() },
    );

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'statement.exported',
      entityType: 'Employee',
      entityId: employeeId,
      metadata: {
        format: 'xlsx',
        requestedFromCycleId: fromCycleId ?? null,
        requestedToCycleId: toCycleId ?? null,
        resolvedFromCycleId: range.fromCycle?.id ?? null,
        resolvedToCycleId: range.toCycle?.id ?? null,
        entryCount,
        disposition: 'attachment',
      },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const filename = buildStatementExportFilename(employee, range, 'xlsx');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

/** See the `/xlsx` route's own doc comment above — identical in every respect except format. */
employeeStatementRouter.get('/csv', requirePermission(PERMISSIONS.STATEMENTS_VIEW), async (req, res, next) => {
  try {
    const employeeId = requireIdParam(req.params.employeeId);
    const fromCycleId = typeof req.query.fromCycleId === 'string' ? req.query.fromCycleId : undefined;
    const toCycleId = typeof req.query.toCycleId === 'string' ? req.query.toCycleId : undefined;

    const { buffer, employee, range, entryCount } = await exportStatementToCsv(
      req.currentUser!,
      employeeId,
      { fromCycleId, toCycleId },
      { generatedByName: req.currentUser!.name, generatedAt: new Date() },
    );

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'statement.exported',
      entityType: 'Employee',
      entityId: employeeId,
      metadata: {
        format: 'csv',
        requestedFromCycleId: fromCycleId ?? null,
        requestedToCycleId: toCycleId ?? null,
        resolvedFromCycleId: range.fromCycle?.id ?? null,
        resolvedToCycleId: range.toCycle?.id ?? null,
        entryCount,
        disposition: 'attachment',
      },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const filename = buildStatementExportFilename(employee, range, 'csv');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * Phase 7A Checkpoint 2 correction — the Statements picker's own employee-discovery endpoint.
 * Mounted separately at `/api/v1/statements/employees` (`app.ts`), deliberately **not** folded
 * into the general `GET /api/v1/employees` (`employeesRouter`) — that endpoint's own
 * `Employee.siteId`-based scoping is correct for its real callers (Advances, Corrections) and must
 * not be weakened or overloaded with a second, historical semantics that would apply everywhere it
 * mounts. Gated by the same `statements:view` permission as the Statement itself, never
 * `employees:view` — a caller must already be authorized to view Statements to search for one, and
 * this is a strictly narrower, minimum-identity result than either permission alone would imply.
 * `searchStatementEmployees` itself is the sole authority for the historical-site-scoping rule —
 * see its own doc comment (`statements.service.ts`).
 */
export const statementEmployeesRouter = Router();

statementEmployeesRouter.use(requireAuth);

statementEmployeesRouter.get('/', requirePermission(PERMISSIONS.STATEMENTS_VIEW), async (req, res, next) => {
  try {
    const result = await searchStatementEmployees(req.currentUser!, {
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      siteId: typeof req.query.siteId === 'string' ? req.query.siteId : undefined,
      unitId: typeof req.query.unitId === 'string' ? req.query.unitId : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
