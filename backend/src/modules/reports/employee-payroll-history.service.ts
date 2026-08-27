import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { AdvanceStatus, SessionUser } from '@payroll/shared';
import {
  calcNet,
  isOutstandingWaived,
  sumMoney,
  type CalcNetResult,
  EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS,
  type EmployeePayrollHistoryActorRef,
  type EmployeePayrollHistoryAdvanceSummary,
  type EmployeePayrollHistoryBalanceAdjustmentSummary,
  type EmployeePayrollHistoryCorrectionDetail,
  type EmployeePayrollHistoryDetail,
  type EmployeePayrollHistoryEmployeeLookupQuery,
  type EmployeePayrollHistoryEmployeeSearchResponse,
  type EmployeePayrollHistoryExportQuery,
  type EmployeePayrollHistoryListQuery,
  type EmployeePayrollHistoryListResponse,
  type EmployeePayrollHistoryMaterializationDetail,
  type EmployeePayrollHistoryRow,
  type EmployeePayrollHistorySortField,
  type EmployeePayrollHistorySortDirection,
  type EmployeePayrollHistoryTotals,
  type EmployeePayrollHistoryUnitRef,
} from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { stringifyCsvSafe } from '../../common/import-export';
import { excelColumnWidth } from '../../common/excel-utils';
import { assertSiteAccess, getAccessibleSiteIds } from '../../common/authz-policy';
import { searchEmployeesByHistoricalPayroll } from '../../common/historical-payroll-employee-lookup';
import { derivePayrollEntryRowStatus, payrollEntryRowStatusWhereClause } from './payroll-entry-row-status';

/**
 * Phase 7 Reports, Employee Payroll History Checkpoint 1A (approved architecture review +
 * approved product/architecture decisions, 2026-08-05).
 *
 * **Report grain (approved decision 6):** one row = one `PayrollEntry`; because of its own
 * `@@unique([cycleId, employeeId])` constraint this is equivalent to one employee per payroll
 * cycle. No second reporting table.
 *
 * **Financial meaning (approved decision 7):** every row's `netSalary`/`totalEarnings`/
 * `totalDeductions` come from canonical `calcNet` applied to the entry's own *stored* columns —
 * the immutable, as-released figure. A `Correction` never mutates those stored columns (it's a
 * separate, append-only baseline-replay record layered on top — `docs/architecture/workflows/
 * corrections-and-balance-adjustments.md`), so this is always exactly what was released, never a
 * correction-replayed figure. Corrections/Balance Adjustments/materializations/settlements/
 * Correction Payments are related detail data, fetched and returned separately (see
 * `getEmployeePayrollHistoryDetail`), never folded into the main row's own totals.
 *
 * **Historical scoping (approved decision 8):** every row is authorized against its own
 * `PayrollEntry.siteId` — never the employee's current `Employee.siteId`. `employeeCode` and
 * `currentEmployeeRosterStatus` are explicitly *current* Employee Registry facts (no historical
 * snapshot exists for either); never described as frozen historical facts.
 *
 * **Pagination (approved decision 9):** database-level `skip`/`take` for every sort key except
 * `netSalary`, which is not a stored column — see `getEmployeePayrollHistoryListSortedByNetSalary`
 * for the one, narrow, bounded, explicitly-tested exception this forces, and
 * `docs/architecture/workflows/reports.md`'s Employee Payroll History section for the full
 * reasoning `PROJECT_PROGRESS.md` records as a resolved architecture conflict, not a silent
 * shortcut.
 */

// --- Filter resolution -------------------------------------------------------------------------

/** Mirrors `reports.service.ts`'s own `resolveSiteIdFilter` exactly (explicit filter -> each site
 * independently access-checked, 403 on any inaccessible site named, never silently narrowed;
 * omitted -> the caller's full accessible scope, `undefined` for unrestricted global authority). */
function resolveSiteIdFilter(currentUser: SessionUser, siteIds?: string[]): string[] | undefined {
  if (siteIds && siteIds.length > 0) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
    return siteIds;
  }
  return getAccessibleSiteIds(currentUser);
}

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

/** Cycle-range filter, expressed directly against the `cycle` relation (no separate "fetch every
 * cycle" step — unlike `statements.service.ts`'s own per-employee-bounded range resolution, this
 * report's query is not always employee-scoped, so pushing the range into the main query itself
 * is the safer default). Existence and `from <= to` ordering are both validated *after* looking
 * the cycles up — semantic ordering can only be checked once both are real rows, per the shared
 * schema's own doc comment. */
