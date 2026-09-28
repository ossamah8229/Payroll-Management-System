import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import {
  ASSIGNMENT_MISMATCH_READINESS_EXPORT_MAX_ROWS,
  type AssignmentMismatchReadinessCycleRef,
  type AssignmentMismatchReadinessExportQuery,
  type AssignmentMismatchReadinessListQuery,
  type AssignmentMismatchReadinessListResponse,
  type AssignmentMismatchReadinessRow,
  type AssignmentMismatchReadinessSortDirection,
  type AssignmentMismatchReadinessSortField,
  type AssignmentMismatchReadinessTotals,
  type AssignmentMismatchReadinessUnitRef,
  type AssignmentMismatchReadinessWorkLineRef,
  type AssignmentMismatchShape,
} from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { stringifyCsvSafe } from '../../common/import-export';
import { excelColumnWidth } from '../../common/excel-utils';
import { assertSiteAccess, getAccessibleSiteIds } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';

/**
 * Bulk Assignment-Mismatch Readiness Audit — backend service (approved 2026-09-28 architecture
 * review). See `shared/src/schemas/assignment-mismatch-readiness.ts` for the full frozen contract
 * (comparison predicate, permission, filter set). This module performs **no write of any kind** —
 * no mutation endpoint exists here, and this file never imports or calls
 * `applyEmployeeAssignmentToDraftPayrollEntry` or any other payroll-entry mutation.
 *
 * **Why the candidate set is fetched once per cycle and filtered in memory, not via a single SQL
 * `WHERE`** (mirrors `variance-report.service.ts`'s own frozen precedent, adapted to a single-cycle
 * shape): the mismatch predicate compares two different relations —
 * `PayrollEntry(/WorkLine).siteId/.unitId` against `Employee.siteId/.unitId` — which Prisma cannot
 * express as a field-to-field `WHERE` across a relation without raw SQL. So this service fetches
 * every unreleased, `payoutOutcome`-unresolved entry for the one requested Draft cycle (already
 * scoped by site authorization and any explicit Site/Unit filter, so this is the same bounded,
 * per-cycle shape `listPayrollEntries`/every sibling report's own query already proves safe at this
 * system's design-floor scale — see `docs/architecture/database/payroll-entry.md`), evaluates the
 * predicate for each entry's own `employee` and `workLines` (already loaded on the same query, no
 * N+1), and applies every remaining filter/sort/paginate/totals step against that one materialized
 * array.
 */

// --- Filter resolution -------------------------------------------------------------------------

/** Mirrors `overtime-report.service.ts`'s own `resolveSiteIdFilter` exactly. */
function resolveSiteIdFilter(currentUser: SessionUser, siteIds?: string[]): string[] | undefined {
  if (siteIds && siteIds.length > 0) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
    return siteIds;
  }
  return getAccessibleSiteIds(currentUser);
}

/** Mirrors `overtime-report.service.ts`'s own `resolveUnitFilter` exactly. */
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

interface ResolvedFilters {
  where: Prisma.PayrollEntryWhereInput;
  cycle: AssignmentMismatchReadinessCycleRef;
  shape: AssignmentMismatchShape | undefined;
  held: boolean | undefined;
  safeShapeOnly: boolean | undefined;
}

async function resolveFilters(
  currentUser: SessionUser,
  query: Pick<AssignmentMismatchReadinessListQuery, 'cycleId' | 'siteIds' | 'unitId' | 'shape' | 'held' | 'safeShapeOnly'>,
): Promise<ResolvedFilters> {
  const cycle = await getPayrollCycle(query.cycleId);
  if (cycle.status !== 'DRAFT') {
    throw badRequest(
      'The Assignment Mismatch Readiness audit only supports a Draft payroll cycle — released and archived cycles are frozen history and are never shown here.',
    );
  }

  const siteIdFilter = resolveSiteIdFilter(currentUser, query.siteIds);
  const unitId = await resolveUnitFilter(currentUser, query.unitId, siteIdFilter);

  const where: Prisma.PayrollEntryWhereInput = {
    cycleId: query.cycleId,
    released: false,
    payoutOutcome: null,
    ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    ...(unitId && { workLines: { some: { unitId } } }),
  };

  return {
    where,
    cycle: { id: cycle.id, year: cycle.year, month: cycle.month, status: 'DRAFT' },
    shape: query.shape,
    held: query.held,
    safeShapeOnly: query.safeShapeOnly,
  };
}

