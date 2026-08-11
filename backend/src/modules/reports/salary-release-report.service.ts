import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import {
  calcNet,
  sumMoney,
  type CalcNetResult,
  SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS,
  type SalaryReleaseReportExportQuery,
  type SalaryReleaseReportListQuery,
  type SalaryReleaseReportListResponse,
  type SalaryReleaseReportRow,
  type SalaryReleaseReportSortDirection,
  type SalaryReleaseReportSortField,
  type SalaryReleaseReportTotals,
  type SalaryReleaseReportUnitRef,
} from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { stringifyCsvSafe } from '../../common/import-export';
import { excelColumnWidth } from '../../common/excel-utils';
import { assertSiteAccess, getAccessibleSiteIds } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { derivePayrollEntryRowStatus, payrollEntryRowStatusWhereClause } from './payroll-entry-row-status';

/**
 * Phase 7 Reports, Salary Release Report Checkpoint 1A (approved Checkpoint 0 architecture review;
 * frozen decisions carried over verbatim from the authorizing instruction).
 *
 * **Report scope (frozen):** a single-cycle operational release-reconciliation report — which
 * employees were released this Cycle, which remain Pending/Held, which resolved No Pay Due/Recovery
 * Due, what the original released amount was, and which rows carry correction/balance-salary
 * context. One row = one `PayrollEntry`. `cycleId` is required and singular, mirroring Project Site
 * Payroll Report's/Deduction Report's/Overtime Report's own "one cycle at a time" shape. Never a
 * cross-cycle employee history (Employee Payroll History's own job), never a Corrections ledger.
 *
 * **Permission (frozen) — the first Reports-module report on an OR gate:** `reports:view` OR
 * `payroll:view` (`salary-release-report.routes.ts` wiring in `reports.routes.ts`) — Finance holds
 * `payroll:view`/`payroll:release` but not `reports:view`; Payroll Staff holds `reports:view` but not
 * `payroll:view`. `payroll:release` alone does not imply access. Site authorization reuses
 * `assertSiteAccess`/`getAccessibleSiteIds` exactly as every other report in this module does;
 * historical authorization is always `PayrollEntry.siteId`, never `Employee.siteId`.
 *
 * **Release domain semantics respected, never reinterpreted:** release occurs through
 * `PayrollUnitRelease` at Project Unit granularity; a `PayrollEntry` becomes `released = true` only
 * once every Project Unit it touches has released. Held entries are excluded from the ordinary
 * release sweep entirely. `NO_PAY_DUE`/`RECOVERY_DUE` are real payout outcomes the same sweep
 * resolves. Release is irreversible; `PayrollUnitRelease` is append-only. This report is read-only —
 * it never mutates or reinterprets release mechanics, and does not build against the deferred,
 * unimplemented `PayrollUnitReadiness` ("Ready for Release") concept.
 *
 * **Original Released Amount (frozen, financial-correctness-critical) — proof of immutability after
 * release:** `calcNet` applied to a `RELEASED` entry's own stored columns (`grossPay`, `allowance`,
 * `leaveDays`, `leaveRate`, `eobiAmount`, `eobiApplicable`, `advanceDeduction`,
 * `eidAdvanceDeduction`, `fine`, `correctionBalancePayable`, `correctionBalanceRecovery`, work
 * lines). Traced directly against the Corrections/Balance-Adjustment write paths before this
 * checkpoint began implementation:
 *   - `corrections.service.ts`'s `approveCorrectionRequest` never issues a `tx.payrollEntry.update`
 *     of any kind — it only ever writes `Correction`, `BalanceAdjustment`, and `CorrectionRequest`
 *     rows, and requires the entry already be `released = true` before a correction may even be
 *     proposed against it (`assertEntryIsReleased`).
 *   - `correctionBalancePayable`/`correctionBalanceRecovery` — the two calc-input columns a
 *     correction's *settlement* could plausibly touch — are written exclusively by
 *     `recomputeAndPersistEntryAggregates` (`corrections.materialization.service.ts`), whose sole
 *     caller (`materializeOneAdjustmentLocked`) hard-rejects any target entry with
 *     `released = true` (`determineMaterialization`'s `TARGET_ENTRY_ALREADY_RELEASED` gate,
 *     `corrections.materialization.ts`) — a materialization can only ever land on a still-unreleased,
 *     later Draft-cycle entry, never back onto the entry that originated the obligation.
 *   - `assertEntryEditable` (`payroll-entry.service.ts`) blocks every ordinary mutation path
 *     (single-entry update/delete, work-line add/update/delete, bulk update, import) the instant
 *     `released = true`, and no release-time consumption path
 *     (`consumeMaterializationsForReleasedEntries`, `settleAdvancesForReleasedEntries`) writes back to
 *     `PayrollEntry`'s own calc-input columns — both only ever write to `BalanceAdjustment`/
 *     `BalanceAdjustmentSettlement`/`BalanceAdjustmentMaterialization`/`Advance`.
 * This is the identical property `employee-payroll-history.test.ts`'s own "the original released Net
 * Salary on the main row is never replaced by a correction-replayed figure" test already proves for
 * an equivalent figure; this report's own test suite adds the same proof under its own name rather
 * than assuming it. `correctionBalancePayable`/`correctionBalanceRecovery` are surfaced as their own,
 * separate row fields — never folded into `originalReleasedAmount`, never a rewritten "original
 * release."
 *
 * **Correction/balance-salary boundary (frozen):** Correction Count, Correction Balance Payable,
 * Correction Balance Recovery only — never a correction reason, before/after value, actor, full
 * settlement history, or the live `BalanceAdjustment.remainingAmount`. Employee Payroll History
 * already owns that detailed drill-down.
 *
 * **Release actor (frozen):** Released At only. Released By is deliberately never selected/returned —
 * `PayrollEntry.releasedBy` may reflect whichever Unit-release action happened to complete the final
 * touched Unit for a multi-Unit entry, not a semantically reliable "who released this employee."
 *
 * **No detail page/endpoint in V1 (frozen).** Every field the frontend will ever need lives on the
 * list row itself.
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

/** Mirrors every sibling report's own `resolveUnitFilter` exactly — a named `unitId` must itself be
 * site-accessible, and (if a `siteIds` filter was also given) must belong to one of those named
 * sites, never silently ignored. */
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

