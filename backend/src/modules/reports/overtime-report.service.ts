import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import {
  sumMoney,
  OVERTIME_REPORT_EXPORT_MAX_ROWS,
  type OvertimeReportExportQuery,
  type OvertimeReportListQuery,
  type OvertimeReportListResponse,
  type OvertimeReportRow,
  type OvertimeReportSortDirection,
  type OvertimeReportSortField,
  type OvertimeReportTotals,
} from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { computeVersionedCalcForWorkLines, RELEASE_SNAPSHOT_CALC_SELECT } from '../payroll-entry/payroll-entry.service';
import { badRequest, notFound } from '../../common/http-error';
import { stringifyCsvSafe } from '../../common/import-export';
import { excelColumnWidth } from '../../common/excel-utils';
import { assertSiteAccess, getAccessibleSiteIds } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { derivePayrollEntryRowStatus, payrollEntryRowStatusWhereClause } from './payroll-entry-row-status';

/**
 * Phase 7 Reports, Overtime Report Checkpoint 1A (approved Checkpoint 0 architecture review,
 * 2026-08-07; frozen decisions carried over verbatim from the authorizing instruction).
 *
 * **Report grain (frozen, intentional architectural exception):** one row = one
 * `PayrollEntryWorkLine`, not one `PayrollEntry` (unlike every sibling report in this module).
 * See `shared/src/schemas/overtime-report.ts`'s own file header for the full grain rationale.
 *
 * **Permission (frozen):** `reports:view`. Site authorization reuses `assertSiteAccess`/
 * `getAccessibleSiteIds` exactly as every other report in this module already does; historical
 * authorization is always `PayrollEntry.siteId` (denormalized onto each work line as its own
 * `siteId` column, DB-guaranteed equal to its parent's — `docs/architecture/database/
 * payroll-entry.md` §12a), never `Employee.siteId`.
 *
 * **Canonical overtime fields (frozen) — never a second formula:** OT Hours is
 * `PayrollEntryWorkLine.otHours`, read verbatim. Effective OT Rate and OT Earnings both come from
 * canonical `calcNet`, called with exactly this row's own single work line — see `calcWorkLineRow`
 * below for why that is mathematically identical to reading the same line's own breakdown out of a
 * full-entry `calcNet` call.
 */

// --- Filter resolution -------------------------------------------------------------------------

/** Mirrors `deduction-report.service.ts`'s own `resolveSiteIdFilter` exactly — explicit filter ->
 * each site independently access-checked (403 on any inaccessible site named, never silently
 * narrowed); omitted -> the caller's full accessible scope, `undefined` for unrestricted global
 * authority. */
function resolveSiteIdFilter(currentUser: SessionUser, siteIds?: string[]): string[] | undefined {
  if (siteIds && siteIds.length > 0) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
    return siteIds;
  }
  return getAccessibleSiteIds(currentUser);
}

/** Mirrors `deduction-report.service.ts`'s own `resolveUnitFilter` exactly — a named `unitId` must
 * itself be site-accessible, and (if a `siteIds` filter was also given) must belong to one of those
 * named sites, never silently ignored. */
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

