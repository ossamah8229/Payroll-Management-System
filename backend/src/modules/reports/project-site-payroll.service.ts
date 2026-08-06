import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import {
  calcNet,
  sumMoney,
  type CalcNetResult,
  PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS,
  type ProjectSitePayrollReportExportQuery,
  type ProjectSitePayrollReportListQuery,
  type ProjectSitePayrollReportListResponse,
  type ProjectSitePayrollReportRow,
  type ProjectSitePayrollReportSortDirection,
  type ProjectSitePayrollReportSortField,
  type ProjectSitePayrollReportTotals,
  type ProjectSitePayrollReportUnitRef,
} from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { stringifyCsvSafe } from '../../common/import-export';
import { excelColumnWidth } from '../../common/excel-utils';
import { assertSiteAccess, getAccessibleSiteIds } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import {
  deriveEmployeePayrollHistoryRowStatus,
  employeePayrollHistoryRowStatusWhereClause,
} from './employee-payroll-history-status';

/**
 * Phase 7 Reports, Project Site Payroll Report Checkpoint 1A (approved Checkpoint 0 architecture
 * review, 2026-08-06; frozen decisions carried over verbatim from the authorizing instruction).
 *
 * **Report scope (frozen decision 1):** "Which employees were paid at the selected Project
 * Site(s) during one payroll cycle?" One row = one `PayrollEntry`. Not a cross-cycle report —
 * `cycleId` is required and singular, mirroring Payroll Summary's own "one cycle at a time" shape
 * (`reports.service.ts`), never Employee Payroll History's own cycle-range browser.
 *
 * **Permission (frozen decision 2):** `reports:view`, not `statements:view` — this report is the
 * row-level drill-down beneath Payroll Summary's own site-aggregate rows, not a cross-cycle,
 * employee-searchable history (Employee Payroll History's own, more sensitive, disclosure class).
 * Site authorization reuses `assertSiteAccess`/`getAccessibleSiteIds` exactly as both existing
 * reports already do; historical authorization is always `PayrollEntry.siteId`, never
 * `Employee.siteId`.
 *
 * **Financial meaning (frozen decision 6):** every row's monetary figures come from canonical
 * `calcNet` applied to the entry's own *stored* columns — the immutable, as-released figure. A
 * `Correction` never mutates those stored columns; `correctionBalancePayable`/
 * `correctionBalanceRecovery` are shown as separate, already-materialized-settlement fields
 * (Payroll Summary's own established convention), never replayed into Net Salary and never a
 * second Net Salary formula.
 *
 * **Unit (frozen decision 5):** filtering and "Primary Unit (+N more)" display only — never a
 * per-Unit financial total/allocation. There is no mathematically correct way to split an entry's
 * aggregate deductions (EOBI, advances, fines, corrections) across multiple work lines with the
 * existing schema (those columns live on `PayrollEntry`, not `PayrollEntryWorkLine`), so this
 * checkpoint does not invent one.
 *
 * **No detail page/endpoint in V1 (frozen decision 4).** No drill-down beyond what the list row
 * itself already returns.
 */

// --- Filter resolution -------------------------------------------------------------------------

/** Mirrors `reports.service.ts`'s/`employee-payroll-history.service.ts`'s own `resolveSiteIdFilter`
 * exactly — explicit filter -> each site independently access-checked (403 on any inaccessible
 * site named, never silently narrowed); omitted -> the caller's full accessible scope, `undefined`
 * for unrestricted global authority. */
function resolveSiteIdFilter(currentUser: SessionUser, siteIds?: string[]): string[] | undefined {
  if (siteIds && siteIds.length > 0) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
    return siteIds;
  }
  return getAccessibleSiteIds(currentUser);
}

/** Mirrors `employee-payroll-history.service.ts`'s own `resolveUnitFilter` exactly — a named
 * `unitId` must itself be site-accessible, and (if a `siteIds` filter was also given) must belong
 * to one of those named sites, never silently ignored. */
async function resolveUnitFilter(
  currentUser: SessionUser,
  unitId: string | undefined,
  siteIdFilter: string[] | undefined,
): Promise<string | undefined> {
  if (!unitId) return undefined;
  const unit = await prisma.projectUnit.findUnique({ where: { id: unitId }, select: { siteId: true } });
  if (!unit) throw notFound('unitId does not reference an existing Project Unit');
  assertSiteAccess(currentUser, unit.siteId);
  if (siteIdFilter && !siteIdFilter.includes(unit.siteId)) {
    throw badRequest('unitId does not belong to any site in the requested siteIds filter');
  }
  return unitId;
}

