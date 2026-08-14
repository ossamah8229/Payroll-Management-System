import ExcelJS from 'exceljs';
import type { SessionUser } from '@payroll/shared';
import { calcNet, sumMoney, type CalcNetResult } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { stringifyCsvSafe } from '../../common/import-export';
import { excelColumnWidth } from '../../common/excel-utils';
import { assertSiteAccess, getAccessibleSiteIds } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { paginateInMemory, resolveReportPage } from './reports-pagination';
import type {
  GetPayrollSummaryReportParams,
  PayrollSummaryCycleRef,
  PayrollSummaryExportResult,
  PayrollSummaryFigures,
  PayrollSummaryReport,
  PayrollSummarySiteRow,
} from './reports.types';

/**
 * Phase 8B Checkpoint 1 — Payroll Summary Report. Purely derived, read-only: every figure is
 * computed live from `PayrollEntry`'s own already-frozen columns (Phase 8A investigation report §1.1
 * / §16 / §17) — no report snapshot table, no duplicated payroll calculation, no persisted net
 * salary, no new payroll math. `calcNet` (imported from `@payroll/shared`, the same canonical
 * function `payroll-entry.service.ts`'s `computeEntryCalc` wraps) is the sole net-salary computation
 * path this module uses.
 *
 * **Query shape (Checkpoint 1 brief: "correctness is more important than clever query reduction"):**
 * this module fetches every `PayrollEntry` for the *one* selected cycle (scoped by site access), each
 * with only the columns `calcNet` actually needs — never the full `Employee`/banking relation, so no
 * employee identity/banking detail is ever read or returned by this report (Checkpoint 1's own
 * security requirement: "no employee banking details leak into Payroll Summary"). This is the same
 * bounded, single-cycle fetch shape Payroll Entry's own grid, Bank Sheet, and Cash Receiving already
 * prove safe at the ~1,500-employee scale this system targets — not a cross-cycle fetch, and not the
 * "fetch every page, flatten client-side" pattern Phase 8A's investigation flagged as unsuitable for
 * Reports. `netSalary`/`overtimeAmount`/etc. cannot be reproduced as a Prisma `groupBy` aggregate
 * (net salary is never a stored column — Phase 8A §1.1/§10), so this module aggregates in application
 * code from the one full pass over the cycle's entries it already has to make for correctness; every
 * other field that *could* be pushed into a database-level aggregate (`grossPay`, `allowance`, etc.)
 * is deliberately computed the identical way here, so there is exactly one aggregation strategy for
 * this report, never two independently-implemented ones that could drift from each other.
 *
 * **Site scoping** uses the exact same `assertSiteAccess`/`getAccessibleSiteIds` policy every other
 * site-scoped module already uses (`common/authz-policy.ts`) — an explicit `siteIds` filter naming a
 * site the caller cannot access throws 403 (never silently narrowed to the accessible subset); an
 * omitted filter resolves to the caller's full accessible scope (unrestricted for Master Admin).
 */

/** Minimal per-entry shape this module selects — every field `calcNet` needs, `hold`/`released`/
 * `payoutOutcome` for release-state bucketing, `siteId`/`site.name` for grouping — and nothing else.
 * No `employee`, `bankId`, `accountNumber`, `iban`, `cnic`, or name field is ever selected here. */
const PAYROLL_SUMMARY_ENTRY_SELECT = {
  id: true,
  siteId: true,
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
  site: { select: { id: true, name: true } },
  workLines: {
    select: { sortOrder: true, days: true, otHours: true, otRate: true, cycleDays: true },
  },
} as const;

type PayrollSummaryEntry = Awaited<
  ReturnType<typeof prisma.payrollEntry.findMany<{ where: object; select: typeof PAYROLL_SUMMARY_ENTRY_SELECT }>>
>[number];

/** Adapts one narrowly-`select`ed `PayrollEntry` row into `calcNet`'s string-based input contract —
 * the report-query analogue of `payroll-entry.service.ts`'s `computeEntryCalc`, calling the exact
 * same shared `calcNet` (never a second net-salary formula), just accepting this module's own
 * `select`-shaped row rather than a full Prisma `PayrollEntry` entity. */