interface ResolvedSalaryReleaseReportFilters {
  where: Prisma.PayrollEntryWhereInput;
  cycle: { id: string; year: number; month: number; status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' };
}

/** The one validated-filter-construction function every list/totals/export query shares. Frozen
 * filter set only (Approved Filters section): Payroll Cycle (required), Site (multi-select), Unit,
 * Row Status, Has Correction. Deliberately no Employee search, Designation, release-date range,
 * Released By, payment method, or a separate Released/Held toggle. */
async function resolveSalaryReleaseReportFilters(
  currentUser: SessionUser,
  query: Pick<SalaryReleaseReportListQuery, 'cycleId' | 'siteIds' | 'unitId' | 'rowStatus' | 'hasCorrection'>,
): Promise<ResolvedSalaryReleaseReportFilters> {
  const cycle = await getPayrollCycle(query.cycleId);
  const siteIdFilter = resolveSiteIdFilter(currentUser, query.siteIds);
  const unitId = await resolveUnitFilter(currentUser, query.unitId, siteIdFilter);

  const where: Prisma.PayrollEntryWhereInput = {
    cycleId: query.cycleId,
    ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    ...(unitId && { workLines: { some: { unitId } } }),
    ...(query.rowStatus && payrollEntryRowStatusWhereClause(query.rowStatus)),
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
 * the exact same canonical `calcNet` (never a second net-salary formula). Applied to a `RELEASED`
 * entry's own *stored* columns, this is the immutable, as-released figure — see this file's own
 * top-of-module doc comment for the full immutability trace. */
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

function toUnitRef(unit: { id: string; name: string; code: string | null }): SalaryReleaseReportUnitRef {
  return { id: unit.id, name: unit.name, code: unit.code };
}

function mapEntriesToRows(entries: RowEntry[], correctionCounts: Map<string, number>): SalaryReleaseReportRow[] {
  return entries.map((entry) => {
    const rowStatus = derivePayrollEntryRowStatus(entry);
    const primaryLine = entry.workLines[0] ?? null;

    // Original Released Amount is only ever populated for a genuinely RELEASED row — never a
    // pending calculated net salary mislabeled as an amount that was actually released. The
    // `netSalary > 0` guard mirrors `bank-sheets.service.ts`'s/Payroll Summary's own defensive
    // filter against a pre-existing legacy anomaly row; a row this report derives as RELEASED can
    // only ever have a positive net salary by construction, but the field's own honesty does not
    // depend on that invariant holding.
    let originalReleasedAmount: string | null = null;
    if (rowStatus === 'RELEASED') {
      const calc = calcEntryRow(entry);
      originalReleasedAmount = Number(calc.netSalary) > 0 ? calc.netSalary : null;
    }

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
      rowStatus,
      originalReleasedAmount,
      correctionBalancePayable: entry.correctionBalancePayable.toFixed(2),
      correctionBalanceRecovery: entry.correctionBalanceRecovery.toFixed(2),
      releasedAt: entry.releasedAt?.toISOString() ?? null,
      correctionCount: correctionCounts.get(entry.id) ?? 0,
    };
  });
}

async function mapEntriesToRowsBatched(entries: RowEntry[]): Promise<SalaryReleaseReportRow[]> {
  const correctionCounts = await fetchCorrectionCounts(entries.map((entry) => entry.id));
  return mapEntriesToRows(entries, correctionCounts);
}

// --- Deterministic ordering ---------------------------------------------------------------------

/**
 * Every branch ends with `{ id: 'asc' }` — the mandatory final tie-break, so offset pagination never
 * drifts between pages for two rows the sort key alone can't order. No `cycle`-based tie-break
 * anywhere — this report is always exactly one cycle, so every row already shares the same
 * `cycleId`. `releasedAt` is a genuine, plain stored `PayrollEntry` column — fully DB-native, no
 * bounded in-memory sort exception needed anywhere in this report (unlike `netSalary` elsewhere in
 * this module).
 *
 * `rowStatus`'s own ordering is the same disclosed, documented approximation every sibling report's
 * own `buildOrderBy` uses: it orders by the three real, stored columns that *determine* status
 * (`released`, `hold`, `payoutOutcome`), which groups every row of the same status contiguously, but
 * the relative order *between* groups follows Postgres's own boolean/enum ordering, not the 5-state
 * precedence rank — safe because sorting is a display convenience, never a filter or a financial
 * figure.
 */
function buildOrderBy(
  sortBy: SalaryReleaseReportSortField,
  dir: SalaryReleaseReportSortDirection,
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
    case 'releasedAt':
      return [{ releasedAt: dir }, { id: 'asc' }];
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
  hold: true,
  released: true,
  payoutOutcome: true,
  workLines: { select: { sortOrder: true, days: true, otHours: true, otRate: true, cycleDays: true } },
} satisfies Prisma.PayrollEntrySelect;

/**
 * The seven count fields are plain, always-exact DB aggregates, combined with the caller's own
 * filter via `AND` (never a shallow spread-merge that could silently overwrite an existing
 * `rowStatus` filter, the same documented pitfall every sibling report's own totals function
 * guards against). `releasedAmount`/`pendingReleaseAmount`/`correctionBalancePayableTotal`/
 * `correctionBalanceRecoveryTotal` are computed the same bounded way every sibling report's own
 * monetary totals already resolve the "not a stored, summable figure" conflict: fetched and summed
 * via canonical `calcNet`/`sumMoney` only when `matchingCount` is within
 * `SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS`; beyond it, `null` with `totalsComputed: false`.
 *
 * `releasedAmount` sums only genuinely `RELEASED` rows' own `netSalary` (`netSalary > 0` defensively
 * filtered, mirroring `reports.service.ts`'s own `releasedAmount`/`bank-sheets.service.ts`'s guard).
 * `pendingReleaseAmount` sums only genuinely `PENDING` rows' own `netSalary`. The two are never
 * combined into one "Total Released" figure. `correctionBalancePayableTotal`/
 * `correctionBalanceRecoveryTotal` sum the raw stored columns across every matching row regardless of
 * status — the same "already-materialized settlement, summed across the full filtered scope"
 * convention Payroll Summary's own `balancePayableIncluded`/`recoveryDeducted` already established.
 */
async function computeSalaryReleaseReportTotals(where: Prisma.PayrollEntryWhereInput): Promise<SalaryReleaseReportTotals> {
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

  if (matchingCount > SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS) {
    return {
      ...base,
      releasedAmount: null,
      pendingReleaseAmount: null,
      correctionBalancePayableTotal: null,
      correctionBalanceRecoveryTotal: null,
      totalsComputed: false,
    };
  }

  const entries = await prisma.payrollEntry.findMany({ where, select: CALC_INPUT_SELECT });

  const releasedPositive = entries.filter((entry) => {
    if (derivePayrollEntryRowStatus(entry) !== 'RELEASED') return false;
    return Number(calcEntryRow(entry).netSalary) > 0;
  });
  const pending = entries.filter((entry) => derivePayrollEntryRowStatus(entry) === 'PENDING');

  return {
    ...base,
    releasedAmount: sumMoney(releasedPositive.map((entry) => calcEntryRow(entry).netSalary)),
    pendingReleaseAmount: sumMoney(pending.map((entry) => calcEntryRow(entry).netSalary)),
    correctionBalancePayableTotal: sumMoney(entries.map((entry) => entry.correctionBalancePayable.toString())),
    correctionBalanceRecoveryTotal: sumMoney(entries.map((entry) => entry.correctionBalanceRecovery.toString())),
    totalsComputed: true,
  };
}

// --- List --------------------------------------------------------------------------------------

export async function getSalaryReleaseReportList(
  currentUser: SessionUser,
  query: SalaryReleaseReportListQuery,
): Promise<SalaryReleaseReportListResponse> {
  const { where, cycle } = await resolveSalaryReleaseReportFilters(currentUser, query);

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
  const rows = await mapEntriesToRowsBatched(entries);
  const totals = await computeSalaryReleaseReportTotals(where);

  return { cycle, page: query.page, pageSize: query.pageSize, total, rows, totals, generatedAt: new Date().toISOString() };
}

// --- Export --------------------------------------------------------------------------------------

export interface SalaryReleaseReportExportData {
  rows: SalaryReleaseReportRow[];
  totalMatching: number;
}

/**
 * Every matching row, in the same deterministic order the list endpoint would apply — up to
 * `SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS`. A preflight `COUNT` runs before any row is fetched or any
 * CSV/XLSX buffer is generated — an over-limit request is rejected outright (the caller's route
 * layer maps this to the structured `SalaryReleaseReportExportLimitError`), never silently
 * truncated. No `page`/`pageSize` accepted at all — always the complete filtered dataset.
 */
export async function buildSalaryReleaseReportExportData(
  currentUser: SessionUser,
  query: SalaryReleaseReportExportQuery,
): Promise<SalaryReleaseReportExportData> {
  const { where } = await resolveSalaryReleaseReportFilters(currentUser, query);
  const totalMatching = await prisma.payrollEntry.count({ where });

  if (totalMatching > SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS) {
    return { rows: [], totalMatching };
  }

  const orderBy = buildOrderBy(query.sortBy, query.sortDir);
  const entries = await prisma.payrollEntry.findMany({ where, select: ROW_SELECT, orderBy });
  const rows = await mapEntriesToRowsBatched(entries);
  return { rows, totalMatching };
}

/**
 * The bulk-export flat column set — matches the approved row vocabulary exactly (frozen decision —
 * Export section). Deliberately excludes Released By, CNIC, every banking field, Payment Method,
 * correction reasons, and any audit-actor identity. Values are read verbatim off the same
 * `SalaryReleaseReportRow` objects the list endpoint returns — never resummed or reformatted
 * differently — so export values are guaranteed to exactly match the on-screen API row values
 * (Principle 6).
 */
export const SALARY_RELEASE_REPORT_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Project Site',
  'Primary Unit',
  'Additional Unit Count',
  'Designation',
  'Row Status',
  'Original Released Amount',
  'Correction Balance Payable',
  'Correction Balance Recovery',
  'Released Date',
  'Correction Count',
] as const;

function buildExportRow(row: SalaryReleaseReportRow): string[] {
  return [
    row.employeeCode ?? '—',
    row.employeeName,
    row.siteName,
    row.primaryUnit?.name ?? '—',
    String(row.additionalUnitCount),
    row.designation,
    row.rowStatus,
    row.originalReleasedAmount ?? '—',
    row.correctionBalancePayable,
    row.correctionBalanceRecovery,
    row.releasedAt ? row.releasedAt.slice(0, 10) : '—',
    String(row.correctionCount),
  ];
}

export interface SalaryReleaseReportExportResult {
  buffer: Buffer;
  rowCount: number;
}

/**
 * CSV export — calls `buildSalaryReleaseReportExportData` exactly once (the same filter/sort/row-
 * shaping every other entry point shares), reuses the codebase's one mandatory CSV-serialization
 * entry point (`stringifyCsvSafe`) for formula-injection neutralization. The caller
 * (`reports.routes.ts`) is responsible for checking
 * `totalMatching > SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS` *before* calling this — this function
 * assumes that preflight has already passed and simply renders whatever rows it's handed.
 */
export function exportSalaryReleaseReportToCsv(rows: SalaryReleaseReportRow[]): SalaryReleaseReportExportResult {
  const csv = stringifyCsvSafe([SALARY_RELEASE_REPORT_EXPORT_HEADERS as unknown as string[], ...rows.map(buildExportRow)]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: rows.length };
}

/**
 * XLSX export — same "one shared row-shaping function, no independent calculation path" contract as
 * the CSV export above. Uses this codebase's existing export style vocabulary only (bold title/
 * header rows via ExcelJS, content-driven column widths via the shared `excelColumnWidth` — no
 * formulas, no Excel currency `numFmt`), matching every sibling report's own XLSX export.
 */
export async function exportSalaryReleaseReportToXlsx(rows: SalaryReleaseReportRow[]): Promise<SalaryReleaseReportExportResult> {
  const exportRows = rows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Salary Release Report');

  worksheet.addRow(['Salary Release Report']).font = { bold: true, size: 13 };
  worksheet.addRow([]);
  worksheet.addRow(SALARY_RELEASE_REPORT_EXPORT_HEADERS as unknown as string[]).font = { bold: true };
  for (const row of exportRows) worksheet.addRow(row);

  SALARY_RELEASE_REPORT_EXPORT_HEADERS.forEach((header, index) => {
    const columnValues = exportRows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: rows.length };
}
