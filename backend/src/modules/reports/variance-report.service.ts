import ExcelJS from 'exceljs';
import { Decimal } from 'decimal.js';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import {
  calcNet,
  type CalcNetResult,
  VARIANCE_REPORT_BOUNDED_SORT_FIELDS,
  VARIANCE_REPORT_EXPORT_MAX_ROWS,
  type VarianceReportDirection,
  type VarianceReportExportQuery,
  type VarianceReportListQuery,
  type VarianceReportListResponse,
  type VarianceReportPopulationStatus,
  type VarianceReportRow,
  type VarianceReportSortDirection,
  type VarianceReportSortField,
  type VarianceReportTotals,
  type VarianceReportUnitRef,
  type VarianceReportEmployeeLookupQuery,
  type VarianceReportEmployeeSearchResponse,
} from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { stringifyCsvSafe } from '../../common/import-export';
import { excelColumnWidth } from '../../common/excel-utils';
import { assertSiteAccess, getAccessibleSiteIds } from '../../common/authz-policy';
import { searchEmployeesByHistoricalPayroll } from '../../common/historical-payroll-employee-lookup';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';

/**
 * Phase 7 Reports, Variance / Month-on-Month Report Checkpoint 1A (approved Checkpoint 0
 * architecture review; frozen decisions carried over verbatim from the authorizing instruction —
 * see `shared/src/schemas/variance-report.ts`'s own doc comment for the full record).
 *
 * **Why this report cannot reuse every sibling report's own query shape.** Every other report in
 * this module is a single Prisma query over `PayrollEntry` (optionally joined/`select`ed), so
 * `ORDER BY`/`WHERE`/`skip`/`take` all push straight into one SQL statement. Variance Report's own
 * grain — one row per Employee, pairing that employee's `PayrollEntry` across two *independent*
 * Payroll Cycles — has no single-relation SQL equivalent: `PayrollEntry` has no self-referencing
 * "the same employee's row in a different cycle" column, and `calcNet` (needed to know *which*
 * cycle even has the higher net salary) cannot run inside SQL. So this service fetches each
 * cycle's own accessible candidate rows independently (Strategy D, Checkpoint 0 §23 — two
 * indexed, `cycleId`-scoped queries, exactly the same bounded per-cycle shape every sibling
 * report's own list query already proves safe), pairs them in memory by `employeeId`
 * (`PayrollEntry`'s own `@@unique([cycleId, employeeId])` guarantees at most one row per employee
 * per cycle on each side, so the pairing is never ambiguous), and does every filter/sort/paginate/
 * totals step against that already-fully-materialized paired set. There is no cheaper query shape
 * that stays correct — `calcNet`/population classification/the two-sided site filter (below) all
 * require every accessible candidate row on both sides to be loaded regardless of which page or
 * sort is requested; see `variance-report-performance.test.ts` for the measured cost of this at
 * design-floor scale.
 *
 * **Two-sided Site authorization (the central security invariant of this report — Checkpoint 1A
 * §10).** `PayrollEntry.siteId` is authorized independently, per side, using the caller's full
 * accessible-site set (`getAccessibleSiteIds`) — never `Employee.siteId`. `fetchSideEntries` below
 * only ever fetches *data-bearing* rows already inside the caller's accessible scope, so no field
 * of an inaccessible row (its site, its net salary, anything) is ever loaded into a candidate row.
 * That alone is not sufficient, though: a genuinely `CONTINUED` employee whose Comparison-side
 * entry sits at an inaccessible Site would otherwise be built from `currentEntries` alone and
 * misclassified as `NEW` (the "only current exists" shape looks identical to a real new hire once
 * the inaccessible side has simply never been fetched) — exactly the failure mode this section
 * exists to prevent. `fetchExistingEmployeeIds` closes this: a second, deliberately
 * site-*unfiltered* query per side, returning nothing but the bare set of `employeeId`s with *any*
 * entry in that cycle — never a site, an amount, or any other field. `buildVarianceCandidateRows`
 * below cross-checks every candidate pair against both existence sets and suppresses the row
 * outright whenever a side that *globally* exists was not also fetched as data (i.e. exists but is
 * inaccessible) — so a `CONTINUED` employee with one inaccessible side is visible only when *both*
 * sides are individually accessible, and is otherwise completely absent, per the frozen rule. This
 * makes it structurally impossible for the resulting output to expose a partial row, a redacted
 * side, or a variance amount computed against a value the caller couldn't otherwise see: either a
 * row is built entirely from accessible data with every globally-existing side present, or it is
 * dropped before it is ever returned — never a `CONTINUED` row with one side silently blank, and
 * never a `NEW`/`DEPARTED` row that is secretly `CONTINUED` from a fuller, inaccessible vantage
 * point.
 *
 * **The Site *filter* (Checkpoint 1A §12/§13, not to be confused with the authorization scope
 * above) matches a row when *either* existing side belongs to a selected Site** — this is why the
 * Site filter is applied *after* pairing, over the already-fully-authorized candidate set, rather
 * than pushed into `fetchSideEntries`'s own `WHERE`: pushing it into the per-side query would
 * silently narrow to AND semantics (a transferred employee visible only when *both* their old and
 * new Site were selected) or one-sided semantics, either of which would make a genuine Site
 * Transfer undiscoverable by filtering on just the old or just the new Site. The Unit filter (also
 * single-Site-scoped, Checkpoint 1A §13) follows the identical "matches on either existing side"
 * rule, for the identical reason.
 */