interface ResolvedOvertimeReportFilters {
  /** The row-level (`PayrollEntryWorkLine`) `where` — used by the list query, `matchingCount`, and
   * the bounded totals/export fetch. */
  where: Prisma.PayrollEntryWorkLineWhereInput;
  /** The same filter set expressed as a `PayrollEntry`-level `where`, for the entry-level
   * distinct-count totals (`releasedCount`/`heldCount`/`pendingCount`/`correctedEntryCount`) — an
   * entry matches when it satisfies the entry-level conditions (cycle/site/rowStatus/hasCorrection)
   * AND has at least one work line satisfying the work-line-level conditions (unit/hasOvertime),
   * via a `workLines: { some: workLineFragment }` relation filter. Keeping this in lockstep with
   * `where` above (both built from the same resolved filter values) is what prevents the two from
   * silently drifting apart.
   */
  entryWhere: Prisma.PayrollEntryWhereInput;
  entryWorkLineFragment: Prisma.PayrollEntryWorkLineWhereInput;
  cycle: { id: string; year: number; month: number; status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' };
}

/** The one validated-filter-construction function every list/totals/export query shares. */
async function resolveOvertimeReportFilters(
  currentUser: SessionUser,
  query: Pick<OvertimeReportListQuery, 'cycleId' | 'siteIds' | 'unitId' | 'rowStatus' | 'hasCorrection' | 'hasOvertime'>,
): Promise<ResolvedOvertimeReportFilters> {
  const cycle = await getPayrollCycle(query.cycleId);
  const siteIdFilter = resolveSiteIdFilter(currentUser, query.siteIds);
  const unitId = await resolveUnitFilter(currentUser, query.unitId, siteIdFilter);

  const entryWhere: Prisma.PayrollEntryWhereInput = {
    cycleId: query.cycleId,
    ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    ...(query.rowStatus && payrollEntryRowStatusWhereClause(query.rowStatus)),
    ...(query.hasCorrection === true && { corrections: { some: {} } }),
    ...(query.hasCorrection === false && { corrections: { none: {} } }),
  };

  const entryWorkLineFragment: Prisma.PayrollEntryWorkLineWhereInput = {
    ...(unitId && { unitId }),
    ...(query.hasOvertime === true && { otHours: { gt: 0 } }),
    ...(query.hasOvertime === false && { otHours: { lte: 0 } }),
  };

  const where: Prisma.PayrollEntryWorkLineWhereInput = {
    ...entryWorkLineFragment,
    payrollEntry: entryWhere,
  };

  return { where, entryWhere, entryWorkLineFragment, cycle: { id: cycle.id, year: cycle.year, month: cycle.month, status: cycle.status } };
}

// --- Row select/calc --------------------------------------------------------------------------

/** Every column `calcNet` needs to compute this row's own `effectiveOtRate`/`otEarned` correctly,
 * plus the identity/display columns this report's own row needs. Deliberately does NOT select
 * sibling work lines of the same entry — see `calcWorkLineRow`'s own doc comment for why a
 * single-line `calcNet` call is already the exact canonical per-line figure. */
const ROW_SELECT = {
  id: true,
  sortOrder: true,
  days: true,
  otHours: true,
  otRate: true,
  cycleDays: true,
  unit: { select: { id: true, name: true, code: true } },
  payrollEntry: {
    select: {
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
      correctionBalanceRecovery: true,
      correctionBalancePayable: true,
      hold: true,
      released: true,
      payoutOutcome: true,
      releaseSnapshot: RELEASE_SNAPSHOT_CALC_SELECT,
      site: { select: { name: true } },
      employee: { select: { employeeCode: true, name: true } },
    },
  },
} satisfies Prisma.PayrollEntryWorkLineSelect;

type RowWorkLine = Prisma.PayrollEntryWorkLineGetPayload<{ select: typeof ROW_SELECT }>;

/**
 * The adapter from this module's own narrowly-`select`ed row to shared `calcNet`'s string-based
 * input contract — deliberately calls `calcNet` with a `workLines` array containing only this row's
 * own single work line, not the parent entry's complete set.
 *
 * This is provably the same canonical figure, not an approximation: inside `calcNet`
 * (`shared/src/lib/calc-net.ts`), each work line's `dailyRate`/`effectiveOtRate`/`otEarned` is
 * computed purely from that line's own `otHours`/`otRate`/`cycleDays` and the entry's own
 * `grossPay` — the per-line loop body never reads any other line. Calling `calcNet` with `[thisLine]`
 * therefore yields the identical `workLines[0].effectiveOtRate`/`.otEarned` a full-entry call would
 * have produced for this same line, without this report ever needing to fetch/select the entry's
 * other work lines (which it never displays). Every other `calcNet` input this report doesn't
 * display (`allowance`, `leaveDays`, `eobiAmount`, etc.) is still passed as this entry's own real,
 * selected value — never a placeholder — so the call remains a genuine, complete invocation of the
 * canonical formula, not a partial/synthetic one.
 */
function calcWorkLineRow(line: RowWorkLine) {
  return computeVersionedCalcForWorkLines(line.payrollEntry, [
    {
      sortOrder: line.sortOrder,
      days: line.days.toString(),
      otHours: line.otHours.toString(),
      otRate: line.otRate?.toString() ?? null,
      cycleDays: line.cycleDays,
    },
  ]);
}

// --- Batched correction lookup (never per-row) --------------------------------------------------

/** Same batched-lookup shape as every sibling report's own correction-count function, but resolved
 * to a boolean-presence `Set` — this report's row exposes "Has Correction" (approved decision), not
 * a count. */
async function fetchEntryIdsWithCorrections(entryIds: string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const grouped = await prisma.correction.groupBy({
    by: ['payrollEntryId'],
    where: { payrollEntryId: { in: entryIds } },
    _count: { _all: true },
  });
  return new Set(grouped.map((row) => row.payrollEntryId));
}

function mapWorkLinesToRows(lines: RowWorkLine[], entryIdsWithCorrections: Set<string>): OvertimeReportRow[] {
  return lines.map((line) => {
    const calc = calcWorkLineRow(line);
    const entry = line.payrollEntry;

    return {
      workLineId: line.id,
      payrollEntryId: entry.id,
      employeeId: entry.employeeId,
      employeeCode: entry.employee.employeeCode,
      employeeName: entry.employeeNameSnapshot ?? entry.employee.name,
      siteId: entry.siteId,
      siteName: entry.site.name,
      unit: { id: line.unit.id, name: line.unit.name, code: line.unit.code },
      designation: entry.designation,
      otHours: line.otHours.toFixed(2),
      effectiveOtRate: calc.workLines[0]!.effectiveOtRate,
      otEarned: calc.workLines[0]!.otEarned,
      grossPay: entry.grossPay.toFixed(2),
      rowStatus: derivePayrollEntryRowStatus(entry),
      hasCorrection: entryIdsWithCorrections.has(entry.id),
    };
  });
}

async function mapWorkLinesToRowsBatched(lines: RowWorkLine[]): Promise<OvertimeReportRow[]> {
  const entryIds = [...new Set(lines.map((line) => line.payrollEntry.id))];
  const entryIdsWithCorrections = await fetchEntryIdsWithCorrections(entryIds);
  return mapWorkLinesToRows(lines, entryIdsWithCorrections);
}

// --- Deterministic ordering ---------------------------------------------------------------------

/** Every branch ends with `{ id: 'asc' }` — the mandatory final tie-break. No bounded in-memory
 * sort exception for `effectiveOtRate`/`otEarned` (frozen decision — Sorting section): both are
 * excluded from `OVERTIME_REPORT_SORT_FIELDS` entirely, so this function is never asked to sort by
 * either. */
function buildOrderBy(sortBy: OvertimeReportSortField, dir: OvertimeReportSortDirection): Prisma.PayrollEntryWorkLineOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'employeeCode':
      return [{ payrollEntry: { employee: { employeeCode: dir } } }, { id: 'asc' }];
    case 'employeeName':
      return [{ payrollEntry: { employee: { name: dir } } }, { id: 'asc' }];
    case 'site':
      return [{ payrollEntry: { site: { name: dir } } }, { payrollEntry: { employee: { name: 'asc' } } }, { id: 'asc' }];
    case 'unit':
      return [{ unit: { name: dir } }, { id: 'asc' }];
    case 'otHours':
      return [{ otHours: dir }, { id: 'asc' }];
    case 'rowStatus':
      return [{ payrollEntry: { released: dir } }, { payrollEntry: { hold: dir } }, { payrollEntry: { payoutOutcome: dir } }, { id: 'asc' }];
  }
}

