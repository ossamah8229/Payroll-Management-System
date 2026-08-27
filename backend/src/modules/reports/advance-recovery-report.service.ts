import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import { isOutstandingWaived, normalizeCnic } from '@payroll/shared';
import {
  ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS,
  type AdvanceRecoveryReportDetail,
  type AdvanceRecoveryReportEmployeeLookupQuery,
  type AdvanceRecoveryReportEmployeeLookupResponse,
  type AdvanceRecoveryReportExportQuery,
  type AdvanceRecoveryReportListQuery,
  type AdvanceRecoveryReportListResponse,
  type AdvanceRecoveryReportRow,
  type AdvanceRecoveryReportSortDirection,
  type AdvanceRecoveryReportSortField,
  type AdvanceRecoveryReportTotals,
  type AdvanceRecoveryReportTypeTotals,
} from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../common/http-error';
import { stringifyCsvSafe } from '../../common/import-export';
import { excelColumnWidth } from '../../common/excel-utils';
import { assertSiteAccess, getAccessibleSiteIds } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { derivePayrollEntryRowStatus } from './payroll-entry-row-status';

/**
 * Phase 7 Reports, Advance Recovery Report Checkpoint 1A (approved Checkpoint 0 architecture
 * review; frozen decisions carried over verbatim from the authorizing instruction — see
 * `shared/src/schemas/advance-recovery-report.ts`'s own file header for the full business-purpose/
 * grain/cycle/authorization contract this module implements).
 *
 * **Report grain:** one row = one `Advance`. **Site authorization:** `Advance.employee.siteId`
 * (current site) — Advance has no historical site of its own; this deliberately follows the
 * existing Advances module's own shipped authorization model (`advances.service.ts`'s
 * `assertSiteAccess(currentUser, advance.employee.siteId)`), including its 403 (not 404) posture
 * for a single-Advance detail lookup. **Totals are true DB aggregates throughout** (`SUM`/`COUNT`/
 * `GROUP BY`) — there is no bounded fetch-and-`calcNet`/`sumMoney` pass and no `totalsComputed`
 * fallback, unlike every `calcNet`-dependent sibling report in this module.
 */

// --- Filter resolution -------------------------------------------------------------------------

/** Mirrors every sibling report's own `resolveSiteIdFilter` exactly — explicit filter -> each site
 * independently access-checked (403 on any inaccessible site named, never silently narrowed);
 * omitted -> the caller's full accessible scope, `undefined` for unrestricted global authority. */
function resolveSiteIdFilter(currentUser: SessionUser, siteIds?: string[]): string[] | undefined {
  if (siteIds && siteIds.length > 0) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
    return siteIds;
  }
  return getAccessibleSiteIds(currentUser);
}