async function resolveCycleRangeFilter(
  fromCycleId: string | undefined,
  toCycleId: string | undefined,
): Promise<Prisma.PayrollEntryWhereInput['cycle'] | undefined> {
  if (!fromCycleId && !toCycleId) return undefined;

  const [fromCycle, toCycle] = await Promise.all([
    fromCycleId ? prisma.payrollCycle.findUnique({ where: { id: fromCycleId }, select: { year: true, month: true } }) : null,
    toCycleId ? prisma.payrollCycle.findUnique({ where: { id: toCycleId }, select: { year: true, month: true } }) : null,
  ]);
  if (fromCycleId && !fromCycle) throw notFound('fromCycleId does not reference an existing payroll cycle');
  if (toCycleId && !toCycle) throw notFound('toCycleId does not reference an existing payroll cycle');

  if (fromCycle && toCycle) {
    const fromKey = fromCycle.year * 12 + fromCycle.month;
    const toKey = toCycle.year * 12 + toCycle.month;
    if (fromKey > toKey) throw badRequest('fromCycleId must not be after toCycleId');
  }

  const conditions: Prisma.PayrollCycleWhereInput[] = [];
  if (fromCycle) {
    conditions.push({ OR: [{ year: { gt: fromCycle.year } }, { year: fromCycle.year, month: { gte: fromCycle.month } }] });
  }
  if (toCycle) {
    conditions.push({ OR: [{ year: { lt: toCycle.year } }, { year: toCycle.year, month: { lte: toCycle.month } }] });
  }
  return { AND: conditions };
}

interface ResolvedEmployeePayrollHistoryFilters {
  where: Prisma.PayrollEntryWhereInput;
  siteIdFilter: string[] | null;
}

/** The one validated-filter-construction function every list/totals/export query shares. Every
 * filter targets a distinct set of `PayrollEntry` fields (never two filters writing the same key
 * into the object literal below), so a plain object-literal merge is safe here — unlike the
 * per-status breakdown counts in `computeEmployeePayrollHistoryTotals`, which combine this
 * `where` with a *second* `released`/`hold`/`payoutOutcome` condition and must use `AND` instead. */
async function resolveEmployeePayrollHistoryFilters(
  currentUser: SessionUser,
  query: Pick<
    EmployeePayrollHistoryListQuery,
    | 'employeeId'
    | 'siteIds'
    | 'unitId'
    | 'fromCycleId'
    | 'toCycleId'
    | 'rowStatus'
    | 'hasCorrection'
    | 'hasOutstandingOriginBalance'
    | 'currentEmployeeRosterStatus'
  >,
): Promise<ResolvedEmployeePayrollHistoryFilters> {
  const siteIdFilter = resolveSiteIdFilter(currentUser, query.siteIds);
  const unitId = await resolveUnitFilter(currentUser, query.unitId, siteIdFilter);
  const cycleFilter = await resolveCycleRangeFilter(query.fromCycleId, query.toCycleId);

  const outstandingOriginBalanceCondition: Prisma.PayrollEntryWhereInput = {
    OR: [
      { originatedBalanceAdjustment: { remainingAmount: { gt: 0 } } },
      { corrections: { some: { balanceAdjustment: { remainingAmount: { gt: 0 } } } } },
    ],
  };

  const where: Prisma.PayrollEntryWhereInput = {
    ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    ...(query.employeeId && { employeeId: query.employeeId }),
    ...(unitId && { workLines: { some: { unitId } } }),
    ...(cycleFilter && { cycle: cycleFilter }),
    ...(query.rowStatus && payrollEntryRowStatusWhereClause(query.rowStatus)),
    ...(query.hasCorrection === true && { corrections: { some: {} } }),
    ...(query.hasCorrection === false && { corrections: { none: {} } }),
    ...(query.hasOutstandingOriginBalance === true && outstandingOriginBalanceCondition),
    ...(query.hasOutstandingOriginBalance === false && { NOT: outstandingOriginBalanceCondition }),
    ...(query.currentEmployeeRosterStatus === 'ACTIVE' && { employee: { dateOfLeaving: null } }),
    ...(query.currentEmployeeRosterStatus === 'DEPARTED' && { employee: { dateOfLeaving: { not: null } } }),
  };

  return { where, siteIdFilter: siteIdFilter ?? null };
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
  cycle: { select: { id: true, year: true, month: true, status: true } },
  site: { select: { name: true } },
  employee: { select: { employeeCode: true, name: true, dateOfLeaving: true } },
  workLines: {
    // `sortOrder` alone is not guaranteed unique (it defaults to 0 and is only assigned
    // meaningfully by the Split-by-Unit workflow) — an explicit `id` tie-break is mandatory so
    // "the primary work line" is deterministic even for two lines that happen to share the same
    // `sortOrder`, matching this whole report's own "every sort ends in a deterministic tie-break"
    // discipline (§11 of the approved architecture review).
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
 * input contract — the report-query analogue of `payroll-entry.service.ts`'s `computeEntryCalc`
 * and `reports.service.ts`'s own `calcEntry`, calling the exact same canonical `calcNet` (never a
 * second net-salary formula) against this module's own row shape. */
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

// --- Batched correction-presence / outstanding-origin-balance lookups (never per-row) ----------

async function fetchCorrectionCounts(entryIds: string[]): Promise<Map<string, number>> {
  if (entryIds.length === 0) return new Map();
  const grouped = await prisma.correction.groupBy({
    by: ['payrollEntryId'],
    where: { payrollEntryId: { in: entryIds } },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.payrollEntryId, row._count._all]));
}