interface ResolvedProjectSitePayrollReportFilters {
  where: Prisma.PayrollEntryWhereInput;
  cycle: { id: string; year: number; month: number; status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' };
}

/** The one validated-filter-construction function every list/totals/export query shares — mirrors
 * Employee Payroll History's own `resolveEmployeePayrollHistoryFilters` shape, narrowed to this
 * report's approved filter set only (frozen decisions — Filters section): Payroll Cycle
 * (required), Site (multi-select), Unit, Row Status, Has Correction. Deliberately no Employee
 * search, Designation, date/month range, roster status, or outstanding-balance filter. */
async function resolveProjectSitePayrollReportFilters(
  currentUser: SessionUser,
  query: Pick<ProjectSitePayrollReportListQuery, 'cycleId' | 'siteIds' | 'unitId' | 'rowStatus' | 'hasCorrection'>,
): Promise<ResolvedProjectSitePayrollReportFilters> {
  const cycle = await getPayrollCycle(query.cycleId);
  const siteIdFilter = resolveSiteIdFilter(currentUser, query.siteIds);
  const unitId = await resolveUnitFilter(currentUser, query.unitId, siteIdFilter);

  const where: Prisma.PayrollEntryWhereInput = {
    cycleId: query.cycleId,
    ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    ...(unitId && { workLines: { some: { unitId } } }),
    ...(query.rowStatus && employeePayrollHistoryRowStatusWhereClause(query.rowStatus)),
    ...(query.hasCorrection === true && { corrections: { some: {} } }),
    ...(query.hasCorrection === false && { corrections: { none: {} } }),
  };

  return { where, cycle: { id: cycle.id, year: cycle.year, month: cycle.month, status: cycle.status } };
}

// --- Row select/calc --------------------------------------------------------------------------

const ROW_SELECT = {
  id: true,
  siteId: true,
  employeeId: true,
  employeeNameSnapshot: true,
  designation: true,
  grossPay: true,
  allowance: true,
  leaveDays: true,
  leaveRate: true,
  eobiAmount: true,
  eobiApplicable: true,
  advanceDeduction: true,
  eidAdvanceDeduction: true,
  fine: true,
  correctionBalancePayable: true,
  correctionBalanceRecovery: true,
  hold: true,
  released: true,
  payoutOutcome: true,
  releasedAt: true,
  site: { select: { name: true } },
  employee: { select: { employeeCode: true, name: true } },
  workLines: {
    // Same deterministic `id` tie-break as Employee Payroll History's own `ROW_SELECT` — a
    // work line's `sortOrder` alone is not guaranteed unique (defaults to 0), so "the primary
    // work line" must stay deterministic even for two lines sharing the same `sortOrder`.
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    select: {
      sortOrder: true,
      days: true,
      otHours: true,
      otRate: true,
      cycleDays: true,
      unit: { select: { id: true, name: true, code: true } },
    },
  },
} satisfies Prisma.PayrollEntrySelect;

type RowEntry = Prisma.PayrollEntryGetPayload<{ select: typeof ROW_SELECT }>;

/** The adapter from this module's own narrowly-`select`ed row to shared `calcNet`'s string-based
 * input contract — identical in shape to `reports.service.ts`'s own `calcEntry` and
 * `employee-payroll-history.service.ts`'s own `calcEntryRow`, calling the exact same canonical
 * `calcNet` (never a second net-salary formula) against this module's own row shape. */
function calcEntryRow(entry: {
  grossPay: Prisma.Decimal;
  allowance: Prisma.Decimal;
  leaveDays: Prisma.Decimal;
  leaveRate: Prisma.Decimal | null;
  eobiAmount: Prisma.Decimal;
  eobiApplicable: boolean;
  advanceDeduction: Prisma.Decimal;
  eidAdvanceDeduction: Prisma.Decimal;
  fine: Prisma.Decimal;
  correctionBalancePayable: Prisma.Decimal;
  correctionBalanceRecovery: Prisma.Decimal;
  workLines: Array<{ sortOrder: number; days: Prisma.Decimal; otHours: Prisma.Decimal; otRate: Prisma.Decimal | null; cycleDays: number }>;
}): CalcNetResult {
  return calcNet({
    grossPay: entry.grossPay.toString(),
    allowance: entry.allowance.toString(),
    leaveDays: entry.leaveDays.toString(),
    leaveRate: entry.leaveRate?.toString() ?? null,
    eobiAmount: entry.eobiAmount.toString(),
    eobiApplicable: entry.eobiApplicable,
    advanceDeduction: entry.advanceDeduction.toString(),
    eidAdvanceDeduction: entry.eidAdvanceDeduction.toString(),
    fine: entry.fine.toString(),
    correctionBalancePayable: entry.correctionBalancePayable.toString(),
    correctionBalanceRecovery: entry.correctionBalanceRecovery.toString(),
    workLines: entry.workLines.map((line) => ({
      sortOrder: line.sortOrder,
      days: line.days.toString(),
      otHours: line.otHours.toString(),
      otRate: line.otRate?.toString() ?? null,
      cycleDays: line.cycleDays,
    })),
  });
}

// --- Batched correction-count lookup (never per-row) --------------------------------------------

async function fetchCorrectionCounts(entryIds: string[]): Promise<Map<string, number>> {
  if (entryIds.length === 0) return new Map();
  const grouped = await prisma.correction.groupBy({
    by: ['payrollEntryId'],
    where: { payrollEntryId: { in: entryIds } },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.payrollEntryId, row._count._all]));
}