interface ResolvedAdvanceRecoveryReportFilters {
  where: Prisma.AdvanceWhereInput;
  /** `null` whenever `cycleId` was omitted (frozen decision — Cycle Semantics section) — Cycle is
   * the one OPTIONAL filter this report has, unlike every mandatory-single-cycle sibling report. */
  cycle: { id: string; year: number; month: number; status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' } | null;
}

/** The one validated-filter-construction function every list/totals/export query shares (Step 4
 * convention, mirroring every sibling report in this module). Authorizes against
 * `Advance.employee.siteId` (current site, frozen decision), never a historical column that does
 * not exist on this model. */
async function resolveAdvanceRecoveryReportFilters(
  currentUser: SessionUser,
  query: Pick<AdvanceRecoveryReportListQuery, 'siteIds' | 'employeeId' | 'advanceType' | 'status' | 'hasOutstandingBalance' | 'cycleId'>,
): Promise<ResolvedAdvanceRecoveryReportFilters> {
  const siteIdFilter = resolveSiteIdFilter(currentUser, query.siteIds);
  const cycle = query.cycleId ? await getPayrollCycle(query.cycleId) : null;

  const where: Prisma.AdvanceWhereInput = {
    ...(siteIdFilter && { employee: { siteId: { in: siteIdFilter } } }),
    ...(query.employeeId && { employeeId: query.employeeId }),
    ...(query.advanceType && { type: query.advanceType }),
    ...(query.status && { status: query.status }),
    // v1.0.4 Cancel Business Semantics amendment — a CANCELLED Advance's raw `outstandingBalance`
    // is deliberately left unzeroed (see `isOutstandingWaived`'s own doc comment), so filtering on
    // the raw column alone would wrongly surface a cancelled Advance under "Has Outstanding
    // Balance: Yes" even though its true recoverable is 0. `true` now also requires `status !=
    // CANCELLED`; `false` now also matches every CANCELLED row regardless of its stored balance.
    ...(query.hasOutstandingBalance === true && { status: { not: 'CANCELLED' }, outstandingBalance: { gt: 0 } }),
    ...(query.hasOutstandingBalance === false && { OR: [{ status: 'CANCELLED' }, { outstandingBalance: { lte: 0 } }] }),
  };

  return { where, cycle: cycle ? { id: cycle.id, year: cycle.year, month: cycle.month, status: cycle.status } : null };
}

// --- Row select/map ------------------------------------------------------------------------------

const ROW_SELECT = {
  id: true,
  employeeId: true,
  type: true,
  totalAmount: true,
  outstandingBalance: true,
  status: true,
  repaymentType: true,
  dateGiven: true,
  employee: { select: { employeeCode: true, name: true, siteId: true, site: { select: { name: true } } } },
} satisfies Prisma.AdvanceSelect;

type RowAdvance = Prisma.AdvanceGetPayload<{ select: typeof ROW_SELECT }>;

/**
 * The one canonical financial-value mapping (frozen decision — Canonical Financial Values
 * section): Original Amount = `totalAmount` verbatim, Current Outstanding Balance =
 * `outstandingBalance` verbatim (never replayed from `PayrollEntry` history) UNLESS the Advance is
 * CANCELLED, Recovered To Date = `totalAmount - outstandingBalance` — the only derived figure this
 * report computes for the roster. `recoveredThisCycle` is passed in already-resolved (`null` when no
 * Cycle is selected; a real, possibly-zero string when one is) — see `fetchRecoveryThisCycle` below
 * for why a `"0.00"` string and a `null` are deliberately never conflated.
 *
 * **v1.0.4 Cancel Business Semantics amendment (documented exception to the frozen decision above,
 * not a reversal of it):** Cancelling an Advance waives whatever remained unrecovered — nothing
 * further is owed, so "Current Outstanding Balance" must read 0 for a CANCELLED row
 * (`isOutstandingWaived`, `shared/src/schemas/advance.ts`). `outstandingBalance` itself is
 * deliberately NOT masked here for `recoveredToDate` — `cancelAdvance` (`advances.service.ts`)
 * never zeroes the stored column, only reverses an unreleased Draft deduction, so the real stored
 * value is exactly what "Recovered To Date" needs to stay correct; masking it would make a
 * cancelled Advance's full `totalAmount` misreport as recovered.
 */
function mapAdvanceToRow(advance: RowAdvance, recoveredThisCycle: string | null): AdvanceRecoveryReportRow {
  const displayOutstandingBalance = isOutstandingWaived(advance.status) ? new Prisma.Decimal(0) : advance.outstandingBalance;
  return {
    advanceId: advance.id,
    employeeId: advance.employeeId,
    employeeCode: advance.employee.employeeCode,
    employeeName: advance.employee.name,
    siteId: advance.employee.siteId,
    siteName: advance.employee.site.name,
    advanceType: advance.type,
    originalAmount: advance.totalAmount.toFixed(2),
    recoveredToDate: advance.totalAmount.minus(advance.outstandingBalance).toFixed(2),
    currentOutstandingBalance: displayOutstandingBalance.toFixed(2),
    status: advance.status,
    repaymentType: advance.repaymentType,
    dateGiven: advance.dateGiven.toISOString().slice(0, 10),
    recoveredThisCycle,
  };
}

/**
 * Batched, cycle-scoped recovery lookup (never per-row) — for LOAN advances, the linking column is
 * `PayrollEntry.advanceId`/`.advanceDeduction`; for EID_ADVANCE, `.eidAdvanceId`/
 * `.eidAdvanceDeduction` (frozen decision — Canonical Financial Values section). At most one
 * `PayrollEntry` can genuinely carry a given Advance's deduction for a given cycle (the
 * `(cycleId, employeeId)` uniqueness on `PayrollEntry`, combined with `advanceId`/`eidAdvanceId`
 * only ever being set to the one Advance whose deduction actually materialized onto that specific
 * entry), so this is a plain 1:1 map, never a sum-of-many.
 */
async function fetchRecoveryThisCycle(advanceIds: string[], cycleId: string): Promise<Map<string, string>> {
  if (advanceIds.length === 0) return new Map();

  const entries = await prisma.payrollEntry.findMany({
    where: { cycleId, OR: [{ advanceId: { in: advanceIds } }, { eidAdvanceId: { in: advanceIds } }] },
    select: { advanceId: true, eidAdvanceId: true, advanceDeduction: true, eidAdvanceDeduction: true },
  });

  const map = new Map<string, string>();
  for (const entry of entries) {
    if (entry.advanceId) map.set(entry.advanceId, entry.advanceDeduction.toFixed(2));
    if (entry.eidAdvanceId) map.set(entry.eidAdvanceId, entry.eidAdvanceDeduction.toFixed(2));
  }
  return map;
}

/**
 * Resolves every row's `recoveredThisCycle` in one batched pass. `null` for every row whenever no
 * Cycle is selected (never a fabricated historical zero); `"0.00"` — a real, meaningful fact, not a
 * placeholder — for a selected Cycle in which this specific Advance had no recovery (frozen
 * decision: "an Advance with no recovery in the selected Cycle remains in the roster").
 */
async function mapAdvancesToRows(advances: RowAdvance[], cycleId: string | null): Promise<AdvanceRecoveryReportRow[]> {
  if (!cycleId) {
    return advances.map((advance) => mapAdvanceToRow(advance, null));
  }
  const recoveryMap = await fetchRecoveryThisCycle(
    advances.map((advance) => advance.id),
    cycleId,
  );
  return advances.map((advance) => mapAdvanceToRow(advance, recoveryMap.get(advance.id) ?? '0.00'));
}

// --- Deterministic ordering ---------------------------------------------------------------------

/**
 * Every branch ends with `{ id: 'asc' }` — the mandatory final tie-break. Kept entirely database-
 * native (frozen decision — Sorting section): `recoveredThisCycle` is deliberately excluded from
 * `ADVANCE_RECOVERY_REPORT_SORT_FIELDS` entirely (not a stored `Advance` column), so this function
 * is never asked to sort by it.
 */
function buildOrderBy(
  sortBy: AdvanceRecoveryReportSortField,
  dir: AdvanceRecoveryReportSortDirection,
): Prisma.AdvanceOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'employeeCode':
      return [{ employee: { employeeCode: dir } }, { id: 'asc' }];
    case 'employeeName':
      return [{ employee: { name: dir } }, { id: 'asc' }];
    case 'site':
      return [{ employee: { site: { name: dir } } }, { employee: { name: 'asc' } }, { id: 'asc' }];
    case 'advanceType':
      return [{ type: dir }, { id: 'asc' }];
    case 'status':
      return [{ status: dir }, { id: 'asc' }];
    case 'originalAmount':
      return [{ totalAmount: dir }, { id: 'asc' }];
    case 'currentOutstandingBalance':
      return [{ outstandingBalance: dir }, { id: 'asc' }];
    case 'dateGiven':
      return [{ dateGiven: dir }, { id: 'asc' }];
  }
}

