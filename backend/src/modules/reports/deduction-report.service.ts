import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import {
  calcNet,
  sumMoney,
  type CalcNetResult,
  DEDUCTION_REPORT_EXPORT_MAX_ROWS,
  type DeductionReportExportQuery,
  type DeductionReportListQuery,
  type DeductionReportListResponse,
  type DeductionReportRow,
  type DeductionReportSortDirection,
  type DeductionReportSortField,
  type DeductionReportTotals,
  type DeductionReportUnitRef,
} from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { stringifyCsvSafe } from '../../common/import-export';
import { excelColumnWidth } from '../../common/excel-utils';
import { assertSiteAccess, getAccessibleSiteIds } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { derivePayrollEntryRowStatus, payrollEntryRowStatusWhereClause } from './payroll-entry-row-status';

/**
 * Phase 7 Reports, Deduction Report Checkpoint 1A (approved Checkpoint 0 architecture review,
 * 2026-08-07; frozen decisions carried over verbatim from the authorizing instruction).
 *
 * **Report scope (frozen):** "Which employees had which deduction(s) applied this cycle, how much,
 * and what does each type total to company-wide?" One row = one `PayrollEntry`. Not a cross-cycle
 * report — `cycleId` is required and singular, mirroring Payroll Summary's/Project Site Payroll
 * Report's own "one cycle at a time" shape.
 *
 * **Permission (frozen):** `reports:view`, not `statements:view` — the same operational,
 * one-cycle, site-scoped disclosure class as Payroll Summary/Project Site Payroll Report. Site
 * authorization reuses `assertSiteAccess`/`getAccessibleSiteIds` exactly as every other report in
 * this module already does; historical authorization is always `PayrollEntry.siteId`, never
 * `Employee.siteId`.
 *
 * **Deduction types (frozen) — exactly five:** effective EOBI (`eobiApplicable ? eobiAmount : 0`,
 * via canonical `calcNet`, never a raw sum/filter of `eobiAmount` alone), Advance Deduction, EID
 * Advance Deduction, Fine, Correction Balance Recovery (this cycle's own already-materialized
 * settlement — never the live, cross-cycle `BalanceAdjustment.remainingAmount`). Correction Balance
 * Payable (an earning) is deliberately excluded — this report never selects or returns it.
 *
 * **Unit (frozen):** filtering and "Primary Unit (+N more)" display only — never a per-Unit
 * financial total/allocation, the same schema-forced limitation Project Site Payroll Report's own
 * frozen decision already established (an entry's aggregate deductions live on `PayrollEntry`, not
 * `PayrollEntryWorkLine`).
 *
 * **No detail page/endpoint in V1.** No drill-down beyond what the list row itself already returns.
 *
 * **Row status** is derived via the now-neutral `payroll-entry-row-status.ts` (this report is its
 * third consumer, after Employee Payroll History and Project Site Payroll Report — the extraction
 * this checkpoint performed first, per this project's own "extract generic code at the third
 * consumer" convention).
 */

// --- Filter resolution -------------------------------------------------------------------------

/** Mirrors `project-site-payroll.service.ts`'s own `resolveSiteIdFilter` exactly — explicit filter
 * -> each site independently access-checked (403 on any inaccessible site named, never silently
 * narrowed); omitted -> the caller's full accessible scope, `undefined` for unrestricted global
 * authority. */
function resolveSiteIdFilter(currentUser: SessionUser, siteIds?: string[]): string[] | undefined {
  if (siteIds && siteIds.length > 0) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
    return siteIds;
  }
  return getAccessibleSiteIds(currentUser);
}

/** Mirrors `project-site-payroll.service.ts`'s own `resolveUnitFilter` exactly — a named `unitId`
 * must itself be site-accessible, and (if a `siteIds` filter was also given) must belong to one of
 * those named sites, never silently ignored. */
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

/**
 * The one canonical deduction-presence predicate builder, shared by list/totals/export (Step 4:
 * "one canonical backend filter builder shared by list, totals, and export"). Each of the five
 * tri-states, when provided (`All` sends no predicate), is pushed as its own `Prisma.
 * PayrollEntryWhereInput` fragment; the caller combines all fragments with `AND` (Prisma's own
 * top-level `AND: [...]` array), so multiple provided deduction filters compose with AND semantics
 * (frozen decision — Deduction Filter Model section).
 *
 * `hasEobi` alone needs a two-column, applicability-aware predicate (`eobiApplicable` AND
 * `eobiAmount`) rather than a single `gt`/`lte` comparison — this is a plain boolean/comparison
 * filter over already-authoritative stored columns, not an independent computation of the
 * deduction's monetary *value*, so it does not duplicate `calcNet`'s own effective-EOBI formula
 * (which this module never reimplements for any total/row figure — see `calcEntryRow` below).
 */