function toUnitRef(unit: { id: string; name: string; code: string | null }): ProjectSitePayrollReportUnitRef {
  return { id: unit.id, name: unit.name, code: unit.code };
}

async function mapEntriesToRows(entries: RowEntry[]): Promise<ProjectSitePayrollReportRow[]> {
  const entryIds = entries.map((entry) => entry.id);
  const correctionCounts = await fetchCorrectionCounts(entryIds);

  return entries.map((entry) => {
    const calc = calcEntryRow(entry);
    const primaryLine = entry.workLines[0] ?? null;

    return {
      payrollEntryId: entry.id,
      employeeId: entry.employeeId,
      employeeCode: entry.employee.employeeCode,
      employeeName: entry.employeeNameSnapshot ?? entry.employee.name,
      siteId: entry.siteId,
      siteName: entry.site.name,
      primaryUnit: primaryLine ? toUnitRef(primaryLine.unit) : null,
      additionalUnitCount: Math.max(0, entry.workLines.length - 1),
      designation: entry.designation,
      grossPay: entry.grossPay.toFixed(2),
      allowance: entry.allowance.toFixed(2),
      eobiDeduction: calc.eobiDeduction,
      advanceDeduction: entry.advanceDeduction.toFixed(2),
      eidAdvanceDeduction: entry.eidAdvanceDeduction.toFixed(2),
      fine: entry.fine.toFixed(2),
      correctionBalancePayable: entry.correctionBalancePayable.toFixed(2),
      correctionBalanceRecovery: entry.correctionBalanceRecovery.toFixed(2),
      totalEarnings: calc.totalEarning,
      totalDeductions: calc.totalDeduction,
      netSalary: calc.netSalary,
      rowStatus: deriveEmployeePayrollHistoryRowStatus(entry),
      correctionCount: correctionCounts.get(entry.id) ?? 0,
      releasedAt: entry.releasedAt?.toISOString() ?? null,
    };
  });
}

// --- Deterministic ordering ---------------------------------------------------------------------

/**
 * Every branch ends with `{ id: 'asc' }` — the mandatory final tie-break, so offset pagination
 * never drifts between pages for two rows the primary key alone can't order. No `cycle`-based
 * tie-break anywhere (unlike Employee Payroll History's own `buildOrderBy`) — this report is
 * always exactly one cycle, so every row already shares the same `cycleId`.
 *
 * `rowStatus`'s own ordering is the same disclosed, documented approximation Employee Payroll
 * History's own `buildOrderBy` uses: it orders by the three real, stored columns that *determine*
 * status (`released`, `hold`, `payoutOutcome`), which groups every row of the same status
 * contiguously, but the relative order *between* groups follows Postgres's own boolean/enum
 * ordering, not the 5-state precedence rank — safe because sorting is a display convenience,
 * never a filter or a financial figure.
 */