function calcEntry(entry: PayrollSummaryEntry): CalcNetResult {
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

function emptyFigures(): PayrollSummaryFigures {
  return {
    employeeCount: 0,
    heldCount: 0,
    releasedCount: 0,
    pendingReleaseCount: 0,
    noPayDueCount: 0,
    recoveryDueCount: 0,
    grossPay: '0.00',
    overtimeAmount: '0.00',
    allowances: '0.00',
    eobi: '0.00',
    advanceDeductions: '0.00',
    eidAdvanceDeductions: '0.00',
    fines: '0.00',
    balancePayableIncluded: '0.00',
    recoveryDeducted: '0.00',
    totalEarnings: '0.00',
    totalDeductions: '0.00',
    netSalary: '0.00',
    releasedAmount: '0.00',
    pendingReleaseAmount: '0.00',
  };
}

/** Builds one site's (or, via `sumFigures` below, the whole cycle's) aggregated figures from its own
 * `PayrollEntry` rows — the single row-aggregation implementation this whole report is built on, used
 * identically by the on-screen JSON response and both export formats (never a second, independent
 * calculation path). Every release-state bucket mirrors `payroll-entry.service.ts`'s own
 * `assertEntryEditable`/release-readiness classification — see `PayrollSummaryFigures`'s own doc
 * comment for the full definitions. */
function buildSiteRow(siteId: string, siteName: string, entries: PayrollSummaryEntry[]): PayrollSummarySiteRow {
  const calculated = entries.map((entry) => ({ entry, calc: calcEntry(entry) }));

  const released = calculated.filter(({ entry }) => entry.released);
  // Negative Payroll Recovery defensive filter (matches `bank-sheets.service.ts`'s own `getBankSheet`
  // precedent, for the identical reason): `released` has only ever been set for a positive net salary
  // going forward, but a pre-existing legacy anomaly row must never inflate Released Amount.
  const releasedPositive = released.filter(({ calc }) => Number(calc.netSalary) > 0);
  const pending = calculated.filter(({ entry }) => !entry.released && !entry.hold && entry.payoutOutcome === null);

  return {
    siteId,
    siteName,
    employeeCount: entries.length,
    heldCount: entries.filter((entry) => entry.hold).length,
    releasedCount: released.length,
    pendingReleaseCount: pending.length,
    noPayDueCount: entries.filter((entry) => entry.payoutOutcome === 'NO_PAY_DUE').length,
    recoveryDueCount: entries.filter((entry) => entry.payoutOutcome === 'RECOVERY_DUE').length,
    grossPay: sumMoney(entries.map((entry) => entry.grossPay.toString())),
    overtimeAmount: sumMoney(calculated.map(({ calc }) => calc.otEarned)),
    allowances: sumMoney(entries.map((entry) => entry.allowance.toString())),
    eobi: sumMoney(calculated.map(({ calc }) => calc.eobiDeduction)),
    advanceDeductions: sumMoney(entries.map((entry) => entry.advanceDeduction.toString())),
    eidAdvanceDeductions: sumMoney(entries.map((entry) => entry.eidAdvanceDeduction.toString())),
    fines: sumMoney(entries.map((entry) => entry.fine.toString())),
    balancePayableIncluded: sumMoney(entries.map((entry) => entry.correctionBalancePayable.toString())),
    recoveryDeducted: sumMoney(entries.map((entry) => entry.correctionBalanceRecovery.toString())),
    totalEarnings: sumMoney(calculated.map(({ calc }) => calc.totalEarning)),
    totalDeductions: sumMoney(calculated.map(({ calc }) => calc.totalDeduction)),
    netSalary: sumMoney(calculated.map(({ calc }) => calc.netSalary)),
    releasedAmount: sumMoney(releasedPositive.map(({ calc }) => calc.netSalary)),
    pendingReleaseAmount: sumMoney(pending.map(({ calc }) => calc.netSalary)),
  };
}

/** The cycle-wide grand total — sums every site row's own already-computed figures (never a second,
 * independent pass over raw entries), so `cycleTotals` is guaranteed to reconcile exactly with the
 * sum of every `siteRows` entry across the complete (unpaginated) filtered scope. */
function sumFigures(rows: PayrollSummaryFigures[]): PayrollSummaryFigures {
  return rows.reduce((total, row) => ({
    employeeCount: total.employeeCount + row.employeeCount,
    heldCount: total.heldCount + row.heldCount,
    releasedCount: total.releasedCount + row.releasedCount,
    pendingReleaseCount: total.pendingReleaseCount + row.pendingReleaseCount,
    noPayDueCount: total.noPayDueCount + row.noPayDueCount,
    recoveryDueCount: total.recoveryDueCount + row.recoveryDueCount,
    grossPay: sumMoney([total.grossPay, row.grossPay]),
    overtimeAmount: sumMoney([total.overtimeAmount, row.overtimeAmount]),
    allowances: sumMoney([total.allowances, row.allowances]),
    eobi: sumMoney([total.eobi, row.eobi]),
    advanceDeductions: sumMoney([total.advanceDeductions, row.advanceDeductions]),
    eidAdvanceDeductions: sumMoney([total.eidAdvanceDeductions, row.eidAdvanceDeductions]),
    fines: sumMoney([total.fines, row.fines]),
    balancePayableIncluded: sumMoney([total.balancePayableIncluded, row.balancePayableIncluded]),
    recoveryDeducted: sumMoney([total.recoveryDeducted, row.recoveryDeducted]),
    totalEarnings: sumMoney([total.totalEarnings, row.totalEarnings]),
    totalDeductions: sumMoney([total.totalDeductions, row.totalDeductions]),
    netSalary: sumMoney([total.netSalary, row.netSalary]),
    releasedAmount: sumMoney([total.releasedAmount, row.releasedAmount]),
    pendingReleaseAmount: sumMoney([total.pendingReleaseAmount, row.pendingReleaseAmount]),
  }), emptyFigures());
}

/** The site-scope resolution every route/export below shares — an explicit filter is fully
 * access-checked (throws 403 for any inaccessible site, never silently narrowed); an omitted filter
 * resolves to the caller's full accessible scope (`undefined` = unrestricted, Master Admin only). */
function resolveSiteIdFilter(currentUser: SessionUser, siteIds?: string[]): string[] | undefined {
  if (siteIds) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
    return siteIds;
  }
  return getAccessibleSiteIds(currentUser);
}