/**
 * Narrow, approved definition (Step 4): a `BalanceAdjustment` whose *origin* is this entry —
 * either directly (`originPayrollEntryId`, the automatic negative-payroll-recovery path) or via a
 * `Correction` this entry produced (`correction.payrollEntryId`) — currently has
 * `remainingAmount > 0`. One batched query for the whole page (an `OR` of two relation
 * conditions, never a per-entry follow-up); never true merely because this entry *consumed* a
 * materialization originating elsewhere (that fact lives only in the detail endpoint's own
 * `materializationsConsumedByThisEntry`).
 */
async function fetchOutstandingOriginBalanceEntryIds(entryIds: string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const rows = await prisma.balanceAdjustment.findMany({
    where: {
      remainingAmount: { gt: 0 },
      OR: [{ originPayrollEntryId: { in: entryIds } }, { correction: { payrollEntryId: { in: entryIds } } }],
    },
    select: { originPayrollEntryId: true, correction: { select: { payrollEntryId: true } } },
  });
  const ids = new Set<string>();
  for (const row of rows) {
    const originEntryId = row.originPayrollEntryId ?? row.correction?.payrollEntryId ?? null;
    if (originEntryId) ids.add(originEntryId);
  }
  return ids;
}

function toUnitRef(unit: { id: string; name: string; code: string | null }): EmployeePayrollHistoryUnitRef {
  return { id: unit.id, name: unit.name, code: unit.code };
}

async function mapEntriesToRows(entries: RowEntry[]): Promise<EmployeePayrollHistoryRow[]> {
  const entryIds = entries.map((entry) => entry.id);
  const [correctionCounts, outstandingOriginBalanceIds] = await Promise.all([
    fetchCorrectionCounts(entryIds),
    fetchOutstandingOriginBalanceEntryIds(entryIds),
  ]);

  return entries.map((entry) => {
    const calc = calcEntryRow(entry);
    const primaryLine = entry.workLines[0] ?? null;

    return {
      payrollEntryId: entry.id,
      cycle: { id: entry.cycle.id, year: entry.cycle.year, month: entry.cycle.month, status: entry.cycle.status },
      employeeId: entry.employeeId,
      employeeCode: entry.employee.employeeCode,
      employeeName: entry.employeeNameSnapshot ?? entry.employee.name,
      siteId: entry.siteId,
      siteName: entry.site.name,
      primaryUnit: primaryLine ? toUnitRef(primaryLine.unit) : null,
      additionalUnitCount: Math.max(0, entry.workLines.length - 1),
      designation: entry.designation,
      currentEmployeeRosterStatus: entry.employee.dateOfLeaving ? 'DEPARTED' : 'ACTIVE',
      totalEarnings: calc.totalEarning,
      totalDeductions: calc.totalDeduction,
      netSalary: calc.netSalary,
      rowStatus: derivePayrollEntryRowStatus(entry),
      correctionCount: correctionCounts.get(entry.id) ?? 0,
      hasOutstandingOriginBalance: outstandingOriginBalanceIds.has(entry.id),
      releasedAt: entry.releasedAt?.toISOString() ?? null,
    };
  });
}

// --- Deterministic ordering ---------------------------------------------------------------------

/**
 * Every branch ends with `{ id: 'asc' }` — the mandatory final tie-break (approved decision), so
 * offset pagination never drifts between pages for two rows the primary/secondary keys alone
 * can't order (e.g. two entries in the same cycle at the same site with the same employee name).
 *
 * `rowStatus`'s own ordering is a disclosed, documented approximation, not the 5-state precedence
 * `derivePayrollEntryRowStatus`/`payrollEntryRowStatusWhereClause` use: it
 * orders by the three real, stored columns that *determine* status (`released`, `hold`,
 * `payoutOutcome`), which groups every row of the same status contiguously (verified by test),
 * but the relative order *between* groups follows Postgres's own boolean/enum ordering, not the
 * precedence rank. This is safe because sorting is a display convenience, never a filter or a
 * financial figure — unlike `netSalary` (see `getEmployeePayrollHistoryListSortedByNetSalary`),
 * expressing it exactly would require a raw SQL `CASE` expression outside Prisma's typed
 * `orderBy`, which this checkpoint does not introduce for a sort-only concern.
 */