// --- Row select/build ----------------------------------------------------------------------------

const ROW_SELECT = {
  id: true,
  siteId: true,
  employeeId: true,
  employeeNameSnapshot: true,
  designation: true,
  hold: true,
  site: { select: { name: true } },
  employee: {
    select: {
      employeeCode: true,
      name: true,
      siteId: true,
      unitId: true,
      site: { select: { id: true, name: true } },
      unit: { select: { id: true, name: true, code: true } },
    },
  },
  workLines: {
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      unitId: true,
      days: true,
      otHours: true,
      unit: { select: { id: true, name: true, code: true } },
    },
  },
} satisfies Prisma.PayrollEntrySelect;

type CandidateEntry = Prisma.PayrollEntryGetPayload<{ select: typeof ROW_SELECT }>;

function toUnitRef(unit: { id: string; name: string; code: string | null }): AssignmentMismatchReadinessUnitRef {
  return { id: unit.id, name: unit.name, code: unit.code };
}

/**
 * Builds one row from a candidate entry, or returns `null` when the entry does not actually
 * mismatch (the ordinary case — most Draft entries never diverge). Evaluates *every* work line
 * against the employee's current Unit, independently — the frozen regression requirement: a split
 * entry whose primary line already matches the employee's current Unit must still surface here if
 * any other line doesn't.
 */
function buildRow(entry: CandidateEntry): AssignmentMismatchReadinessRow | null {
  const siteMismatch = entry.siteId !== entry.employee.siteId;

  const workLines: AssignmentMismatchReadinessWorkLineRef[] = entry.workLines.map((line, index) => ({
    workLineId: line.id,
    unit: toUnitRef(line.unit),
    isPrimary: index === 0,
    unitMismatch: line.unitId !== entry.employee.unitId,
    hasAttendanceOrOt: line.days.greaterThan(0) || line.otHours.greaterThan(0),
  }));

  const unitMismatch = workLines.some((line) => line.unitMismatch);
  if (!siteMismatch && !unitMismatch) return null;

  const shape: AssignmentMismatchShape = workLines.length === 1 ? 'SINGLE_LINE' : 'SPLIT';
  const hasAttendanceOrOt = workLines.some((line) => line.hasAttendanceOrOt);
  // Mirrors (never imports) `applyEmployeeAssignmentToDraftPayrollEntry`'s own eligibility check
  // (`payroll-entry.service.ts`) — single work line, zero days, zero OT. Unreleased is already
  // guaranteed by this report's own candidate query (`where.released: false`), so it is not
  // re-checked here. Informational only — this report renders no control from this flag.
  const safeOneClickShape = shape === 'SINGLE_LINE' && !hasAttendanceOrOt;

  return {
    payrollEntryId: entry.id,
    employeeId: entry.employeeId,
    employeeCode: entry.employee.employeeCode,
    employeeName: entry.employeeNameSnapshot ?? entry.employee.name,
    designation: entry.designation,
    payrollSiteId: entry.siteId,
    payrollSiteName: entry.site.name,
    workLines,
    currentEmployeeSiteId: entry.employee.siteId,
    currentEmployeeSiteName: entry.employee.site.name,
    currentEmployeeUnit: toUnitRef(entry.employee.unit),
    siteMismatch,
    unitMismatch,
    shape,
    workLineCount: workLines.length,
    held: entry.hold,
    hasAttendanceOrOt,
    safeOneClickShape,
  };
}

/** The one canonical build step every list/totals/export entry point shares — fetches the
 * candidate set (already authorized/scoped), builds every mismatch row, then applies the
 * shape/held/safe-shape-only filters (computed fields, so applied in memory rather than pushed
 * into the query). Returns the complete filtered candidate set — sorting/pagination/totals are
 * separate steps over this same array, never a second independently-filtered fetch. */