// --- Totals ------------------------------------------------------------------------------------

const CALC_INPUT_SELECT = {
  otHours: true,
  otRate: true,
  cycleDays: true,
  days: true,
  sortOrder: true,
  siteId: true,
  unitId: true,
  payrollEntry: {
    select: {
      id: true,
      employeeId: true,
      grossPay: true,
      allowance: true,
      leaveDays: true,
      leaveRate: true,
      eobiAmount: true,
      eobiApplicable: true,
      advanceDeduction: true,
      eidAdvanceDeduction: true,
      fine: true,
      correctionBalanceRecovery: true,
      correctionBalancePayable: true,
      released: true,
      payoutOutcome: true,
      releaseSnapshot: RELEASE_SNAPSHOT_CALC_SELECT,
    },
  },
} satisfies Prisma.PayrollEntryWorkLineSelect;

type CalcInputWorkLine = Prisma.PayrollEntryWorkLineGetPayload<{ select: typeof CALC_INPUT_SELECT }>;

function calcInputRow(line: CalcInputWorkLine) {
  return computeVersionedCalcForWorkLines(line.payrollEntry, [
    { sortOrder: line.sortOrder, days: line.days.toString(), otHours: line.otHours.toString(), otRate: line.otRate?.toString() ?? null, cycleDays: line.cycleDays },
  ]);
}