function buildDeductionPredicates(
  query: Pick<DeductionReportListQuery, 'hasEobi' | 'hasAdvanceDeduction' | 'hasEidAdvanceDeduction' | 'hasFine' | 'hasCorrectionRecovery'>,
): Prisma.PayrollEntryWhereInput[] {
  const predicates: Prisma.PayrollEntryWhereInput[] = [];

  if (query.hasEobi !== undefined) {
    predicates.push(
      query.hasEobi
        ? { eobiApplicable: true, eobiAmount: { gt: 0 } }
        : { OR: [{ eobiApplicable: false }, { eobiAmount: { lte: 0 } }] },
    );
  }
  if (query.hasAdvanceDeduction !== undefined) {
    predicates.push({ advanceDeduction: query.hasAdvanceDeduction ? { gt: 0 } : { lte: 0 } });
  }
  if (query.hasEidAdvanceDeduction !== undefined) {
    predicates.push({ eidAdvanceDeduction: query.hasEidAdvanceDeduction ? { gt: 0 } : { lte: 0 } });
  }
  if (query.hasFine !== undefined) {
    predicates.push({ fine: query.hasFine ? { gt: 0 } : { lte: 0 } });
  }
  if (query.hasCorrectionRecovery !== undefined) {
    predicates.push({ correctionBalanceRecovery: query.hasCorrectionRecovery ? { gt: 0 } : { lte: 0 } });
  }

  return predicates;
}