// --- Filter resolution -------------------------------------------------------------------------

interface ResolvedVarianceReportFilters {
  currentCycle: { id: string; year: number; month: number; status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' };
  comparisonCycle: { id: string; year: number; month: number; status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' };
  /** The caller's full accessible-site scope (`undefined` = unrestricted global authority) — used
   * for the per-side `WHERE` (authorization), never narrowed by `siteFilter` below. */
  accessibleSiteIds: string[] | undefined;
  /** The explicit, caller-selected Site filter (already access-validated) — applied post-pairing
   * as an either-side match, never pushed into the per-side fetch `WHERE`. `undefined` when no
   * explicit filter was given (no Site-filter narrowing at all, beyond ordinary authorization). */
  siteFilter: string[] | undefined;
  /** Validated (exists, accessible, belongs to the one selected Site when `siteFilter` is given) —
   * applied post-pairing as an either-side match, for the identical reason as `siteFilter`. */
  unitFilter: string | undefined;
  employeeId: string | undefined;
}

async function resolveVarianceReportFilters(
  currentUser: SessionUser,
  query: Pick<VarianceReportListQuery, 'currentCycleId' | 'comparisonCycleId' | 'siteIds' | 'unitId' | 'employeeId'>,
): Promise<ResolvedVarianceReportFilters> {
  const [currentCycle, comparisonCycle] = await Promise.all([
    getPayrollCycle(query.currentCycleId),
    getPayrollCycle(query.comparisonCycleId),
  ]);

  const accessibleSiteIds = getAccessibleSiteIds(currentUser);

  let siteFilter: string[] | undefined;
  if (query.siteIds && query.siteIds.length > 0) {
    for (const siteId of query.siteIds) assertSiteAccess(currentUser, siteId);
    siteFilter = query.siteIds;
  }

  let unitFilter: string | undefined;
  if (query.unitId) {
    if (!siteFilter || siteFilter.length !== 1) {
      throw badRequest('The Unit filter requires exactly one Site to be selected via siteIds');
    }
    const unit = await prisma.projectUnit.findUnique({ where: { id: query.unitId }, select: { siteId: true } });
    if (!unit) throw notFound('unitId does not reference an existing Project Unit');
    assertSiteAccess(currentUser, unit.siteId);
    if (!siteFilter.includes(unit.siteId)) {
      throw badRequest('unitId does not belong to the site named in the siteIds filter');
    }
    unitFilter = query.unitId;
  }

  return {
    currentCycle: { id: currentCycle.id, year: currentCycle.year, month: currentCycle.month, status: currentCycle.status },
    comparisonCycle: { id: comparisonCycle.id, year: comparisonCycle.year, month: comparisonCycle.month, status: comparisonCycle.status },
    accessibleSiteIds,
    siteFilter,
    unitFilter,
    employeeId: query.employeeId,
  };
}

// --- Row select/calc --------------------------------------------------------------------------

/** Every column `calcNet` needs to compute the entry's true, complete `netSalary` (including any
 * already-materialized correction settlement reserved into this cycle's own entry — the same
 * complete formula Employee Payroll History's own `netSalary` uses, never Deduction Report's
 * deliberately deduction-only subset), plus the identity/site/Unit columns this report's own row
 * needs. */
const ROW_SELECT = {
  id: true,
  siteId: true,
  employeeId: true,
  employeeNameSnapshot: true,
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
  site: { select: { name: true } },
  employee: { select: { employeeCode: true, name: true } },
  workLines: {
    // Lowest `sortOrder` (`id` tie-break) is this entry's primary work line, matching every
    // sibling report's own "primary Unit" convention exactly (`docs/architecture/database/
    // payroll-entry.md §12`).
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
 * input contract — the exact same canonical `calcNet` every sibling report calls (never a second
 * net-salary formula, and never a second SQL-expressed version of it). */
function calcEntryRow(entry: RowEntry): CalcNetResult {
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

/**
 * One side's candidate fetch — `cycleId` plus the caller's *full* accessible-site scope
 * (authorization, never narrowed by the caller's own Site filter) and, when given, an exact
 * `employeeId` match (safe to push directly — the same literal id is being matched on both sides
 * by construction, so this never needs either-side-OR semantics the way Site/Unit do).
 */
async function fetchSideEntries(
  cycleId: string,
  accessibleSiteIds: string[] | undefined,
  employeeId: string | undefined,
): Promise<RowEntry[]> {
  const where: Prisma.PayrollEntryWhereInput = {
    cycleId,
    ...(accessibleSiteIds && { siteId: { in: accessibleSiteIds } }),
    ...(employeeId && { employeeId }),
  };
  return prisma.payrollEntry.findMany({ where, select: ROW_SELECT });
}

/**
 * The existence-only counterpart to `fetchSideEntries` — deliberately **unfiltered by site**
 * (only `cycleId` and, when given, the exact `employeeId`), returning nothing but the bare set of
 * `employeeId`s that have *any* `PayrollEntry` in this cycle, accessible or not. This never leaks
 * a site, an amount, or any other field to the caller — it is consumed purely internally, by
 * `buildVarianceCandidateRows`'s own suppression check below, to distinguish "no entry exists on
 * the other side at all" (a genuine `NEW`/`DEPARTED`) from "an entry exists on the other side but
 * this caller cannot see it" (Checkpoint 1A §10 — the row must be completely absent, never shown
 * with a population status derived only from what happened to be visible).
 */
async function fetchExistingEmployeeIds(cycleId: string, employeeId: string | undefined): Promise<Set<string>> {
  const where: Prisma.PayrollEntryWhereInput = { cycleId, ...(employeeId && { employeeId }) };
  const rows = await prisma.payrollEntry.findMany({ where, select: { employeeId: true } });
  return new Set(rows.map((row) => row.employeeId));
}

// --- Pairing -------------------------------------------------------------------------------------

interface SidePair {
  comparison?: RowEntry;
  current?: RowEntry;
}

/** `PayrollEntry`'s own `@@unique([cycleId, employeeId])` guarantees at most one row per employee
 * per cycle in each of `comparisonEntries`/`currentEntries`, so this `Map` build can never collide
 * two rows for the same employee on the same side (Checkpoint 1A §4). */
function buildPairs(comparisonEntries: RowEntry[], currentEntries: RowEntry[]): Map<string, SidePair> {
  const pairs = new Map<string, SidePair>();
  for (const entry of comparisonEntries) {
    pairs.set(entry.employeeId, { comparison: entry });
  }
  for (const entry of currentEntries) {
    const existing = pairs.get(entry.employeeId);
    if (existing) existing.current = entry;
    else pairs.set(entry.employeeId, { current: entry });
  }
  return pairs;
}

function classifyPopulation(pair: SidePair): VarianceReportPopulationStatus {
  if (pair.comparison && pair.current) return 'CONTINUED';
  if (pair.current) return 'NEW';
  return 'DEPARTED';
}

function toUnitRef(unit: { id: string; name: string; code: string | null }): VarianceReportUnitRef {
  return { id: unit.id, name: unit.name, code: unit.code };
}

function primaryUnitRef(entry: RowEntry | undefined): VarianceReportUnitRef | null {
  const line = entry?.workLines[0];
  return line ? toUnitRef(line.unit) : null;
}

/**
 * Every matching row's own entry ids, batched into as few `groupBy` calls as safely possible —
 * never a per-row/per-side lookup, mirroring Deduction Report's/Employee Payroll History's own
 * `fetchCorrectionCounts` pattern (Checkpoint 1A §8). **Unlike every sibling report's own single
 * candidate set (bounded to one cycle, ≤ `*_EXPORT_MAX_ROWS`), this report's own `entryIds` spans
 * *two* cycles' worth of candidates (up to ~2 × the per-cycle ceiling) — large enough, at the
 * boundary/performance test's own real 20,001-employee-per-cycle scale, to exceed PostgreSQL's
 * hard 32,767-bind-parameter-per-statement limit in a single `IN (...)` clause** (a real failure
 * this checkpoint's own boundary test caught: `too many bind variables in prepared statement,
 * expected maximum of 32767, received 40003`). `CORRECTION_LOOKUP_CHUNK_SIZE` keeps every chunk
 * comfortably under that hard limit; the number of `groupBy` calls this issues is therefore
 * `⌈entryIds.length / CORRECTION_LOOKUP_CHUNK_SIZE⌉` — still a small, bounded constant at
 * design-floor scale (2 calls at the 20,001×2 boundary), never proportional to the number of
 * *rows returned to the client*, and never one call per row.
 */
const CORRECTION_LOOKUP_CHUNK_SIZE = 5_000;

async function fetchCorrectedEntryIds(entryIds: string[]): Promise<Set<string>> {
  const result = new Set<string>();
  for (let start = 0; start < entryIds.length; start += CORRECTION_LOOKUP_CHUNK_SIZE) {
    const chunk = entryIds.slice(start, start + CORRECTION_LOOKUP_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const grouped = await prisma.correction.groupBy({ by: ['payrollEntryId'], where: { payrollEntryId: { in: chunk } } });
    for (const row of grouped) result.add(row.payrollEntryId);
  }
  return result;
}

/**
 * Builds one candidate row from a pair. `direction`/`varianceAmount`/`variancePercent` are
 * populated *only* for `CONTINUED` rows (Checkpoint 1A §6) — a `NEW`/`DEPARTED` row is a
 * population change, never represented as a salary change from/to zero.
 *
 * `variancePercent` is `null` whenever `comparisonNet` is exactly `0` — never a divide-by-zero,
 * never a fabricated percentage (Checkpoint 1A §7).
 */
function buildCandidateRow(employeeId: string, pair: SidePair, correctedEntryIds: Set<string>): VarianceReportRow {
  const populationStatus = classifyPopulation(pair);
  const identitySource = pair.current ?? pair.comparison!;
  const employeeCode = identitySource.employee.employeeCode;
  const employeeName = identitySource.employeeNameSnapshot ?? identitySource.employee.name;

  const comparisonCalc = pair.comparison ? calcEntryRow(pair.comparison) : null;
  const currentCalc = pair.current ? calcEntryRow(pair.current) : null;

  let direction: VarianceReportDirection | null = null;
  let varianceAmount: string | null = null;
  let variancePercent: string | null = null;

  if (populationStatus === 'CONTINUED' && comparisonCalc && currentCalc) {
    const comparisonDecimal = new Decimal(comparisonCalc.netSalary);
    const currentDecimal = new Decimal(currentCalc.netSalary);
    const diff = currentDecimal.minus(comparisonDecimal);
    varianceAmount = diff.toFixed(2);
    direction = diff.isZero() ? 'UNCHANGED' : diff.isPositive() ? 'INCREASED' : 'DECREASED';
    variancePercent = comparisonDecimal.isZero() ? null : diff.dividedBy(comparisonDecimal).times(100).toFixed(2);
  }

  const comparisonSiteId = pair.comparison?.siteId ?? null;
  const currentSiteId = pair.current?.siteId ?? null;
  const siteTransfer =
    populationStatus === 'CONTINUED' && comparisonSiteId !== null && currentSiteId !== null && comparisonSiteId !== currentSiteId;

  const comparisonUnit = primaryUnitRef(pair.comparison);
  const currentUnit = primaryUnitRef(pair.current);
  const unitChange =
    populationStatus === 'CONTINUED' && comparisonUnit !== null && currentUnit !== null && comparisonUnit.id !== currentUnit.id;

  return {
    employeeId,
    employeeCode,
    employeeName,
    populationStatus,
    direction,
    comparisonPayrollEntryId: pair.comparison?.id ?? null,
    currentPayrollEntryId: pair.current?.id ?? null,
    comparisonSiteId,
    comparisonSiteName: pair.comparison?.site.name ?? null,
    currentSiteId,
    currentSiteName: pair.current?.site.name ?? null,
    siteTransfer,
    comparisonUnit,
    currentUnit,
    unitChange,
    comparisonNet: comparisonCalc?.netSalary ?? null,
    currentNet: currentCalc?.netSalary ?? null,
    varianceAmount,
    variancePercent,
    hasComparisonCorrection: pair.comparison ? correctedEntryIds.has(pair.comparison.id) : false,
    hasCurrentCorrection: pair.current ? correctedEntryIds.has(pair.current.id) : false,
  };
}

/**
 * The one canonical build step every list/totals/export entry point shares (Checkpoint 1A §15) —
 * fetches both sides (already authorized, Checkpoint 1A §10), pairs, batches correction existence,
 * builds every candidate row, then applies the Site/Unit either-side filters plus
 * Direction/`hasCorrection` (Checkpoint 1A §12/§13). Returns the complete, filtered, authorized
 * candidate set — sorting/pagination/totals are all separate steps over this same array, never a
 * second independently-filtered fetch.
 */
async function buildVarianceCandidateRows(
  currentUser: SessionUser,
  query: Pick<VarianceReportListQuery, 'currentCycleId' | 'comparisonCycleId' | 'siteIds' | 'unitId' | 'employeeId' | 'direction' | 'hasCorrection'>,
): Promise<{ rows: VarianceReportRow[]; currentCycle: ResolvedVarianceReportFilters['currentCycle']; comparisonCycle: ResolvedVarianceReportFilters['comparisonCycle'] }> {
  const { currentCycle, comparisonCycle, accessibleSiteIds, siteFilter, unitFilter, employeeId } = await resolveVarianceReportFilters(
    currentUser,
    query,
  );

  const [comparisonEntries, currentEntries, comparisonExistsIds, currentExistsIds] = await Promise.all([
    fetchSideEntries(comparisonCycle.id, accessibleSiteIds, employeeId),
    fetchSideEntries(currentCycle.id, accessibleSiteIds, employeeId),
    fetchExistingEmployeeIds(comparisonCycle.id, employeeId),
    fetchExistingEmployeeIds(currentCycle.id, employeeId),
  ]);

  const pairs = buildPairs(comparisonEntries, currentEntries);
  const entryIds = [...comparisonEntries, ...currentEntries].map((entry) => entry.id);
  const correctedEntryIds = await fetchCorrectedEntryIds(entryIds);

  let rows: VarianceReportRow[] = [];
  for (const [employeeIdKey, pair] of pairs) {
    // Checkpoint 1A §10, the central security invariant: every side that *globally* has an entry
    // must also be individually accessible, or this employee is suppressed entirely — never shown
    // with a population status/variance derived only from whichever side happened to be visible.
    // `pairs` (built from `comparisonEntries`/`currentEntries`, both already accessible-only) can
    // only ever under-represent reality relative to `comparisonExistsIds`/`currentExistsIds`
    // (never over-represent it), so this check only ever removes rows, never adds one.
    const hiddenComparisonSide = comparisonExistsIds.has(employeeIdKey) && !pair.comparison;
    const hiddenCurrentSide = currentExistsIds.has(employeeIdKey) && !pair.current;
    if (hiddenComparisonSide || hiddenCurrentSide) continue;

    rows.push(buildCandidateRow(employeeIdKey, pair, correctedEntryIds));
  }

  if (siteFilter) {
    const siteSet = new Set(siteFilter);
    rows = rows.filter(
      (row) => (row.comparisonSiteId !== null && siteSet.has(row.comparisonSiteId)) || (row.currentSiteId !== null && siteSet.has(row.currentSiteId)),
    );
  }
  if (unitFilter) {
    rows = rows.filter((row) => row.comparisonUnit?.id === unitFilter || row.currentUnit?.id === unitFilter);
  }
  if (query.direction) {
    rows = rows.filter((row) => row.direction === query.direction);
  }
  if (query.hasCorrection === true) {
    rows = rows.filter((row) => row.hasComparisonCorrection || row.hasCurrentCorrection);
  }
  if (query.hasCorrection === false) {
    rows = rows.filter((row) => !row.hasComparisonCorrection && !row.hasCurrentCorrection);
  }

  return { rows, currentCycle, comparisonCycle };
}

// --- Sorting -------------------------------------------------------------------------------------

/** Every branch ends with an `employeeId` tie-break — deterministic even for two rows sharing the
 * same primary sort value (Checkpoint 1A §18). All of this report's sorting happens in application
 * memory over the already fully-materialized candidate array (see this file's own top-of-module
 * doc comment for why no sibling report's Prisma-`orderBy` pattern applies here). */
function compareRows(a: VarianceReportRow, b: VarianceReportRow, sortBy: VarianceReportSortField, dir: VarianceReportSortDirection): number {
  const mul = dir === 'asc' ? 1 : -1;
  let primary = 0;
  switch (sortBy) {
    case 'employeeCode':
      primary = (a.employeeCode ?? '').localeCompare(b.employeeCode ?? '');
      break;
    case 'employeeName':
      primary = a.employeeName.localeCompare(b.employeeName);
      break;
    case 'comparisonSite':
      primary = (a.comparisonSiteName ?? '').localeCompare(b.comparisonSiteName ?? '');
      break;
    case 'currentSite':
      primary = (a.currentSiteName ?? '').localeCompare(b.currentSiteName ?? '');
      break;
    case 'populationStatus':
      primary = a.populationStatus.localeCompare(b.populationStatus);
      break;
    case 'comparisonNet':
      primary = new Decimal(a.comparisonNet ?? 0).comparedTo(new Decimal(b.comparisonNet ?? 0));
      break;
    case 'currentNet':
      primary = new Decimal(a.currentNet ?? 0).comparedTo(new Decimal(b.currentNet ?? 0));
      break;
    case 'varianceAmount':
      primary = new Decimal(a.varianceAmount ?? 0).comparedTo(new Decimal(b.varianceAmount ?? 0));
      break;
  }
  if (primary !== 0) return primary * mul;
  return a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0;
}

const BOUNDED_SORT_FIELD_SET: ReadonlySet<string> = new Set(VARIANCE_REPORT_BOUNDED_SORT_FIELDS);

// --- Totals ------------------------------------------------------------------------------------

/**
 * See `VarianceReportTotals`'s own doc comment (`shared/src/schemas/variance-report.ts`) for the
 * full reasoning: population/direction/transfer/correction counts are always exact — they fall out
 * of the same in-memory pass this report's own pairing already requires regardless of scale — but
 * the four monetary fields (`comparisonTotalNet`/`currentTotalNet`/`aggregateVarianceAmount`/
 * `aggregateVariancePercent`) are gated by `VARIANCE_REPORT_EXPORT_MAX_ROWS`, matching every
 * sibling report's own `totalsComputed` contract, so this report's response shape stays consistent
 * with the rest of the module even though the *mechanism* differs.
 *
 * `aggregateVariancePercent` is derived from the two aggregate totals themselves, never from
 * averaging/summing individual rows' own `variancePercent` (Checkpoint 1A §20 — the brief's own
 * explicit warning against exactly that mistake).
 */
function computeVarianceReportTotals(rows: VarianceReportRow[]): VarianceReportTotals {
  const matchingCount = rows.length;

  let newEmployeeCount = 0;
  let departedEmployeeCount = 0;
  let continuedEmployeeCount = 0;
  let increasedCount = 0;
  let decreasedCount = 0;
  let unchangedCount = 0;
  let siteTransferCount = 0;
  let correctedEntryCount = 0;

  for (const row of rows) {
    if (row.populationStatus === 'NEW') newEmployeeCount += 1;
    else if (row.populationStatus === 'DEPARTED') departedEmployeeCount += 1;
    else continuedEmployeeCount += 1;

    if (row.direction === 'INCREASED') increasedCount += 1;
    else if (row.direction === 'DECREASED') decreasedCount += 1;
    else if (row.direction === 'UNCHANGED') unchangedCount += 1;

    if (row.siteTransfer) siteTransferCount += 1;
    if (row.hasComparisonCorrection || row.hasCurrentCorrection) correctedEntryCount += 1;
  }

  const base: Omit<VarianceReportTotals, 'comparisonTotalNet' | 'currentTotalNet' | 'aggregateVarianceAmount' | 'aggregateVariancePercent' | 'totalsComputed'> = {
    matchingCount,
    newEmployeeCount,
    departedEmployeeCount,
    continuedEmployeeCount,
    increasedCount,
    decreasedCount,
    unchangedCount,
    siteTransferCount,
    correctedEntryCount,
  };

  if (matchingCount > VARIANCE_REPORT_EXPORT_MAX_ROWS) {
    return {
      ...base,
      comparisonTotalNet: null,
      currentTotalNet: null,
      aggregateVarianceAmount: null,
      aggregateVariancePercent: null,
      totalsComputed: false,
    };
  }

  let comparisonTotal = new Decimal(0);
  let currentTotal = new Decimal(0);
  for (const row of rows) {
    if (row.comparisonNet !== null) comparisonTotal = comparisonTotal.plus(row.comparisonNet);
    if (row.currentNet !== null) currentTotal = currentTotal.plus(row.currentNet);
  }
  const aggregateVarianceDecimal = currentTotal.minus(comparisonTotal);
  const aggregateVariancePercent = comparisonTotal.isZero() ? null : aggregateVarianceDecimal.dividedBy(comparisonTotal).times(100).toFixed(2);

  return {
    ...base,
    comparisonTotalNet: comparisonTotal.toFixed(2),
    currentTotalNet: currentTotal.toFixed(2),
    aggregateVarianceAmount: aggregateVarianceDecimal.toFixed(2),
    aggregateVariancePercent,
    totalsComputed: true,
  };
}

// --- List --------------------------------------------------------------------------------------

export async function getVarianceReportList(currentUser: SessionUser, query: VarianceReportListQuery): Promise<VarianceReportListResponse> {
  const { rows, currentCycle, comparisonCycle } = await buildVarianceCandidateRows(currentUser, query);

  if (BOUNDED_SORT_FIELD_SET.has(query.sortBy) && rows.length > VARIANCE_REPORT_EXPORT_MAX_ROWS) {
    throw badRequest(
      `Sorting by ${query.sortBy} requires narrowing your filters to ${VARIANCE_REPORT_EXPORT_MAX_ROWS} or fewer matching rows (matched ${rows.length}). ${query.sortBy} is not a stored column and cannot be sorted at the database level without duplicating the canonical calcNet formula — narrow your filters, or sort by a different column.`,
    );
  }

  const sorted = [...rows].sort((a, b) => compareRows(a, b, query.sortBy, query.sortDir));
  const totals = computeVarianceReportTotals(rows);

  const start = (query.page - 1) * query.pageSize;
  const pageRows = sorted.slice(start, start + query.pageSize);

  return {
    currentCycle,
    comparisonCycle,
    page: query.page,
    pageSize: query.pageSize,
    total: rows.length,
    rows: pageRows,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

// --- Employee lookup -----------------------------------------------------------------------------

/** Reuses the exact same shared historical-payroll employee lookup every sibling report's own
 * discovery endpoint already calls (Checkpoint 1A §17) — never a new org-wide employee directory,
 * and never a lookup that bypasses site authorization (the shared function itself scopes by
 * `getAccessibleSiteIds`/`assertSiteAccess` before touching `Employee`). */
export async function searchVarianceReportEmployees(
  currentUser: SessionUser,
  params: VarianceReportEmployeeLookupQuery,
): Promise<VarianceReportEmployeeSearchResponse> {
  return searchEmployeesByHistoricalPayroll(currentUser, params);
}

// --- Export --------------------------------------------------------------------------------------

export interface VarianceReportExportData {
  rows: VarianceReportRow[];
  totalMatching: number;
}

/**
 * Every matching row, in the same deterministic order the list endpoint would apply — up to
 * `VARIANCE_REPORT_EXPORT_MAX_ROWS`. A preflight count runs before any CSV/XLSX buffer is
 * generated (the caller's route layer maps an over-limit request to the structured
 * `VarianceReportExportLimitError`), never silently truncated. No `page`/`pageSize` accepted at
 * all — always the complete filtered dataset.
 */
export async function buildVarianceReportExportData(currentUser: SessionUser, query: VarianceReportExportQuery): Promise<VarianceReportExportData> {
  const { rows } = await buildVarianceCandidateRows(currentUser, query);

  if (rows.length > VARIANCE_REPORT_EXPORT_MAX_ROWS) {
    return { rows: [], totalMatching: rows.length };
  }

  const sorted = [...rows].sort((a, b) => compareRows(a, b, query.sortBy, query.sortDir));
  return { rows: sorted, totalMatching: rows.length };
}

const POPULATION_STATUS_LABEL: Record<VarianceReportPopulationStatus, string> = {
  NEW: 'New',
  DEPARTED: 'Departed',
  CONTINUED: 'Continued',
};

/**
 * The bulk-export flat column set (Checkpoint 1A §22) — no CNIC, no banking, no correction
 * reasons/actors, no release-actor identity. Values are read verbatim off the same
 * `VarianceReportRow` objects the list endpoint returns — never resummed or reformatted
 * differently — so export values are guaranteed to exactly match the on-screen API row values
 * (Principle 6).
 */
export const VARIANCE_REPORT_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Population Status',
  'Comparison Site',
  'Current Site',
  'Previous Net',
  'Current Net',
  'Variance Amount',
  'Variance %',
  'Site Transfer',
  'Unit Change',
  'Has Comparison Correction',
  'Has Current Correction',
] as const;

function buildExportRow(row: VarianceReportRow): string[] {
  return [
    row.employeeCode ?? '—',
    row.employeeName,
    POPULATION_STATUS_LABEL[row.populationStatus],
    row.comparisonSiteName ?? '—',
    row.currentSiteName ?? '—',
    row.comparisonNet ?? '—',
    row.currentNet ?? '—',
    row.varianceAmount ?? '—',
    row.variancePercent ?? '—',
    row.siteTransfer ? 'Yes' : 'No',
    row.unitChange ? 'Yes' : 'No',
    row.hasComparisonCorrection ? 'Yes' : 'No',
    row.hasCurrentCorrection ? 'Yes' : 'No',
  ];
}

export interface VarianceReportExportResult {
  buffer: Buffer;
  rowCount: number;
}

export function exportVarianceReportToCsv(rows: VarianceReportRow[]): VarianceReportExportResult {
  const csv = stringifyCsvSafe([VARIANCE_REPORT_EXPORT_HEADERS as unknown as string[], ...rows.map(buildExportRow)]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: rows.length };
}

export async function exportVarianceReportToXlsx(rows: VarianceReportRow[]): Promise<VarianceReportExportResult> {
  const exportRows = rows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Variance Report');

  worksheet.addRow(['Variance / Month-on-Month Report']).font = { bold: true, size: 13 };
  worksheet.addRow([]);
  worksheet.addRow(VARIANCE_REPORT_EXPORT_HEADERS as unknown as string[]).font = { bold: true };
  for (const row of exportRows) worksheet.addRow(row);

  VARIANCE_REPORT_EXPORT_HEADERS.forEach((header, index) => {
    const columnValues = exportRows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: rows.length };
}