/**
 * The approved totals strategy (frozen decision — Totals section): `matchingCount` and the four
 * entry-level distinct counts (`releasedCount`/`heldCount`/`pendingCount`/`correctedEntryCount`)
 * are plain, always-exact DB aggregates against `PayrollEntry` (via `workLines: { some:
 * entryWorkLineFragment }`, so an entry with 2 matching work lines is counted once, never twice).
 * Every other total is computed via one bounded fetch of every matching work line's calc inputs,
 * only when `matchingCount` is within `OVERTIME_REPORT_EXPORT_MAX_ROWS` — beyond it, `null` with
 * `totalsComputed: false`.
 */
async function computeOvertimeReportTotals(filters: ResolvedOvertimeReportFilters): Promise<OvertimeReportTotals> {
  const { where, entryWhere, entryWorkLineFragment } = filters;

  const entryLevelWhere = (statusClause: Prisma.PayrollEntryWhereInput = {}): Prisma.PayrollEntryWhereInput => ({
    AND: [entryWhere, statusClause, { workLines: { some: entryWorkLineFragment } }],
  });

  const [matchingCount, releasedCount, heldCount, pendingCount, correctedEntryCount] = await Promise.all([
    prisma.payrollEntryWorkLine.count({ where }),
    prisma.payrollEntry.count({ where: entryLevelWhere(payrollEntryRowStatusWhereClause('RELEASED')) }),
    prisma.payrollEntry.count({ where: entryLevelWhere(payrollEntryRowStatusWhereClause('HELD')) }),
    prisma.payrollEntry.count({ where: entryLevelWhere(payrollEntryRowStatusWhereClause('PENDING')) }),
    prisma.payrollEntry.count({ where: entryLevelWhere({ corrections: { some: {} } }) }),
  ]);

  const base = { matchingCount, releasedCount, heldCount, pendingCount, correctedEntryCount };

  if (matchingCount > OVERTIME_REPORT_EXPORT_MAX_ROWS) {
    return {
      ...base,
      employeesWithOvertimeCount: null,
      totalOtHours: null,
      totalOtEarnings: null,
      sitesWithOvertimeCount: null,
      unitsWithOvertimeCount: null,
      totalsComputed: false,
    };
  }

  const lines = await prisma.payrollEntryWorkLine.findMany({ where, select: CALC_INPUT_SELECT });
  const calcs = lines.map(calcInputRow);

  const otHoursLines = lines.filter((line) => line.otHours.greaterThan(0));
  const employeesWithOvertimeCount = new Set(otHoursLines.map((line) => line.payrollEntry.employeeId)).size;
  const sitesWithOvertimeCount = new Set(otHoursLines.map((line) => line.siteId)).size;
  const unitsWithOvertimeCount = new Set(otHoursLines.map((line) => line.unitId)).size;

  return {
    ...base,
    employeesWithOvertimeCount,
    totalOtHours: sumMoney(lines.map((line) => line.otHours.toString())),
    totalOtEarnings: sumMoney(calcs.map((calc) => calc.workLines[0]!.otEarned)),
    sitesWithOvertimeCount,
    unitsWithOvertimeCount,
    totalsComputed: true,
  };
}

// --- List --------------------------------------------------------------------------------------