function buildOrderBy(
  sortBy: Exclude<EmployeePayrollHistorySortField, 'netSalary'>,
  dir: EmployeePayrollHistorySortDirection,
): Prisma.PayrollEntryOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'cycle':
      return [{ cycle: { year: dir } }, { cycle: { month: dir } }, { site: { name: 'asc' } }, { employee: { name: 'asc' } }, { id: 'asc' }];
    case 'employeeCode':
      return [{ employee: { employeeCode: dir } }, { id: 'asc' }];
    case 'employeeName':
      return [{ employee: { name: dir } }, { id: 'asc' }];
    case 'site':
      return [{ site: { name: dir } }, { cycle: { year: 'desc' } }, { cycle: { month: 'desc' } }, { id: 'asc' }];
    case 'rowStatus':
      return [{ released: dir }, { hold: dir }, { payoutOutcome: dir }, { id: 'asc' }];
  }
}

// --- Totals ------------------------------------------------------------------------------------

/**
 * See `EmployeePayrollHistoryTotals`'s own doc comment (`shared/src/schemas/employee-payroll-history.ts`)
 * for the full reasoning this resolves an explicit architecture conflict rather than silently
 * approximating: `netSalary`/`totalEarnings`/`totalDeductions` are never stored columns, so an
 * exact SQL `SUM` would require an independent, drift-prone second implementation of `calcNet`.
 * This function instead fetches every matching row's calc inputs and sums via the canonical
 * `calcNet`/`sumMoney` — but only when `matchingCount` is within the already-approved
 * `EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS` ceiling (the same bound this checkpoint established
 * for exports, reused rather than inventing a second one). Beyond that bound, the five status
 * counts (plain DB aggregates) are still returned exactly; the three monetary sums are `null`
 * with `totalsComputed: false` — visible and honest, never a silently wrong or partial number.
 *
 * The five status-breakdown counts are computed with `AND: [where, statusClause]`, never a
 * shallow object-spread merge — `where` may already carry its own `released`/`hold`/
 * `payoutOutcome` condition (the caller's own `rowStatus` filter), and a spread merge would
 * silently overwrite it instead of combining with it.
 */
async function computeEmployeePayrollHistoryTotals(where: Prisma.PayrollEntryWhereInput): Promise<EmployeePayrollHistoryTotals> {
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

  if (matchingCount > EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS) {
    return { ...base, totalEarnings: null, totalDeductions: null, netSalaryTotal: null, totalsComputed: false };
  }

  const entries = await prisma.payrollEntry.findMany({ where, select: CALC_INPUT_SELECT });
  const calcs = entries.map(calcEntryRow);

  return {
    ...base,
    totalEarnings: sumMoney(calcs.map((calc) => calc.totalEarning)),
    totalDeductions: sumMoney(calcs.map((calc) => calc.totalDeduction)),
    netSalaryTotal: sumMoney(calcs.map((calc) => calc.netSalary)),
    totalsComputed: true,
  };
}

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

// --- List --------------------------------------------------------------------------------------

/**
 * `netSalary` is not a stored column (`calcNet` only) — a database-level `ORDER BY netSalary`
 * would require an independent, drift-prone second SQL implementation of the same formula
 * (explicitly forbidden by this checkpoint's own instructions), and sorting the *complete*
 * matching set in application memory before paginating is exactly the "fetch everything, then
 * slice" pattern `docs/architecture/workflows/reports.md §9` forbids for a row-level report.
 *
 * **Resolution, reusing already-approved infrastructure rather than inventing new infrastructure**:
 * when `matchingCount` is within `EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS` (the same ceiling
 * this checkpoint already established, and already justified, for exports), fetch every matching
 * row's calc inputs, compute `netSalary` via canonical `calcNet`, sort in memory (with an explicit
 * `id`-ascending tie-break — V8's `Array.prototype.sort` is stable, but this makes the ordering
 * a property of the comparator, not an implementation detail of the engine), and paginate the
 * already-sorted array. Beyond that bound, `sortBy=netSalary` is rejected with a clear 400 —
 * narrow your filters — never silently truncated, never falling back to a different sort, and
 * never loading an unanalyzed unbounded result set. See this file's own top-of-module doc comment
 * and `docs/architecture/workflows/reports.md`'s Employee Payroll History section for the full
 * record of this as a resolved, disclosed architecture conflict.
 */