/** Exported (Dashboard Checkpoint 1A) so the Dashboard aggregation service can reuse this exact,
 * already-authoritative query+aggregation for Net Payroll/Pending Release/Release Progress/
 * Deductions/Site Summary, rather than re-deriving any of Payroll Summary's own figures a second
 * time (`docs/architecture/workflows/dashboard.md` §"Source-of-truth mapping"). */
export interface PayrollSummaryData {
  cycle: PayrollSummaryCycleRef;
  siteIdFilter: string[] | null;
  /** Every site row in the complete filtered/accessible scope, sorted deterministically by site
   * name — never pre-sliced. `getPayrollSummaryReport` paginates this; the export functions use it
   * unpaginated, in full. */
  siteRows: PayrollSummarySiteRow[];
  cycleTotals: PayrollSummaryFigures;
}

/**
 * The one query+aggregation this whole report is built on — called by both the JSON route
 * (`getPayrollSummaryReport`) and both export formats below, so there is exactly one implementation
 * of "what belongs on this report," never a second one for exports (mirrors `bank-sheets.service.ts`'s
 * own `getBankSheet` precedent). **Exported (Dashboard Checkpoint 1A)** as this report module's own
 * reuse seam — see `PayrollSummaryData`'s own doc comment above.
 */
export async function buildPayrollSummaryData(
  currentUser: SessionUser,
  params: Pick<GetPayrollSummaryReportParams, 'cycleId' | 'siteIds'>,
): Promise<PayrollSummaryData> {
  const cycle = await getPayrollCycle(params.cycleId); // 404s cleanly if the cycle doesn't exist
  const siteIdFilter = resolveSiteIdFilter(currentUser, params.siteIds);

  const entries = await prisma.payrollEntry.findMany({
    where: {
      cycleId: params.cycleId,
      ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    },
    select: PAYROLL_SUMMARY_ENTRY_SELECT,
  });

  const bySite = new Map<string, { siteName: string; entries: PayrollSummaryEntry[] }>();
  for (const entry of entries) {
    const bucket = bySite.get(entry.siteId);
    if (bucket) {
      bucket.entries.push(entry);
    } else {
      bySite.set(entry.siteId, { siteName: entry.site.name, entries: [entry] });
    }
  }

  const siteRows = [...bySite.entries()]
    .map(([siteId, bucket]) => buildSiteRow(siteId, bucket.siteName, bucket.entries))
    .sort((a, b) => a.siteName.localeCompare(b.siteName));

  return {
    cycle: { id: cycle.id, year: cycle.year, month: cycle.month, status: cycle.status },
    siteIdFilter: siteIdFilter ?? null,
    siteRows,
    cycleTotals: sumFigures(siteRows),
  };
}

/**
 * Payroll Summary Report — JSON, paginated at the site-row level (`reports-pagination.ts`).
 * `cycleTotals` is always computed over the complete filtered scope, never just the current page —
 * see `reports.types.ts`'s own doc comment for why a paginated grand total would be misleading.
 */
export async function getPayrollSummaryReport(
  currentUser: SessionUser,
  params: GetPayrollSummaryReportParams,
): Promise<PayrollSummaryReport> {
  const data = await buildPayrollSummaryData(currentUser, params);
  const { page, pageSize } = resolveReportPage(params.page, params.pageSize);
  const paged = paginateInMemory(data.siteRows, page, pageSize);

  return {
    cycle: data.cycle,
    generatedAt: new Date().toISOString(),
    filters: { siteIds: data.siteIdFilter },
    cycleTotals: data.cycleTotals,
    page: paged.page,
    pageSize: paged.pageSize,
    total: paged.total,
    siteRows: paged.rows,
  };
}