interface ResolvedDeductionReportFilters {
  where: Prisma.PayrollEntryWhereInput;
  cycle: { id: string; year: number; month: number; status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' };
}

/** The one validated-filter-construction function every list/totals/export query shares (Step 4).
 * Mirrors Project Site Payroll Report's own `resolveProjectSitePayrollReportFilters` shape,
 * extended with the five deduction-presence predicates above. */
async function resolveDeductionReportFilters(
  currentUser: SessionUser,
  query: Pick<
    DeductionReportListQuery,
    'cycleId' | 'siteIds' | 'unitId' | 'rowStatus' | 'hasCorrection' | 'hasEobi' | 'hasAdvanceDeduction' | 'hasEidAdvanceDeduction' | 'hasFine' | 'hasCorrectionRecovery'
  >,
): Promise<ResolvedDeductionReportFilters> {
  const cycle = await getPayrollCycle(query.cycleId);
  const siteIdFilter = resolveSiteIdFilter(currentUser, query.siteIds);
  const unitId = await resolveUnitFilter(currentUser, query.unitId, siteIdFilter);
  const deductionPredicates = buildDeductionPredicates(query);

  const where: Prisma.PayrollEntryWhereInput = {
    cycleId: query.cycleId,
    ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    ...(unitId && { workLines: { some: { unitId } } }),
    ...(query.rowStatus && payrollEntryRowStatusWhereClause(query.rowStatus)),
    ...(query.hasCorrection === true && { corrections: { some: {} } }),
    ...(query.hasCorrection === false && { corrections: { none: {} } }),
    ...(deductionPredicates.length > 0 && { AND: deductionPredicates }),
  };

  return { where, cycle: { id: cycle.id, year: cycle.year, month: cycle.month, status: cycle.status } };
}

// --- Row select/calc --------------------------------------------------------------------------

/** Every column `calcNet` needs to compute `eobiDeduction`/`totalDeduction` correctly, plus the
 * identity/display columns this report's own row needs. Deliberately still selects `grossPay`/
 * `allowance`/`leaveDays`/`leaveRate` even though this report never *displays* them — `calcNet`'s
 * own input contract requires a complete, valid `PayrollEntryCalcInput` (it computes the whole
 * formula, including earning-side figures this report discards) since this module never calls a
 * partial/independent reimplementation of it. `correctionBalancePayable` is deliberately NOT
 * selected — it only feeds `calcNet`'s `totalEarning`, which this report never reads, and is
 * explicitly out of scope (frozen decision — Deduction Types section). */
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
  correctionBalanceRecovery: true,
  hold: true,
  released: true,
  payoutOutcome: true,
  releasedAt: true,
  site: { select: { name: true } },
  employee: { select: { employeeCode: true, name: true } },
  workLines: {
    // Same deterministic `id` tie-break every other row-level report's own `ROW_SELECT` uses — a
    // work line's `sortOrder` alone is not guaranteed unique (defaults to 0).
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
 * input contract — identical in shape/intent to every sibling report's own `calcEntryRow`, calling
 * the exact same canonical `calcNet` (never a second net-salary/deduction formula).
 * `correctionBalancePayable` is omitted (defaults to `0` inside `calcNet`, affecting only
 * `totalEarning`, which this report never reads). */
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

/** Whether *any* of this entry's five deduction types is effectively present — a plain structural
 * boolean check over the same authoritative stored columns `calcEntryRow`/`buildDeductionPredicates`
 * already read, not an independent computation of any deduction's monetary value. Mirrors
 * `buildDeductionPredicates`'s own `hasEobi` semantics (`eobiApplicable && eobiAmount > 0`) rather
 * than a raw `eobiAmount > 0` check. */
function hasAnyEffectiveDeduction(entry: {
  eobiApplicable: boolean;
  eobiAmount: Prisma.Decimal;
  advanceDeduction: Prisma.Decimal;
  eidAdvanceDeduction: Prisma.Decimal;
  fine: Prisma.Decimal;
  correctionBalanceRecovery: Prisma.Decimal;
}): boolean {
  const effectiveEobi = entry.eobiApplicable && entry.eobiAmount.greaterThan(0);
  return (
    effectiveEobi ||
    entry.advanceDeduction.greaterThan(0) ||
    entry.eidAdvanceDeduction.greaterThan(0) ||
    entry.fine.greaterThan(0) ||
    entry.correctionBalanceRecovery.greaterThan(0)
  );
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

function toUnitRef(unit: { id: string; name: string; code: string | null }): DeductionReportUnitRef {
  return { id: unit.id, name: unit.name, code: unit.code };
}

async function mapEntriesToRows(entries: RowEntry[]): Promise<DeductionReportRow[]> {
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
      eobi: calc.eobiDeduction,
      advanceDeduction: entry.advanceDeduction.toFixed(2),
      eidAdvanceDeduction: entry.eidAdvanceDeduction.toFixed(2),
      fine: entry.fine.toFixed(2),
      correctionBalanceRecovery: entry.correctionBalanceRecovery.toFixed(2),
      totalDeductions: calc.totalDeduction,
      rowStatus: derivePayrollEntryRowStatus(entry),
      correctionCount: correctionCounts.get(entry.id) ?? 0,
      releasedAt: entry.releasedAt?.toISOString() ?? null,
    };
  });
}

// --- Deterministic ordering ---------------------------------------------------------------------

/**
 * Every branch ends with `{ id: 'asc' }` — the mandatory final tie-break. No bounded in-memory sort
 * exception anywhere (frozen decision — Sorting section): every one of this report's eight approved
 * sort fields is either a plain stored `PayrollEntry` column or the same disclosed
 * `released`/`hold`/`payoutOutcome`-ordering approximation every sibling report's `rowStatus` sort
 * already uses — unlike `netSalary` elsewhere in this module, none of these need `calcNet` to sort.
 */
function buildOrderBy(
  sortBy: DeductionReportSortField,
  dir: DeductionReportSortDirection,
): Prisma.PayrollEntryOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'employeeCode':
      return [{ employee: { employeeCode: dir } }, { id: 'asc' }];
    case 'employeeName':
      return [{ employee: { name: dir } }, { id: 'asc' }];
    case 'site':
      return [{ site: { name: dir } }, { employee: { name: 'asc' } }, { id: 'asc' }];
    case 'advanceDeduction':
      return [{ advanceDeduction: dir }, { id: 'asc' }];
    case 'eidAdvanceDeduction':
      return [{ eidAdvanceDeduction: dir }, { id: 'asc' }];
    case 'fine':
      return [{ fine: dir }, { id: 'asc' }];
    case 'correctionBalanceRecovery':
      return [{ correctionBalanceRecovery: dir }, { id: 'asc' }];
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
  correctionBalanceRecovery: true,
  workLines: { select: { sortOrder: true, days: true, otHours: true, otRate: true, cycleDays: true } },
} satisfies Prisma.PayrollEntrySelect;