function buildOrderBy(
  sortBy: Exclude<ProjectSitePayrollReportSortField, 'netSalary'>,
  dir: ProjectSitePayrollReportSortDirection,
): Prisma.PayrollEntryOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'employeeCode':
      return [{ employee: { employeeCode: dir } }, { id: 'asc' }];
    case 'employeeName':
      return [{ employee: { name: dir } }, { id: 'asc' }];
    case 'site':
      return [{ site: { name: dir } }, { employee: { name: 'asc' } }, { id: 'asc' }];
    case 'rowStatus':
      return [{ released: dir }, { hold: dir }, { payoutOutcome: dir }, { id: 'asc' }];
  }
}

// --- Totals ------------------------------------------------------------------------------------

const CALC_INPUT_SELECT = {
  grossPay: true,
  allowance: true,
  leaveDays: true,
  leaveRate: true,
  eobiAmount: true,
  eobiApplicable: true,
  advanceDeduction: true,
  eidAdvanceDeduction: true,
  fine: true,
  correctionBalancePayable: true,
  correctionBalanceRecovery: true,
  workLines: { select: { sortOrder: true, days: true, otHours: true, otRate: true, cycleDays: true } },
} satisfies Prisma.PayrollEntrySelect;

/**
 * Reuses Payroll Summary's own totals model (frozen decision 6) — the five status-breakdown
 * counts are plain, always-exact DB aggregates, combined with the caller's own filter via `AND`
 * (never a shallow spread-merge that could silently overwrite an existing `rowStatus` filter,
 * exactly the pitfall Employee Payroll History's own `computeEmployeePayrollHistoryTotals` already
 * documents). The monetary sums are computed the same bounded way Employee Payroll History's own
 * `netSalary`/totals logic already resolves the "not a stored column" conflict: fetched and summed
 * via canonical `calcNet`/`sumMoney` only when `matchingCount` is within
 * `PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS`; beyond it, `null` with `totalsComputed: false` —
 * visible and honest, never a silently wrong or partial number. See this file's own top-of-module
 * doc comment for why this report inherits EPH's ceiling rather than Payroll Summary's
 * unconditional computation.
 */
async function computeProjectSitePayrollReportTotals(where: Prisma.PayrollEntryWhereInput): Promise<ProjectSitePayrollReportTotals> {
  const [matchingCount, releasedCount, heldCount, noPayDueCount, recoveryDueCount, pendingCount, correctedEntryCount] =
    await Promise.all([
      prisma.payrollEntry.count({ where }),
      prisma.payrollEntry.count({ where: { AND: [where, employeePayrollHistoryRowStatusWhereClause('RELEASED')] } }),
      prisma.payrollEntry.count({ where: { AND: [where, employeePayrollHistoryRowStatusWhereClause('HELD')] } }),
      prisma.payrollEntry.count({ where: { AND: [where, employeePayrollHistoryRowStatusWhereClause('NO_PAY_DUE')] } }),
      prisma.payrollEntry.count({ where: { AND: [where, employeePayrollHistoryRowStatusWhereClause('RECOVERY_DUE')] } }),
      prisma.payrollEntry.count({ where: { AND: [where, employeePayrollHistoryRowStatusWhereClause('PENDING')] } }),
      prisma.payrollEntry.count({ where: { AND: [where, { corrections: { some: {} } }] } }),
    ]);

  const base = { matchingCount, releasedCount, heldCount, noPayDueCount, recoveryDueCount, pendingCount, correctedEntryCount };

  if (matchingCount > PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS) {
    return {
      ...base,
      grossPay: null,
      allowance: null,
      eobiDeduction: null,
      advanceDeduction: null,
      eidAdvanceDeduction: null,
      fine: null,
      correctionBalancePayable: null,
      correctionBalanceRecovery: null,
      totalEarnings: null,
      totalDeductions: null,
      netSalaryTotal: null,
      totalsComputed: false,
    };
  }

  const entries = await prisma.payrollEntry.findMany({ where, select: CALC_INPUT_SELECT });
  const rawSums = {
    grossPay: sumMoney(entries.map((e) => e.grossPay.toString())),
    allowance: sumMoney(entries.map((e) => e.allowance.toString())),
    advanceDeduction: sumMoney(entries.map((e) => e.advanceDeduction.toString())),
    eidAdvanceDeduction: sumMoney(entries.map((e) => e.eidAdvanceDeduction.toString())),
    fine: sumMoney(entries.map((e) => e.fine.toString())),
    correctionBalancePayable: sumMoney(entries.map((e) => e.correctionBalancePayable.toString())),
    correctionBalanceRecovery: sumMoney(entries.map((e) => e.correctionBalanceRecovery.toString())),
  };
  const calcs = entries.map(calcEntryRow);

  return {
    ...base,
    ...rawSums,
    eobiDeduction: sumMoney(calcs.map((calc) => calc.eobiDeduction)),
    totalEarnings: sumMoney(calcs.map((calc) => calc.totalEarning)),
    totalDeductions: sumMoney(calcs.map((calc) => calc.totalDeduction)),
    netSalaryTotal: sumMoney(calcs.map((calc) => calc.netSalary)),
    totalsComputed: true,
  };
}