export const PAYROLL_SUMMARY_EXPORT_HEADERS = [
  'Project Site',
  'Employee Count',
  'Held',
  'Released',
  'Pending Release',
  'No Pay Due',
  'Recovery Due',
  'Gross Pay',
  'Overtime',
  'Allowances',
  'EOBI',
  'Advance Deductions',
  'Eid Advance Deductions',
  'Fines',
  'Balance Payable Included',
  'Recovery Deducted',
  'Total Earnings',
  'Total Deductions',
  'Net Salary',
  'Released Amount',
  'Pending Release Amount',
] as const;

function buildExportRow(row: PayrollSummarySiteRow): string[] {
  return [
    row.siteName,
    String(row.employeeCount),
    String(row.heldCount),
    String(row.releasedCount),
    String(row.pendingReleaseCount),
    String(row.noPayDueCount),
    String(row.recoveryDueCount),
    row.grossPay,
    row.overtimeAmount,
    row.allowances,
    row.eobi,
    row.advanceDeductions,
    row.eidAdvanceDeductions,
    row.fines,
    row.balancePayableIncluded,
    row.recoveryDeducted,
    row.totalEarnings,
    row.totalDeductions,
    row.netSalary,
    row.releasedAmount,
    row.pendingReleaseAmount,
  ];
}

function buildTotalExportRow(totals: PayrollSummaryFigures): string[] {
  return [
    'Total',
    String(totals.employeeCount),
    String(totals.heldCount),
    String(totals.releasedCount),
    String(totals.pendingReleaseCount),
    String(totals.noPayDueCount),
    String(totals.recoveryDueCount),
    totals.grossPay,
    totals.overtimeAmount,
    totals.allowances,
    totals.eobi,
    totals.advanceDeductions,
    totals.eidAdvanceDeductions,
    totals.fines,
    totals.balancePayableIncluded,
    totals.recoveryDeducted,
    totals.totalEarnings,
    totals.totalDeductions,
    totals.netSalary,
    totals.releasedAmount,
    totals.pendingReleaseAmount,
  ];
}

/**
 * Exports the Payroll Summary Report as CSV — **the complete filtered report, every site row, never
 * just one pagination page** (Checkpoint 1 brief: "exports should export the complete filtered
 * report, not merely the currently visible pagination page"). Calls `buildPayrollSummaryData` exactly
 * once, the same shared query+aggregation the JSON route uses — no independent calculation path.
 * Reuses this codebase's one mandatory CSV-serialization entry point, `stringifyCsvSafe`
 * (`common/import-export.ts`), which routes every cell through `sanitizeCsvCell` for formula-injection
 * neutralization.
 */
export async function exportPayrollSummaryToCsv(
  currentUser: SessionUser,
  params: Pick<GetPayrollSummaryReportParams, 'cycleId' | 'siteIds'>,
): Promise<PayrollSummaryExportResult> {
  const data = await buildPayrollSummaryData(currentUser, params);
  const rows = data.siteRows.map(buildExportRow);
  const csv = stringifyCsvSafe([
    PAYROLL_SUMMARY_EXPORT_HEADERS as unknown as string[],
    ...rows,
    ...(rows.length > 0 ? [buildTotalExportRow(data.cycleTotals)] : []),
  ]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: data.siteRows.length, cycle: data.cycle };
}

/**
 * Exports the Payroll Summary Report as XLSX — same "complete filtered report" and "one shared
 * query+aggregation" contract as `exportPayrollSummaryToCsv` above. Uses this codebase's existing
 * export style vocabulary only (bold title/header/total rows via ExcelJS, content-driven column
 * widths) — no formulas, no Excel currency `numFmt`, matching Bank Sheets'/Statements' own XLSX
 * exports.
 */
export async function exportPayrollSummaryToXlsx(
  currentUser: SessionUser,
  params: Pick<GetPayrollSummaryReportParams, 'cycleId' | 'siteIds'>,
): Promise<PayrollSummaryExportResult> {
  const data = await buildPayrollSummaryData(currentUser, params);
  const rows = data.siteRows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Payroll Summary');

  worksheet.addRow([`Payroll Summary — ${data.cycle.year}-${String(data.cycle.month).padStart(2, '0')} (${data.cycle.status})`]).font = {
    bold: true,
    size: 13,
  };
  worksheet.addRow([]);
  worksheet.addRow(PAYROLL_SUMMARY_EXPORT_HEADERS as unknown as string[]).font = { bold: true };
  for (const row of rows) worksheet.addRow(row);

  if (rows.length > 0) {
    const totalRow = worksheet.addRow(buildTotalExportRow(data.cycleTotals));
    totalRow.font = { bold: true };
  }

  const headerRowIndex = 3;
  PAYROLL_SUMMARY_EXPORT_HEADERS.forEach((header, index) => {
    const columnValues = rows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });
  worksheet.getRow(headerRowIndex).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: data.siteRows.length, cycle: data.cycle };
}