/**
 * The approved unified bounded computation strategy (Step 8): the five status-breakdown counts and
 * `correctedEntryCount` are plain, always-exact DB aggregates, combined with the caller's own
 * filter via `AND` (never a shallow spread-merge that could silently overwrite an existing
 * `rowStatus` filter — the same pitfall Employee Payroll History's/Project Site Payroll Report's
 * own totals functions already document). Every monetary total and `employeesWithAnyDeduction` are
 * computed the *same* bounded way, via one fetch of every matching row's calc inputs followed by
 * canonical `calcNet`/`sumMoney` — deliberately the same single computation pass for every field,
 * including the plain-stored-column ones (`advanceDeductionTotal` etc.), never a second,
 * independently-implemented SQL-aggregate path for those — only when `matchingCount` is within
 * `DEDUCTION_REPORT_EXPORT_MAX_ROWS`; beyond it, `null`/`null` with `totalsComputed: false`.
 */
async function computeDeductionReportTotals(where: Prisma.PayrollEntryWhereInput): Promise<DeductionReportTotals> {
  const [matchingCount, releasedCount, heldCount, noPayDueCount, recoveryDueCount, pendingCount, correctedEntryCount] =
    await Promise.all([
      prisma.payrollEntry.count({ where }),
      prisma.payrollEntry.count({ where: { AND: [where, payrollEntryRowStatusWhereClause('RELEASED')] } }),
      prisma.payrollEntry.count({ where: { AND: [where, payrollEntryRowStatusWhereClause('HELD')] } }),
      prisma.payrollEntry.count({ where: { AND: [where, payrollEntryRowStatusWhereClause('NO_PAY_DUE')] } }),
      prisma.payrollEntry.count({ where: { AND: [where, payrollEntryRowStatusWhereClause('RECOVERY_DUE')] } }),
      prisma.payrollEntry.count({ where: { AND: [where, payrollEntryRowStatusWhereClause('PENDING')] } }),
      prisma.payrollEntry.count({ where: { AND: [where, { corrections: { some: {} } }] } }),
    ]);

  const base = { matchingCount, releasedCount, heldCount, noPayDueCount, recoveryDueCount, pendingCount, correctedEntryCount };

  if (matchingCount > DEDUCTION_REPORT_EXPORT_MAX_ROWS) {
    return {
      ...base,
      employeesWithAnyDeduction: null,
      eobiTotal: null,
      advanceDeductionTotal: null,
      eidAdvanceDeductionTotal: null,
      fineTotal: null,
      correctionRecoveryTotal: null,
      totalDeductions: null,
      totalsComputed: false,
    };
  }

  const entries = await prisma.payrollEntry.findMany({ where, select: CALC_INPUT_SELECT });
  const calcs = entries.map(calcEntryRow);
  const employeesWithAnyDeduction = entries.filter(hasAnyEffectiveDeduction).length;

  return {
    ...base,
    employeesWithAnyDeduction,
    eobiTotal: sumMoney(calcs.map((calc) => calc.eobiDeduction)),
    advanceDeductionTotal: sumMoney(entries.map((e) => e.advanceDeduction.toString())),
    eidAdvanceDeductionTotal: sumMoney(entries.map((e) => e.eidAdvanceDeduction.toString())),
    fineTotal: sumMoney(entries.map((e) => e.fine.toString())),
    correctionRecoveryTotal: sumMoney(entries.map((e) => e.correctionBalanceRecovery.toString())),
    totalDeductions: sumMoney(calcs.map((calc) => calc.totalDeduction)),
    totalsComputed: true,
  };
}

// --- List --------------------------------------------------------------------------------------