async function buildCandidateRows(
  currentUser: SessionUser,
  query: Pick<AssignmentMismatchReadinessListQuery, 'cycleId' | 'siteIds' | 'unitId' | 'shape' | 'held' | 'safeShapeOnly'>,
): Promise<{ rows: AssignmentMismatchReadinessRow[]; cycle: AssignmentMismatchReadinessCycleRef }> {
  const { where, cycle, shape, held, safeShapeOnly } = await resolveFilters(currentUser, query);

  const entries = await prisma.payrollEntry.findMany({ where, select: ROW_SELECT });

  let rows: AssignmentMismatchReadinessRow[] = [];
  for (const entry of entries) {
    const row = buildRow(entry);
    if (row) rows.push(row);
  }

  if (shape) {
    rows = rows.filter((row) => row.shape === shape);
  }
  if (held !== undefined) {
    rows = rows.filter((row) => row.held === held);
  }
  if (safeShapeOnly === true) {
    rows = rows.filter((row) => row.safeOneClickShape);
  }

  return { rows, cycle };
}

// --- Sorting -------------------------------------------------------------------------------------

function compareRows(
  a: AssignmentMismatchReadinessRow,
  b: AssignmentMismatchReadinessRow,
  sortBy: AssignmentMismatchReadinessSortField,
  dir: AssignmentMismatchReadinessSortDirection,
): number {
  const mul = dir === 'asc' ? 1 : -1;
  let primary = 0;
  switch (sortBy) {
    case 'employeeCode':
      primary = (a.employeeCode ?? '').localeCompare(b.employeeCode ?? '');
      break;
    case 'employeeName':
      primary = a.employeeName.localeCompare(b.employeeName);
      break;
    case 'payrollSite':
      primary = a.payrollSiteName.localeCompare(b.payrollSiteName);
      break;
    case 'currentEmployeeSite':
      primary = a.currentEmployeeSiteName.localeCompare(b.currentEmployeeSiteName);
      break;
  }
  if (primary !== 0) return primary * mul;
  return a.payrollEntryId < b.payrollEntryId ? -1 : a.payrollEntryId > b.payrollEntryId ? 1 : 0;
}

// --- Totals ------------------------------------------------------------------------------------

/** Computed over the complete filtered/authorized candidate set, never just the current page —
 * this report carries no financial figure, so (unlike Variance Report) nothing here is gated by
 * the export row ceiling; every count is always exact. */
function computeTotals(rows: AssignmentMismatchReadinessRow[]): AssignmentMismatchReadinessTotals {
  let siteMismatchCount = 0;
  let unitOnlyMismatchCount = 0;
  let splitCount = 0;
  let heldCount = 0;
  let safeOneClickShapeCount = 0;

  for (const row of rows) {
    if (row.siteMismatch) siteMismatchCount += 1;
    else if (row.unitMismatch) unitOnlyMismatchCount += 1;
    if (row.shape === 'SPLIT') splitCount += 1;
    if (row.held) heldCount += 1;
    if (row.safeOneClickShape) safeOneClickShapeCount += 1;
  }

  return {
    matchingCount: rows.length,
    siteMismatchCount,
    unitOnlyMismatchCount,
    splitCount,
    heldCount,
    safeOneClickShapeCount,
  };
}

// --- List --------------------------------------------------------------------------------------