export async function getOvertimeReportList(currentUser: SessionUser, query: OvertimeReportListQuery): Promise<OvertimeReportListResponse> {
  const filters = await resolveOvertimeReportFilters(currentUser, query);
  const { where, cycle } = filters;

  const orderBy = buildOrderBy(query.sortBy, query.sortDir);
  const [total, lines] = await Promise.all([
    prisma.payrollEntryWorkLine.count({ where }),
    prisma.payrollEntryWorkLine.findMany({
      where,
      select: ROW_SELECT,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const rows = await mapWorkLinesToRowsBatched(lines);
  const totals = await computeOvertimeReportTotals(filters);

  return { cycle, page: query.page, pageSize: query.pageSize, total, rows, totals, generatedAt: new Date().toISOString() };
}

// --- Export --------------------------------------------------------------------------------------

export interface OvertimeReportExportData {
  rows: OvertimeReportRow[];
  totalMatching: number;
}

/**
 * Every matching work line, in the same deterministic order the list endpoint would apply — up to
 * `OVERTIME_REPORT_EXPORT_MAX_ROWS`. A preflight `COUNT` runs before any row is fetched or any
 * CSV/XLSX buffer is generated — an over-limit request is rejected outright (the caller's route
 * layer maps this to the structured `OvertimeReportExportLimitError`), never silently truncated.
 * No `page`/`pageSize` accepted at all — always the complete filtered dataset.
 */
export async function buildOvertimeReportExportData(currentUser: SessionUser, query: OvertimeReportExportQuery): Promise<OvertimeReportExportData> {
  const { where } = await resolveOvertimeReportFilters(currentUser, query);
  const totalMatching = await prisma.payrollEntryWorkLine.count({ where });

  if (totalMatching > OVERTIME_REPORT_EXPORT_MAX_ROWS) {
    return { rows: [], totalMatching };
  }

  const orderBy = buildOrderBy(query.sortBy, query.sortDir);
  const lines = await prisma.payrollEntryWorkLine.findMany({ where, select: ROW_SELECT, orderBy });
  const rows = await mapWorkLinesToRowsBatched(lines);
  return { rows, totalMatching };
}

/**
 * The bulk-export flat column set — matches the approved row vocabulary exactly (frozen decision —
 * Columns section). Deliberately excludes CNIC, every banking field, Net Salary, Total Earnings,
 * correction reasons, release-actor identity, audit-actor identity. Values are read verbatim off
 * the same `OvertimeReportRow` objects the list endpoint returns — never resummed or reformatted
 * differently — so export values are guaranteed to exactly match the on-screen API row values.
 */
export const OVERTIME_REPORT_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Project Site',
  'Unit',
  'Designation',
  'OT Hours',
  'Effective OT Rate',
  'OT Earnings',
  'Gross Pay',
  'Row Status',
  'Has Correction',
] as const;

function buildExportRow(row: OvertimeReportRow): string[] {
  return [
    row.employeeCode ?? '—',
    row.employeeName,
    row.siteName,
    row.unit.name,
    row.designation,
    row.otHours,
    row.effectiveOtRate,
    row.otEarned,
    row.grossPay,
    row.rowStatus,
    row.hasCorrection ? 'Yes' : 'No',
  ];
}

export interface OvertimeReportExportResult {
  buffer: Buffer;
  rowCount: number;
}

/** CSV export — calls `buildOvertimeReportExportData` exactly once (the same filter/sort/row-
 * shaping every other entry point shares), reuses the codebase's one mandatory CSV-serialization
 * entry point (`stringifyCsvSafe`). The caller (`reports.routes.ts`) is responsible for checking
 * `totalMatching > OVERTIME_REPORT_EXPORT_MAX_ROWS` *before* calling this. */
export function exportOvertimeReportToCsv(rows: OvertimeReportRow[]): OvertimeReportExportResult {
  const csv = stringifyCsvSafe([OVERTIME_REPORT_EXPORT_HEADERS as unknown as string[], ...rows.map(buildExportRow)]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: rows.length };
}

/** XLSX export — same "one shared row-shaping function, no independent calculation path" contract
 * as the CSV export above. Uses this codebase's existing export style vocabulary only (bold
 * title/header rows via ExcelJS, content-driven column widths via the shared `excelColumnWidth`). */
export async function exportOvertimeReportToXlsx(rows: OvertimeReportRow[]): Promise<OvertimeReportExportResult> {
  const exportRows = rows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Overtime Report');

  worksheet.addRow(['Overtime Report']).font = { bold: true, size: 13 };
  worksheet.addRow([]);
  worksheet.addRow(OVERTIME_REPORT_EXPORT_HEADERS as unknown as string[]).font = { bold: true };
  for (const row of exportRows) worksheet.addRow(row);

  OVERTIME_REPORT_EXPORT_HEADERS.forEach((header, index) => {
    const columnValues = exportRows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: rows.length };
}