// --- Totals ------------------------------------------------------------------------------------

function decimalOrZero(value: Prisma.Decimal | null): Prisma.Decimal {
  return value ?? new Prisma.Decimal(0);
}

/**
 * `fullAgg` sums the raw `totalAmount`/`outstandingBalance` columns over EVERY matching row
 * (including CANCELLED ones) — required for `recoveredToDateTotal`, since a CANCELLED Advance's
 * unmasked `outstandingBalance` is exactly what keeps that figure correct (see `mapAdvanceToRow`'s
 * doc comment). `nonCancelledOutstandingAgg` sums `outstandingBalance` over the SAME matching rows
 * MINUS any CANCELLED ones — v1.0.4 Cancel Business Semantics amendment: a cancelled Advance's
 * waived remainder must not inflate "Current Outstanding Balance" totals (Part J: Cancelled
 * Advances must not contribute to Outstanding totals).
 */
function typeTotals(
  fullAgg: { _sum: { totalAmount: Prisma.Decimal | null; outstandingBalance: Prisma.Decimal | null } },
  nonCancelledOutstandingAgg: { _sum: { outstandingBalance: Prisma.Decimal | null } },
): AdvanceRecoveryReportTypeTotals {
  const totalAmount = decimalOrZero(fullAgg._sum.totalAmount);
  const outstanding = decimalOrZero(fullAgg._sum.outstandingBalance);
  const nonCancelledOutstanding = decimalOrZero(nonCancelledOutstandingAgg._sum.outstandingBalance);
  return {
    originalAmountTotal: totalAmount.toFixed(2),
    recoveredToDateTotal: totalAmount.minus(outstanding).toFixed(2),
    currentOutstandingBalanceTotal: nonCancelledOutstanding.toFixed(2),
  };
}