export async function getAssignmentMismatchReadinessList(
  currentUser: SessionUser,
  query: AssignmentMismatchReadinessListQuery,
): Promise<AssignmentMismatchReadinessListResponse> {
  const { rows, cycle } = await buildCandidateRows(currentUser, query);

  const sorted = [...rows].sort((a, b) => compareRows(a, b, query.sortBy, query.sortDir));
  const totals = computeTotals(rows);

  const start = (query.page - 1) * query.pageSize;
  const pageRows = sorted.slice(start, start + query.pageSize);

  return {
    cycle,
    page: query.page,
    pageSize: query.pageSize,
    total: rows.length,
    rows: pageRows,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

// --- Export --------------------------------------------------------------------------------------

export interface AssignmentMismatchReadinessExportData {
  rows: AssignmentMismatchReadinessRow[];
  totalMatching: number;
}

/** Every matching row, in the same deterministic order the list endpoint would apply — up to
 * `ASSIGNMENT_MISMATCH_READINESS_EXPORT_MAX_ROWS`. No `page`/`pageSize` accepted — always the
 * complete filtered dataset, mirroring every sibling report's own export contract. */
export async function buildAssignmentMismatchReadinessExportData(
  currentUser: SessionUser,
  query: AssignmentMismatchReadinessExportQuery,
): Promise<AssignmentMismatchReadinessExportData> {
  const { rows } = await buildCandidateRows(currentUser, query);

  if (rows.length > ASSIGNMENT_MISMATCH_READINESS_EXPORT_MAX_ROWS) {
    return { rows: [], totalMatching: rows.length };
  }

  const sorted = [...rows].sort((a, b) => compareRows(a, b, query.sortBy, query.sortDir));
  return { rows: sorted, totalMatching: rows.length };
}

const SHAPE_LABEL: Record<AssignmentMismatchShape, string> = {
  SINGLE_LINE: 'Single Line',
  SPLIT: 'Split',
};

/** Flat, read-only column set — no financial field of any kind (this report has none), no
 * classification/review-state field (no such state exists — this checkpoint is read-only). Values
 * are read verbatim off the same `AssignmentMismatchReadinessRow` objects the list endpoint
 * returns, never resummed or reformatted differently (Principle 6). Multi-line entries list every
 * mismatched Unit's own name in the "Payroll Unit(s)" column, semicolon-separated, so a split
 * entry's own per-line divergence survives the flattened export. */
export const ASSIGNMENT_MISMATCH_READINESS_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Designation',
  'Payroll Site',
  'Payroll Unit(s)',
  'Current Employee Site',
  'Current Employee Unit',
  'Site Mismatch',
  'Unit Mismatch',
  'Shape',
  'Work Line Count',
  'Held',
  'Has Attendance/OT',
  'Safe One-Click Shape',
] as const;

function buildExportRow(row: AssignmentMismatchReadinessRow): string[] {
  return [
    row.employeeCode ?? '—',
    row.employeeName,
    row.designation,
    row.payrollSiteName,
    row.workLines.map((line) => `${line.unit.code ?? line.unit.name}${line.unitMismatch ? ' *' : ''}`).join('; '),
    row.currentEmployeeSiteName,
    row.currentEmployeeUnit.code ?? row.currentEmployeeUnit.name,
    row.siteMismatch ? 'Yes' : 'No',
    row.unitMismatch ? 'Yes' : 'No',
    SHAPE_LABEL[row.shape],
    String(row.workLineCount),
    row.held ? 'Yes' : 'No',
    row.hasAttendanceOrOt ? 'Yes' : 'No',
    row.safeOneClickShape ? 'Yes' : 'No',
  ];
}

export interface AssignmentMismatchReadinessExportResult {
  buffer: Buffer;
  rowCount: number;
}

export function exportAssignmentMismatchReadinessToCsv(
  rows: AssignmentMismatchReadinessRow[],
): AssignmentMismatchReadinessExportResult {
  const csv = stringifyCsvSafe([
    ASSIGNMENT_MISMATCH_READINESS_EXPORT_HEADERS as unknown as string[],
    ...rows.map(buildExportRow),
  ]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: rows.length };
}

export async function exportAssignmentMismatchReadinessToXlsx(
  rows: AssignmentMismatchReadinessRow[],
): Promise<AssignmentMismatchReadinessExportResult> {
  const exportRows = rows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Assignment Mismatch Readiness');

  worksheet.addRow(['Assignment Mismatch Readiness']).font = { bold: true, size: 13 };
  worksheet.addRow([]);
  worksheet.addRow(ASSIGNMENT_MISMATCH_READINESS_EXPORT_HEADERS as unknown as string[]).font = { bold: true };
  for (const row of exportRows) worksheet.addRow(row);

  ASSIGNMENT_MISMATCH_READINESS_EXPORT_HEADERS.forEach((header, index) => {
    const columnValues = exportRows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: rows.length };
}