// --- List --------------------------------------------------------------------------------------

/**
 * `netSalary` is not a stored column — see Employee Payroll History's own
 * `getEmployeePayrollHistoryListSortedByNetSalary`, whose exact resolution this mirrors: within
 * `PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS`, fetch every matching row's calc inputs, compute
 * `netSalary` via canonical `calcNet`, sort in memory (explicit `id`-ascending tie-break), and
 * paginate the already-sorted array; beyond that bound, reject with a clear 400 rather than ever
 * loading an unanalyzed unbounded result set or silently falling back to a different sort.
 */
async function getProjectSitePayrollReportListSortedByNetSalary(
  where: Prisma.PayrollEntryWhereInput,
  page: number,
  pageSize: number,
  sortDir: ProjectSitePayrollReportSortDirection,
): Promise<{ total: number; rows: ProjectSitePayrollReportRow[] }> {
  const total = await prisma.payrollEntry.count({ where });
  if (total > PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS) {
    throw badRequest(
      `Sorting by Net Salary requires narrowing your filters to ${PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS} or fewer matching rows (matched ${total}). Net Salary is not a stored column and cannot be sorted at the database level without duplicating the canonical calcNet formula — narrow your filters, or sort by a different column.`,
    );
  }

  const entries = await prisma.payrollEntry.findMany({ where, select: ROW_SELECT, orderBy: { id: 'asc' } });
  const withNetSalary = entries.map((entry) => ({ entry, netSalary: Number(calcEntryRow(entry).netSalary) }));
  withNetSalary.sort((a, b) => {
    const diff = sortDir === 'asc' ? a.netSalary - b.netSalary : b.netSalary - a.netSalary;
    if (diff !== 0) return diff;
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
  });

  const start = (page - 1) * pageSize;
  const pageEntries = withNetSalary.slice(start, start + pageSize).map((row) => row.entry);
  const rows = await mapEntriesToRows(pageEntries);
  return { total, rows };
}