/**
 * Every figure here is a true DB aggregate over the complete filtered/authorized dataset (frozen
 * decision — Totals section) — never a bounded in-memory fetch-and-sum pass, and therefore no
 * `totalsComputed` flag/fallback regardless of how many Advances match.
 *
 * **Type-split totals use `AND`-composition, never a shallow spread-override** (mirrors
 * `deduction-report.service.ts`'s own documented reasoning for the identical pitfall): if the
 * caller already filtered `advanceType=LOAN`, `{ ...where, type: 'EID_ADVANCE' }` would silently
 * *replace* that filter's `type` key rather than intersect with it, incorrectly pulling in every
 * EID_ADVANCE Advance matching the other filters instead of correctly returning zero (nothing of
 * type EID_ADVANCE exists in a LOAN-only-filtered dataset). `{ AND: [where, { type: 'LOAN' }] }`
 * composes instead of overwrites, so an already-contradictory combination correctly yields zero
 * rows/zero sums rather than silently discarding the caller's own filter.
 */
async function computeAdvanceRecoveryReportTotals(
  where: Prisma.AdvanceWhereInput,
  cycle: { id: string } | null,
): Promise<AdvanceRecoveryReportTotals> {
  const loanWhere: Prisma.AdvanceWhereInput = { AND: [where, { type: 'LOAN' }] };
  const eidWhere: Prisma.AdvanceWhereInput = { AND: [where, { type: 'EID_ADVANCE' }] };
  // v1.0.4 Cancel Business Semantics amendment — see `typeTotals`'s own doc comment for why
  // "Current Outstanding Balance" totals need this separate, CANCELLED-excluding sum.
  const loanNonCancelledWhere: Prisma.AdvanceWhereInput = { AND: [loanWhere, { status: { not: 'CANCELLED' } }] };
  const eidNonCancelledWhere: Prisma.AdvanceWhereInput = { AND: [eidWhere, { status: { not: 'CANCELLED' } }] };

  const [matchingAdvanceCount, distinctEmployees, loanAgg, eidAgg, loanOutstandingAgg, eidOutstandingAgg, statusGroups] =
    await Promise.all([
      prisma.advance.count({ where }),
      prisma.advance.groupBy({ by: ['employeeId'], where }),
      prisma.advance.aggregate({ where: loanWhere, _sum: { totalAmount: true, outstandingBalance: true } }),
      prisma.advance.aggregate({ where: eidWhere, _sum: { totalAmount: true, outstandingBalance: true } }),
      prisma.advance.aggregate({ where: loanNonCancelledWhere, _sum: { outstandingBalance: true } }),
      prisma.advance.aggregate({ where: eidNonCancelledWhere, _sum: { outstandingBalance: true } }),
      prisma.advance.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);

  const statusCounts: Record<'ACTIVE' | 'RESERVED' | 'PAID_OFF' | 'CANCELLED', number> = {
    ACTIVE: 0,
    RESERVED: 0,
    PAID_OFF: 0,
    CANCELLED: 0,
  };
  for (const group of statusGroups) {
    statusCounts[group.status] = group._count._all;
  }

  let recoveredThisCycleTotal: string | null = null;
  let recoveredThisCycleTotalByType: { loan: string; eidAdvance: string } | null = null;

  if (cycle) {
    const [loanCycleAgg, eidCycleAgg] = await Promise.all([
      prisma.payrollEntry.aggregate({
        where: { cycleId: cycle.id, advance: loanWhere },
        _sum: { advanceDeduction: true },
      }),
      prisma.payrollEntry.aggregate({
        where: { cycleId: cycle.id, eidAdvance: eidWhere },
        _sum: { eidAdvanceDeduction: true },
      }),
    ]);
    const loanSum = decimalOrZero(loanCycleAgg._sum.advanceDeduction);
    const eidSum = decimalOrZero(eidCycleAgg._sum.eidAdvanceDeduction);
    recoveredThisCycleTotal = loanSum.plus(eidSum).toFixed(2);
    recoveredThisCycleTotalByType = { loan: loanSum.toFixed(2), eidAdvance: eidSum.toFixed(2) };
  }

  return {
    matchingAdvanceCount,
    employeesWithAdvanceCount: distinctEmployees.length,
    loan: typeTotals(loanAgg, loanOutstandingAgg),
    eidAdvance: typeTotals(eidAgg, eidOutstandingAgg),
    activeCount: statusCounts.ACTIVE,
    reservedCount: statusCounts.RESERVED,
    paidOffCount: statusCounts.PAID_OFF,
    cancelledCount: statusCounts.CANCELLED,
    recoveredThisCycleTotal,
    recoveredThisCycleTotalByType,
  };
}

// --- List --------------------------------------------------------------------------------------

export async function getAdvanceRecoveryReportList(
  currentUser: SessionUser,
  query: AdvanceRecoveryReportListQuery,
): Promise<AdvanceRecoveryReportListResponse> {
  const { where, cycle } = await resolveAdvanceRecoveryReportFilters(currentUser, query);

  const orderBy = buildOrderBy(query.sortBy, query.sortDir);
  const [total, advances] = await Promise.all([
    prisma.advance.count({ where }),
    prisma.advance.findMany({
      where,
      select: ROW_SELECT,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const rows = await mapAdvancesToRows(advances, cycle?.id ?? null);
  const totals = await computeAdvanceRecoveryReportTotals(where, cycle);

  return { cycle, page: query.page, pageSize: query.pageSize, total, rows, totals, generatedAt: new Date().toISOString() };
}

// --- Employee lookup -----------------------------------------------------------------------------

/**
 * Authorized against CURRENT `Employee.siteId` (frozen decision — Employee Lookup section) —
 * deliberately NOT `common/historical-payroll-employee-lookup.ts`'s own
 * `searchEmployeesByHistoricalPayroll`, which scopes by historical `PayrollEntry.siteId` and would
 * silently exclude/include the wrong employees for a report whose own authorization model
 * (`Advance.employee.siteId`) is current-site-based throughout. Built directly against `Employee`
 * (the same table/authorization shape `employees.service.ts`'s own `listEmployees` already uses),
 * rather than reusing that function as-is, since this report needs its own bounded pagination
 * (`listEmployees` returns its full unbounded match set) — the smallest change that avoids a
 * second, differently-shaped historical lookup while still fitting this report's own contract.
 */
export async function searchAdvanceRecoveryReportEmployees(
  currentUser: SessionUser,
  params: AdvanceRecoveryReportEmployeeLookupQuery,
): Promise<AdvanceRecoveryReportEmployeeLookupResponse> {
  if (params.siteId) {
    assertSiteAccess(currentUser, params.siteId);
  }
  const accessibleSiteIds = getAccessibleSiteIds(currentUser);
  const siteIdFilter = params.siteId ? [params.siteId] : accessibleSiteIds;

  const search = params.search?.trim();
  const normalizedCnicSearch = search ? normalizeCnic(search) : null;

  const where: Prisma.EmployeeWhereInput = {
    ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    ...(search && {
      OR: [
        { employeeCode: { contains: search, mode: 'insensitive' } },
        ...(normalizedCnicSearch ? [{ cnic: { contains: normalizedCnicSearch } }] : []),
        { name: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [total, employees] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      select: { id: true, employeeCode: true, name: true, siteId: true, site: { select: { name: true } } },
      orderBy: { name: 'asc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return {
    total,
    page: params.page,
    pageSize: params.pageSize,
    employees: employees.map((employee) => ({
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      name: employee.name,
      siteId: employee.siteId,
      siteName: employee.site.name,
    })),
  };
}

// --- Detail / recovery history -------------------------------------------------------------------

/** "August 2026" from a plain year/month pair — presentation-only, local to this one module (same
 * established convention as `backup-packages.service.ts`'s/`payslip.ts`'s own independently
 * re-declared `formatCycleLabel` — extracting a shared helper for a one-line formatter is exactly
 * the speculative abstraction this codebase's own convention avoids). */
function formatCycleLabel(year: number, month: number): string {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

const DETAIL_SELECT = {
  id: true,
  type: true,
  totalAmount: true,
  outstandingBalance: true,
  status: true,
  repaymentType: true,
  scheduledInstallmentAmount: true,
  dateGiven: true,
  paidOffAt: true,
  employeeId: true,
  employee: { select: { employeeCode: true, name: true, siteId: true, site: { select: { name: true } } } },
} satisfies Prisma.AdvanceSelect;

/**
 * The Checkpoint 0-approved dedicated detail surface (frozen decision — Detail/Recovery History
 * Endpoint section). Authorization mirrors `advances.service.ts`'s own `getAdvance` exactly —
 * `assertSiteAccess` (403, not 404) against `Advance.employee.siteId` — deliberately following the
 * existing Advances module's shipped posture rather than Employee Payroll History's own
 * "reveal nothing via 404" convention (a different module's own, independently frozen choice).
 */
export async function getAdvanceRecoveryReportDetail(currentUser: SessionUser, advanceId: string): Promise<AdvanceRecoveryReportDetail> {
  const advance = await prisma.advance.findUnique({ where: { id: advanceId }, select: DETAIL_SELECT });
  if (!advance) throw notFound('Advance not found');
  assertSiteAccess(currentUser, advance.employee.siteId);

  const isLoan = advance.type === 'LOAN';
  // v1.0.4 Cancel Business Semantics amendment — see `mapAdvanceToRow`'s doc comment; the same
  // display-only mask applies here, `recoveredToDate` below stays unmasked/raw.
  const displayOutstandingBalance = isOutstandingWaived(advance.status) ? new Prisma.Decimal(0) : advance.outstandingBalance;

  const [recoveryEntries, scheduleChanges] = await Promise.all([
    prisma.payrollEntry.findMany({
      where: isLoan ? { advanceId: advance.id } : { eidAdvanceId: advance.id },
      select: {
        id: true,
        cycleId: true,
        siteId: true,
        advanceDeduction: true,
        eidAdvanceDeduction: true,
        released: true,
        hold: true,
        payoutOutcome: true,
        releasedAt: true,
        cycle: { select: { year: true, month: true } },
        site: { select: { name: true } },
      },
      // Newest cycle first (frozen decision — recovery history ordering). `id` is the mandatory
      // deterministic tie-break — `(year, month)` alone is not guaranteed unique across rows since
      // this is scoped to one Advance's own linked entries, not a whole-cycle query.
      orderBy: [{ cycle: { year: 'desc' } }, { cycle: { month: 'desc' } }, { id: 'asc' }],
    }),
    prisma.advanceScheduleChange.findMany({
      where: { advanceId: advance.id },
      select: {
        id: true,
        reason: true,
        changedAt: true,
        fromPeriod: { select: { year: true, month: true } },
        toPeriod: { select: { year: true, month: true } },
        changedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ changedAt: 'desc' }, { id: 'asc' }],
    }),
  ]);

  return {
    advanceId: advance.id,
    employee: {
      id: advance.employeeId,
      employeeCode: advance.employee.employeeCode,
      name: advance.employee.name,
      siteId: advance.employee.siteId,
      siteName: advance.employee.site.name,
    },
    advanceType: advance.type,
    originalAmount: advance.totalAmount.toFixed(2),
    recoveredToDate: advance.totalAmount.minus(advance.outstandingBalance).toFixed(2),
    currentOutstandingBalance: displayOutstandingBalance.toFixed(2),
    status: advance.status,
    repaymentType: advance.repaymentType,
    scheduledInstallmentAmount: advance.scheduledInstallmentAmount?.toFixed(2) ?? null,
    dateGiven: advance.dateGiven.toISOString().slice(0, 10),
    paidOffAt: advance.paidOffAt?.toISOString() ?? null,
    // Recovery events only — never a schedule/deferral event (frozen decision — the two are always
    // kept distinct, never merged into one list).
    recoveryHistory: recoveryEntries.map((entry) => ({
      payrollEntryId: entry.id,
      cycleId: entry.cycleId,
      cycleLabel: formatCycleLabel(entry.cycle.year, entry.cycle.month),
      cycleYear: entry.cycle.year,
      cycleMonth: entry.cycle.month,
      // This entry's own HISTORICAL siteId/site name — deliberately not the employee's current
      // site, unlike every other field in this response (frozen decision).
      siteId: entry.siteId,
      siteName: entry.site.name,
      amountRecovered: (isLoan ? entry.advanceDeduction : entry.eidAdvanceDeduction).toFixed(2),
      rowStatus: derivePayrollEntryRowStatus(entry),
      releasedAt: entry.releasedAt?.toISOString() ?? null,
    })),
    scheduleChanges: scheduleChanges.map((change) => ({
      id: change.id,
      fromPeriod: { year: change.fromPeriod.year, month: change.fromPeriod.month },
      toPeriod: { year: change.toPeriod.year, month: change.toPeriod.month },
      reason: change.reason,
      changedAt: change.changedAt.toISOString(),
      changedBy: { id: change.changedBy.id, name: change.changedBy.name },
    })),
    generatedAt: new Date().toISOString(),
  };
}

// --- Export --------------------------------------------------------------------------------------

export interface AdvanceRecoveryReportExportData {
  rows: AdvanceRecoveryReportRow[];
  totalMatching: number;
}

/**
 * Every matching row, in the same deterministic order the list endpoint would apply — up to
 * `ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS`. A preflight `COUNT` runs before any row is fetched or
 * any CSV/XLSX buffer is generated — an over-limit request is rejected outright (the caller's route
 * layer maps this to the structured `AdvanceRecoveryReportExportLimitError`), never silently
 * truncated. No `page`/`pageSize` accepted at all — always the complete filtered dataset.
 */
export async function buildAdvanceRecoveryReportExportData(
  currentUser: SessionUser,
  query: AdvanceRecoveryReportExportQuery,
): Promise<AdvanceRecoveryReportExportData> {
  const { where, cycle } = await resolveAdvanceRecoveryReportFilters(currentUser, query);
  const totalMatching = await prisma.advance.count({ where });

  if (totalMatching > ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS) {
    return { rows: [], totalMatching };
  }

  const orderBy = buildOrderBy(query.sortBy, query.sortDir);
  const advances = await prisma.advance.findMany({ where, select: ROW_SELECT, orderBy });
  const rows = await mapAdvancesToRows(advances, cycle?.id ?? null);
  return { rows, totalMatching };
}

/**
 * The bulk-export flat column set — matches the approved row vocabulary exactly (frozen decision —
 * List Columns section). Deliberately excludes CNIC, every banking field, audit-actor identity, and
 * any Correction/BalanceAdjustment field. Values are read verbatim off the same
 * `AdvanceRecoveryReportRow` objects the list endpoint returns — never resummed or reformatted
 * differently — so export values are guaranteed to exactly match the on-screen API row values.
 *
 * **"As of" / current-vs-historical (frozen decision — Export section):** Outstanding Balance and
 * Recovered To Date are always CURRENT values, never "as of the selected Cycle" — this export never
 * adds an `outstandingBalanceAsOfCycle`-shaped column. XLSX makes this explicit with an "As of
 * <timestamp>" title-area line (see `exportAdvanceRecoveryReportToXlsx` below); CSV achieves the
 * same disclosure via its filename (`reports.routes.ts`'s own export route), not by inserting an
 * extra non-data row into the CSV body — doing so would break the CSV's machine-readable row/header
 * parity with this exact same header list, which the caller may parse programmatically.
 */
export const ADVANCE_RECOVERY_REPORT_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Project Site',
  'Advance Type',
  'Status',
  'Repayment Type',
  'Date Given',
  'Original Amount',
  'Recovered To Date',
  'Current Outstanding Balance',
  'Recovered This Cycle',
] as const;

function buildExportRow(row: AdvanceRecoveryReportRow): string[] {
  return [
    row.employeeCode ?? '—',
    row.employeeName,
    row.siteName,
    row.advanceType,
    row.status,
    row.repaymentType,
    row.dateGiven,
    row.originalAmount,
    row.recoveredToDate,
    row.currentOutstandingBalance,
    row.recoveredThisCycle ?? '—',
  ];
}

export interface AdvanceRecoveryReportExportResult {
  buffer: Buffer;
  rowCount: number;
}

/**
 * CSV export — calls `buildAdvanceRecoveryReportExportData` exactly once (the same filter/sort/row-
 * shaping every other entry point shares), reuses the codebase's one mandatory CSV-serialization
 * entry point (`stringifyCsvSafe`). The caller (`reports.routes.ts`) is responsible for checking
 * `totalMatching > ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS` *before* calling this.
 */
export function exportAdvanceRecoveryReportToCsv(rows: AdvanceRecoveryReportRow[]): AdvanceRecoveryReportExportResult {
  const csv = stringifyCsvSafe([ADVANCE_RECOVERY_REPORT_EXPORT_HEADERS as unknown as string[], ...rows.map(buildExportRow)]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: rows.length };
}

/**
 * XLSX export — same "one shared row-shaping function, no independent calculation path" contract as
 * the CSV export above. Uses this codebase's existing export style vocabulary only (bold title/
 * header rows via ExcelJS, content-driven column widths via the shared `excelColumnWidth`) plus an
 * explicit "As of <timestamp>" subtitle row (frozen decision — Export section) so a selected Cycle
 * filter can never be misread as implying the outstanding/recovered figures are "as of" that cycle.
 */
export async function exportAdvanceRecoveryReportToXlsx(rows: AdvanceRecoveryReportRow[]): Promise<AdvanceRecoveryReportExportResult> {
  const exportRows = rows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Advance Recovery Report');

  worksheet.addRow(['Advance Recovery Report']).font = { bold: true, size: 13 };
  worksheet.addRow([`As of ${new Date().toISOString()} — Outstanding Balance and Recovered To Date are current, live figures, not as of any selected Payroll Cycle`]).font = {
    italic: true,
    size: 9,
  };
  worksheet.addRow([]);
  worksheet.addRow(ADVANCE_RECOVERY_REPORT_EXPORT_HEADERS as unknown as string[]).font = { bold: true };
  for (const row of exportRows) worksheet.addRow(row);

  ADVANCE_RECOVERY_REPORT_EXPORT_HEADERS.forEach((header, index) => {
    const columnValues = exportRows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: rows.length };
}