async function getEmployeePayrollHistoryListSortedByNetSalary(
  where: Prisma.PayrollEntryWhereInput,
  page: number,
  pageSize: number,
  sortDir: EmployeePayrollHistorySortDirection,
): Promise<{ total: number; rows: EmployeePayrollHistoryRow[] }> {
  const total = await prisma.payrollEntry.count({ where });
  if (total > EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS) {
    throw badRequest(
      `Sorting by Net Salary requires narrowing your filters to ${EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS} or fewer matching rows (matched ${total}). Net Salary is not a stored column and cannot be sorted at the database level without duplicating the canonical calcNet formula — narrow your filters, or sort by a different column.`,
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

export async function getEmployeePayrollHistoryList(
  currentUser: SessionUser,
  query: EmployeePayrollHistoryListQuery,
): Promise<EmployeePayrollHistoryListResponse> {
  const { where } = await resolveEmployeePayrollHistoryFilters(currentUser, query);

  let total: number;
  let rows: EmployeePayrollHistoryRow[];

  if (query.sortBy === 'netSalary') {
    const result = await getEmployeePayrollHistoryListSortedByNetSalary(where, query.page, query.pageSize, query.sortDir);
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

  const totals = await computeEmployeePayrollHistoryTotals(where);

  return { page: query.page, pageSize: query.pageSize, total, rows, totals, generatedAt: new Date().toISOString() };
}

// --- Employee lookup -----------------------------------------------------------------------------

export async function searchEmployeePayrollHistoryEmployees(
  currentUser: SessionUser,
  params: EmployeePayrollHistoryEmployeeLookupQuery,
): Promise<EmployeePayrollHistoryEmployeeSearchResponse> {
  return searchEmployeesByHistoricalPayroll(currentUser, params);
}

// --- Export --------------------------------------------------------------------------------------

export interface EmployeePayrollHistoryExportData {
  rows: EmployeePayrollHistoryRow[];
  totalMatching: number;
}

/**
 * Every matching row, in the same deterministic order the list endpoint would apply — up to
 * `EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS`. A preflight `COUNT` runs before any row is fetched
 * or any CSV/XLSX buffer is generated — an over-limit request is rejected outright (the caller's
 * route layer maps this to the structured `EmployeePayrollHistoryExportLimitError`), never
 * silently truncated to the first N rows.
 */
export async function buildEmployeePayrollHistoryExportData(
  currentUser: SessionUser,
  query: EmployeePayrollHistoryExportQuery,
): Promise<EmployeePayrollHistoryExportData> {
  const { where } = await resolveEmployeePayrollHistoryFilters(currentUser, query);
  const totalMatching = await prisma.payrollEntry.count({ where });

  if (totalMatching > EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS) {
    return { rows: [], totalMatching };
  }

  if (query.sortBy === 'netSalary') {
    const sorted = await getEmployeePayrollHistoryListSortedByNetSalary(where, 1, totalMatching || 1, query.sortDir);
    return { rows: sorted.rows, totalMatching };
  }

  const orderBy = buildOrderBy(query.sortBy, query.sortDir);
  const entries = await prisma.payrollEntry.findMany({ where, select: ROW_SELECT, orderBy });
  const rows = await mapEntriesToRows(entries);
  return { rows, totalMatching };
}

/**
 * The bulk-export flat column set (approved Step 7) — a deliberate subset of
 * `EmployeePayrollHistoryRow`, excluding CNIC, every banking field, release-actor identity, audit
 * actor identity, correction reasons, before/after correction detail, and nested settlement
 * detail (all of that stays drill-down-only, via `getEmployeePayrollHistoryDetail`). Values are
 * read verbatim off the same `EmployeePayrollHistoryRow` objects the list endpoint returns — never
 * resummed or reformatted differently — so export values are guaranteed to exactly match the
 * on-screen API row values (Principle 6).
 */
export const EMPLOYEE_PAYROLL_HISTORY_EXPORT_HEADERS = [
  'Payroll Month',
  'Employee Code',
  'Employee Name',
  'Project Site',
  'Primary Unit',
  'Additional Unit Count',
  'Designation',
  'Total Earnings',
  'Total Deductions',
  'Net Salary',
  'Row Status',
  'Correction Count',
  'Outstanding Origin Balance',
  'Released Date',
] as const;

function buildExportRow(row: EmployeePayrollHistoryRow): string[] {
  return [
    `${row.cycle.year}-${String(row.cycle.month).padStart(2, '0')}`,
    row.employeeCode ?? '—',
    row.employeeName,
    row.siteName,
    row.primaryUnit?.name ?? '—',
    String(row.additionalUnitCount),
    row.designation,
    row.totalEarnings,
    row.totalDeductions,
    row.netSalary,
    row.rowStatus,
    String(row.correctionCount),
    row.hasOutstandingOriginBalance ? 'Yes' : 'No',
    row.releasedAt ? row.releasedAt.slice(0, 10) : '—',
  ];
}

export interface EmployeePayrollHistoryExportResult {
  buffer: Buffer;
  rowCount: number;
}

/**
 * CSV export — calls `buildEmployeePayrollHistoryExportData` exactly once (the same
 * filter/sort/row-shaping every other entry point shares), reuses the codebase's one mandatory
 * CSV-serialization entry point (`stringifyCsvSafe`) for formula-injection neutralization. The
 * caller (`employee-payroll-history.routes.ts`) is responsible for checking
 * `totalMatching > EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS` *before* calling this — this function
 * assumes that preflight has already passed and simply renders whatever rows it's handed.
 */
export function exportEmployeePayrollHistoryToCsv(rows: EmployeePayrollHistoryRow[]): EmployeePayrollHistoryExportResult {
  const csv = stringifyCsvSafe([EMPLOYEE_PAYROLL_HISTORY_EXPORT_HEADERS as unknown as string[], ...rows.map(buildExportRow)]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: rows.length };
}

/**
 * XLSX export — same "one shared row-shaping function, no independent calculation path" contract
 * as the CSV export above. Uses this codebase's existing export style vocabulary only (bold
 * title/header rows via ExcelJS, content-driven column widths via the shared
 * `excelColumnWidth` — no formulas, no Excel currency `numFmt`), matching Payroll Summary's/
 * Statements' own XLSX exports.
 */
export async function exportEmployeePayrollHistoryToXlsx(rows: EmployeePayrollHistoryRow[]): Promise<EmployeePayrollHistoryExportResult> {
  const exportRows = rows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Employee Payroll History');

  worksheet.addRow(['Employee Payroll History']).font = { bold: true, size: 13 };
  worksheet.addRow([]);
  worksheet.addRow(EMPLOYEE_PAYROLL_HISTORY_EXPORT_HEADERS as unknown as string[]).font = { bold: true };
  for (const row of exportRows) worksheet.addRow(row);

  EMPLOYEE_PAYROLL_HISTORY_EXPORT_HEADERS.forEach((header, index) => {
    const columnValues = exportRows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: rows.length };
}

// --- Detail ------------------------------------------------------------------------------------

const BALANCE_ADJUSTMENT_SELECT = {
  id: true,
  type: true,
  status: true,
  paymentTiming: true,
  amount: true,
  remainingAmount: true,
  settlements: {
    orderBy: { appliedAt: 'asc' as const },
    select: { id: true, amountApplied: true, appliedAt: true, cycle: { select: { id: true, year: true, month: true, status: true } } },
  },
  correctionPayment: {
    select: { id: true, amount: true, paidAt: true, paidBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.BalanceAdjustmentSelect;

type BalanceAdjustmentDetailRow = Prisma.BalanceAdjustmentGetPayload<{ select: typeof BALANCE_ADJUSTMENT_SELECT }>;

function mapBalanceAdjustmentSummary(ba: BalanceAdjustmentDetailRow): EmployeePayrollHistoryBalanceAdjustmentSummary {
  return {
    balanceAdjustmentId: ba.id,
    type: ba.type,
    status: ba.status,
    paymentTiming: ba.paymentTiming,
    amount: ba.amount.toFixed(2),
    remainingAmount: ba.remainingAmount.toFixed(2),
    settlements: ba.settlements.map((settlement) => ({
      settlementId: settlement.id,
      cycle: { id: settlement.cycle.id, year: settlement.cycle.year, month: settlement.cycle.month, status: settlement.cycle.status },
      amountApplied: settlement.amountApplied.toFixed(2),
      appliedAt: settlement.appliedAt.toISOString(),
    })),
    correctionPayment: ba.correctionPayment
      ? {
          correctionPaymentId: ba.correctionPayment.id,
          amount: ba.correctionPayment.amount.toFixed(2),
          paidAt: ba.correctionPayment.paidAt.toISOString(),
          paidBy: ba.correctionPayment.paidBy,
        }
      : null,
  };
}

const DETAIL_SELECT = {
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
  lateReason: true,
  cycle: { select: { id: true, year: true, month: true, status: true } },
  site: { select: { name: true } },
  employee: { select: { employeeCode: true, name: true, cnic: true, dateOfLeaving: true } },
  releasedByUser: { select: { id: true, name: true } },
  workLines: {
    // Same deterministic `id` tie-break as `ROW_SELECT` above, for the identical reason.
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      sortOrder: true,
      days: true,
      otHours: true,
      otRate: true,
      cycleDays: true,
      unit: { select: { id: true, name: true, code: true } },
    },
  },
  advance: { select: { id: true, type: true, totalAmount: true, outstandingBalance: true, status: true, dateGiven: true } },
  eidAdvance: { select: { id: true, type: true, totalAmount: true, outstandingBalance: true, status: true, dateGiven: true } },
  corrections: {
    orderBy: { approvedAt: 'asc' as const },
    select: {
      id: true,
      approvedAt: true,
      reason: true,
      field: true,
      oldValue: true,
      newValue: true,
      oldNetSalary: true,
      newNetSalary: true,
      approvedBy: { select: { id: true, name: true } },
      adjustmentType: { select: { label: true } },
      balanceAdjustment: { select: BALANCE_ADJUSTMENT_SELECT },
    },
  },
  originatedBalanceAdjustment: { select: BALANCE_ADJUSTMENT_SELECT },
  balanceAdjustmentMaterializations: {
    select: {
      id: true,
      amount: true,
      status: true,
      balanceAdjustment: {
        select: {
          id: true,
          type: true,
          sourceCycle: { select: { id: true, year: true, month: true, status: true } },
          originPayrollEntryId: true,
          correction: { select: { payrollEntryId: true } },
        },
      },
    },
  },
} satisfies Prisma.PayrollEntrySelect;

type DetailEntry = Prisma.PayrollEntryGetPayload<{ select: typeof DETAIL_SELECT }>;

/**
 * v1.0.4 Cancel Business Semantics amendment: `outstandingBalance` here is masked to `0.00`
 * whenever the Advance is CANCELLED (`isOutstandingWaived`) — a cancelled Advance's remaining
 * balance is waived, never still owed, so this history view must not present it as outstanding.
 * The underlying stored value is left untouched by `cancelAdvance` itself (`advances.service.ts`)
 * — only this display-layer read is masked; no other field here derives a "recovered" figure from
 * it, so there is nothing else in this function that could be thrown off by the mask.
 */
function mapAdvanceSummary(
  advance: { id: string; type: 'LOAN' | 'EID_ADVANCE'; totalAmount: Prisma.Decimal; outstandingBalance: Prisma.Decimal; status: AdvanceStatus; dateGiven: Date } | null,
  deductionThisEntry: Prisma.Decimal,
): EmployeePayrollHistoryAdvanceSummary | null {
  if (!advance) return null;
  return {
    advanceId: advance.id,
    type: advance.type,
    totalAmount: advance.totalAmount.toFixed(2),
    outstandingBalance: isOutstandingWaived(advance.status) ? '0.00' : advance.outstandingBalance.toFixed(2),
    status: advance.status,
    dateGiven: advance.dateGiven.toISOString().slice(0, 10),
    deductionThisEntry: deductionThisEntry.toFixed(2),
  };
}

function mapCorrectionDetail(correction: DetailEntry['corrections'][number]): EmployeePayrollHistoryCorrectionDetail {
  return {
    correctionId: correction.id,
    approvedAt: correction.approvedAt.toISOString(),
    approvedBy: correction.approvedBy,
    reason: correction.reason,
    field: correction.field,
    oldValue: correction.oldValue,
    newValue: correction.newValue,
    oldNetSalary: correction.oldNetSalary.toFixed(2),
    newNetSalary: correction.newNetSalary.toFixed(2),
    adjustmentTypeLabel: correction.adjustmentType.label,
    resultingBalanceAdjustment: correction.balanceAdjustment ? mapBalanceAdjustmentSummary(correction.balanceAdjustment) : null,
  };
}

function mapMaterializationDetail(
  materialization: DetailEntry['balanceAdjustmentMaterializations'][number],
): EmployeePayrollHistoryMaterializationDetail {
  const ba = materialization.balanceAdjustment;
  return {
    materializationId: materialization.id,
    amount: materialization.amount.toFixed(2),
    status: materialization.status,
    originBalanceAdjustmentId: ba.id,
    originType: ba.type,
    originCycle: { id: ba.sourceCycle.id, year: ba.sourceCycle.year, month: ba.sourceCycle.month, status: ba.sourceCycle.status },
    originPayrollEntryId: ba.originPayrollEntryId ?? ba.correction?.payrollEntryId ?? null,
  };
}

/**
 * `GET /api/v1/reports/employee-payroll-history/:entryId` — the entry-oriented detail response.
 * Authorizes strictly against *this entry's own* historical `siteId`, never a prior list request
 * or client-supplied site parameter (approved Step 5 instruction). Returns 404, not 403, for both
 * a nonexistent and an inaccessible entry — reveals nothing about which case applies, matching
 * Statements'/Payslips' own established "reveal nothing" posture for a single-record detail
 * endpoint (unlike the list endpoint, which simply omits inaccessible rows rather than needing a
 * concealed-404 story at all).
 */
export async function getEmployeePayrollHistoryDetail(currentUser: SessionUser, entryId: string): Promise<EmployeePayrollHistoryDetail> {
  const entry = await prisma.payrollEntry.findUnique({ where: { id: entryId }, select: DETAIL_SELECT });
  if (!entry) throw notFound('Payroll entry not found');

  const accessibleSiteIds = getAccessibleSiteIds(currentUser);
  if (accessibleSiteIds !== undefined && !accessibleSiteIds.includes(entry.siteId)) {
    throw notFound('Payroll entry not found');
  }

  const calc = calcEntryRow(entry);
  const releasedBy: EmployeePayrollHistoryActorRef | null = entry.releasedByUser
    ? { id: entry.releasedByUser.id, name: entry.releasedByUser.name }
    : null;

  return {
    payrollEntryId: entry.id,
    identity: {
      employeeId: entry.employeeId,
      employeeCode: entry.employee.employeeCode,
      employeeName: entry.employeeNameSnapshot ?? entry.employee.name,
      cnic: entry.employee.cnic,
      cycle: { id: entry.cycle.id, year: entry.cycle.year, month: entry.cycle.month, status: entry.cycle.status },
      siteId: entry.siteId,
      siteName: entry.site.name,
      designation: entry.designation,
      currentEmployeeRosterStatus: entry.employee.dateOfLeaving ? 'DEPARTED' : 'ACTIVE',
    },
    calculation: {
      grossPay: entry.grossPay.toFixed(2),
      workLines: calc.workLines.map((line, index) => {
        const source = entry.workLines[index]!;
        return {
          id: source.id,
          unit: toUnitRef(source.unit),
          days: source.days.toFixed(2),
          otHours: source.otHours.toFixed(2),
          otRate: source.otRate?.toFixed(2) ?? null,
          cycleDays: source.cycleDays,
          dailyRate: line.dailyRate,
          effectiveOtRate: line.effectiveOtRate,
          earnedAmount: line.earnedAmount,
          otEarned: line.otEarned,
          sortOrder: line.sortOrder,
        };
      }),
      effectiveLeaveRate: calc.effectiveLeaveRate,
      leaveDays: entry.leaveDays.toFixed(2),
      leaveEarned: calc.leaveEarned,
      allowance: entry.allowance.toFixed(2),
      earnedAmount: calc.earnedAmount,
      otEarned: calc.otEarned,
      correctionBalancePayable: calc.correctionBalancePayable,
      totalEarning: calc.totalEarning,
      eobiAmount: entry.eobiAmount.toFixed(2),
      eobiApplicable: entry.eobiApplicable,
      eobiDeduction: calc.eobiDeduction,
      advanceDeduction: entry.advanceDeduction.toFixed(2),
      eidAdvanceDeduction: entry.eidAdvanceDeduction.toFixed(2),
      fine: entry.fine.toFixed(2),
      correctionBalanceRecovery: calc.correctionBalanceRecovery,
      totalDeduction: calc.totalDeduction,
      netSalary: calc.netSalary,
    },
    release: {
      released: entry.released,
      releasedAt: entry.releasedAt?.toISOString() ?? null,
      releasedBy,
      lateReason: entry.lateReason,
      hold: entry.hold,
      payoutOutcome: entry.payoutOutcome,
    },
    advances: [
      mapAdvanceSummary(entry.advance, entry.advanceDeduction),
      mapAdvanceSummary(entry.eidAdvance, entry.eidAdvanceDeduction),
    ].filter((advance): advance is EmployeePayrollHistoryAdvanceSummary => advance !== null),
    correctionsOriginatingFromThisEntry: entry.corrections.map(mapCorrectionDetail),
    automaticRecoveryBalanceAdjustment: entry.originatedBalanceAdjustment ? mapBalanceAdjustmentSummary(entry.originatedBalanceAdjustment) : null,
    materializationsConsumedByThisEntry: entry.balanceAdjustmentMaterializations.map(mapMaterializationDetail),
    auditReferences: [
      { entityType: 'PayrollEntry', entityId: entry.id },
      ...entry.corrections.map((correction) => ({ entityType: 'Correction', entityId: correction.id })),
    ],
    generatedAt: new Date().toISOString(),
  };
}