export async function getProjectSitePayrollReportList(
  currentUser: SessionUser,
  query: ProjectSitePayrollReportListQuery,
): Promise<ProjectSitePayrollReportListResponse> {
  const { where, cycle } = await resolveProjectSitePayrollReportFilters(currentUser, query);

  let total: number;
  let rows: ProjectSitePayrollReportRow[];

  if (query.sortBy === 'netSalary') {
    const result = await getProjectSitePayrollReportListSortedByNetSalary(where, query.page, query.pageSize, query.sortDir);
    total = result.total;
    rows = result.rows;
  } else {
    const orderBy = buildOrderBy(query.sortBy, query.sortDir);
    const [count, entries] = await Promise.all([
      prisma.payrollEntry.count({ where }),
      prisma.payrollEntry.findMany({
        where,
        select: ROW_SELECT,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    total = count;
    rows = await mapEntriesToRows(entries);
  }

  const totals = await computeProjectSitePayrollReportTotals(where);

  return { cycle, page: query.page, pageSize: query.pageSize, total, rows, totals, generatedAt: new Date().toISOString() };
}

// --- Export --------------------------------------------------------------------------------------

export interface ProjectSitePayrollReportExportData {
  rows: ProjectSitePayrollReportRow[];
  totalMatching: number;
}

/**
 * Every matching row, in the same deterministic order the list endpoint would apply — up to
 * `PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS`. A preflight `COUNT` runs before any row is
 * fetched or any CSV/XLSX buffer is generated — an over-limit request is rejected outright (the
 * caller's route layer maps this to the structured `ProjectSitePayrollReportExportLimitError`),
 * never silently truncated to the first N rows. No `page`/`pageSize` accepted at all — always the
 * complete filtered dataset, never the current page.
 */
export async function buildProjectSitePayrollReportExportData(
  currentUser: SessionUser,
  query: ProjectSitePayrollReportExportQuery,
): Promise<ProjectSitePayrollReportExportData> {
  const { where } = await resolveProjectSitePayrollReportFilters(currentUser, query);
  const totalMatching = await prisma.payrollEntry.count({ where });

  if (totalMatching > PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS) {
    return { rows: [], totalMatching };
  }

  if (query.sortBy === 'netSalary') {
    const sorted = await getProjectSitePayrollReportListSortedByNetSalary(where, 1, totalMatching || 1, query.sortDir);
    return { rows: sorted.rows, totalMatching };
  }

  const orderBy = buildOrderBy(query.sortBy, query.sortDir);
  const entries = await prisma.payrollEntry.findMany({ where, select: ROW_SELECT, orderBy });
  const rows = await mapEntriesToRows(entries);
  return { rows, totalMatching };
}

/**
 * The bulk-export flat column set — deliberately excludes CNIC, every banking field, and audit
 * data (frozen decisions — Table Data section). Values are read verbatim off the same
 * `ProjectSitePayrollReportRow` objects the list endpoint returns — never resummed or reformatted
 * differently — so export values are guaranteed to exactly match the on-screen API row values
 * (Principle 6).
 */
export const PROJECT_SITE_PAYROLL_REPORT_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Project Site',
  'Primary Unit',
  'Additional Unit Count',
  'Designation',
  'Gross Pay',
  'Allowance',
  'EOBI',
  'Advance Deduction',
  'EID Advance Deduction',
  'Fine',
  'Correction Balance Payable',
  'Correction Balance Recovery',
  'Total Earnings',
  'Total Deductions',
  'Net Salary',
  'Row Status',
  'Correction Count',
  'Released Date',
] as const;

function buildExportRow(row: ProjectSitePayrollReportRow): string[] {
  return [
    row.employeeCode ?? '—',
    row.employeeName,
    row.siteName,
    row.primaryUnit?.name ?? '—',
    String(row.additionalUnitCount),
    row.designation,
    row.grossPay,
    row.allowance,
    row.eobiDeduction,
    row.advanceDeduction,
    row.eidAdvanceDeduction,
    row.fine,
    row.correctionBalancePayable,
    row.correctionBalanceRecovery,
    row.totalEarnings,
    row.totalDeductions,
    row.netSalary,
    row.rowStatus,
    String(row.correctionCount),
    row.releasedAt ? row.releasedAt.slice(0, 10) : '—',
  ];
}

export interface ProjectSitePayrollReportExportResult {
  buffer: Buffer;
  rowCount: number;
}

/**
 * CSV export — calls `buildProjectSitePayrollReportExportData` exactly once (the same
 * filter/sort/row-shaping every other entry point shares), reuses the codebase's one mandatory
 * CSV-serialization entry point (`stringifyCsvSafe`) for formula-injection neutralization. The
 * caller (`reports.routes.ts`) is responsible for checking
 * `totalMatching > PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS` *before* calling this — this
 * function assumes that preflight has already passed and simply renders whatever rows it's handed.
 */
export function exportProjectSitePayrollReportToCsv(rows: ProjectSitePayrollReportRow[]): ProjectSitePayrollReportExportResult {
  const csv = stringifyCsvSafe([PROJECT_SITE_PAYROLL_REPORT_EXPORT_HEADERS as unknown as string[], ...rows.map(buildExportRow)]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: rows.length };
}

/**
 * XLSX export — same "one shared row-shaping function, no independent calculation path" contract
 * as the CSV export above. Uses this codebase's existing export style vocabulary only (bold
 * title/header rows via ExcelJS, content-driven column widths via the shared `excelColumnWidth` —
 * no formulas, no Excel currency `numFmt`), matching Payroll Summary's/Employee Payroll History's
 * own XLSX exports.
 */
export async function exportProjectSitePayrollReportToXlsx(rows: ProjectSitePayrollReportRow[]): Promise<ProjectSitePayrollReportExportResult> {
  const exportRows = rows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Project Site Payroll Report');

  worksheet.addRow(['Project Site Payroll Report']).font = { bold: true, size: 13 };
  worksheet.addRow([]);
  worksheet.addRow(PROJECT_SITE_PAYROLL_REPORT_EXPORT_HEADERS as unknown as string[]).font = { bold: true };
  for (const row of exportRows) worksheet.addRow(row);

  PROJECT_SITE_PAYROLL_REPORT_EXPORT_HEADERS.forEach((header, index) => {
    const columnValues = exportRows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: rows.length };
}