export async function getDeductionReportList(
  currentUser: SessionUser,
  query: DeductionReportListQuery,
): Promise<DeductionReportListResponse> {
  const { where, cycle } = await resolveDeductionReportFilters(currentUser, query);

  const orderBy = buildOrderBy(query.sortBy, query.sortDir);
  const [total, entries] = await Promise.all([
    prisma.payrollEntry.count({ where }),
    prisma.payrollEntry.findMany({
      where,
      select: ROW_SELECT,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const rows = await mapEntriesToRows(entries);
  const totals = await computeDeductionReportTotals(where);

  return { cycle, page: query.page, pageSize: query.pageSize, total, rows, totals, generatedAt: new Date().toISOString() };
}

// --- Export --------------------------------------------------------------------------------------

export interface DeductionReportExportData {
  rows: DeductionReportRow[];
  totalMatching: number;
}

/**
 * Every matching row, in the same deterministic order the list endpoint would apply — up to
 * `DEDUCTION_REPORT_EXPORT_MAX_ROWS`. A preflight `COUNT` runs before any row is fetched or any
 * CSV/XLSX buffer is generated — an over-limit request is rejected outright (the caller's route
 * layer maps this to the structured `DeductionReportExportLimitError`), never silently truncated.
 * No `page`/`pageSize` accepted at all — always the complete filtered dataset.
 */
export async function buildDeductionReportExportData(
  currentUser: SessionUser,
  query: DeductionReportExportQuery,
): Promise<DeductionReportExportData> {
  const { where } = await resolveDeductionReportFilters(currentUser, query);
  const totalMatching = await prisma.payrollEntry.count({ where });

  if (totalMatching > DEDUCTION_REPORT_EXPORT_MAX_ROWS) {
    return { rows: [], totalMatching };
  }

  const orderBy = buildOrderBy(query.sortBy, query.sortDir);
  const entries = await prisma.payrollEntry.findMany({ where, select: ROW_SELECT, orderBy });
  const rows = await mapEntriesToRows(entries);
  return { rows, totalMatching };
}

/**
 * The bulk-export flat column set — matches the approved row vocabulary exactly (frozen decision —
 * Export section). Deliberately excludes CNIC, every banking field, Gross Pay, Net Salary,
 * Correction Balance Payable, correction reasons, release-actor identity, audit-actor identity, and
 * any live `BalanceAdjustment.remainingAmount`. Values are read verbatim off the same
 * `DeductionReportRow` objects the list endpoint returns — never resummed or reformatted
 * differently — so export values are guaranteed to exactly match the on-screen API row values
 * (Principle 6).
 */
export const DEDUCTION_REPORT_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Project Site',
  'Primary Unit',
  'Additional Unit Count',
  'Designation',
  'EOBI',
  'Advance Deduction',
  'EID Advance Deduction',
  'Fine',
  'Correction Balance Recovery',
  'Total Deductions',
  'Row Status',
  'Correction Count',
  'Released Date',
] as const;

function buildExportRow(row: DeductionReportRow): string[] {
  return [
    row.employeeCode ?? '—',
    row.employeeName,
    row.siteName,
    row.primaryUnit?.name ?? '—',
    String(row.additionalUnitCount),
    row.designation,
    row.eobi,
    row.advanceDeduction,
    row.eidAdvanceDeduction,
    row.fine,
    row.correctionBalanceRecovery,
    row.totalDeductions,
    row.rowStatus,
    String(row.correctionCount),
    row.releasedAt ? row.releasedAt.slice(0, 10) : '—',
  ];
}

export interface DeductionReportExportResult {
  buffer: Buffer;
  rowCount: number;
}

/**
 * CSV export — calls `buildDeductionReportExportData` exactly once (the same filter/sort/row-
 * shaping every other entry point shares), reuses the codebase's one mandatory CSV-serialization
 * entry point (`stringifyCsvSafe`). The caller (`reports.routes.ts`) is responsible for checking
 * `totalMatching > DEDUCTION_REPORT_EXPORT_MAX_ROWS` *before* calling this.
 */
export function exportDeductionReportToCsv(rows: DeductionReportRow[]): DeductionReportExportResult {
  const csv = stringifyCsvSafe([DEDUCTION_REPORT_EXPORT_HEADERS as unknown as string[], ...rows.map(buildExportRow)]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: rows.length };
}

/**
 * XLSX export — same "one shared row-shaping function, no independent calculation path" contract
 * as the CSV export above. Uses this codebase's existing export style vocabulary only (bold
 * title/header rows via ExcelJS, content-driven column widths via the shared `excelColumnWidth`).
 */
export async function exportDeductionReportToXlsx(rows: DeductionReportRow[]): Promise<DeductionReportExportResult> {
  const exportRows = rows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Deduction Report');

  worksheet.addRow(['Deduction Report']).font = { bold: true, size: 13 };
  worksheet.addRow([]);
  worksheet.addRow(DEDUCTION_REPORT_EXPORT_HEADERS as unknown as string[]).font = { bold: true };
  for (const row of exportRows) worksheet.addRow(row);

  DEDUCTION_REPORT_EXPORT_HEADERS.forEach((header, index) => {
    const columnValues = exportRows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: rows.length };
}
