import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { stringifyCsvSafe } from '../../common/import-export';
import { assertSiteAccess, isMasterAdmin } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { withLiveMasterData } from './payroll-entry.service';

/**
 * The Payroll Entry export template/header row (Phase 3 Checkpoint 5, `reference/PROJECT_SPEC.md`
 * "A separate Payroll Entry import/export exists for the monthly variable data"), extended per
 * the approved architecture review with one addition beyond the frozen spec text: an `Employee
 * Code` column, since `CNIC` alone cannot address an employee whose CNIC is null (Phase 2.5
 * Checkpoint 4 finalized CNIC as optional) — the same two-key match the Employee Registry importer
 * used.
 *
 * **Payroll Entry import was removed (Payroll Entry usability checkpoint, 2026-07-24) — payroll
 * data must never be imported, per the approved product decision.** This header set now exists
 * purely to describe the CSV/Excel *export* column order; every column here is still
 * informational/export-only, reusing the same flat, primary-work-line-only shape import used to
 * have (`Days`/`OT Hrs`/`OT Rate`/`Cycle Days` reflect the entry's primary line only — a split
 * employee's non-primary lines are never represented in this export, reachable only through the
 * grid's Split by {unitLabel} modal).
 */
export const PAYROLL_ENTRY_TEMPLATE_HEADERS = [
  'CNIC',
  'Employee Code',
  'Name',
  'Site',
  'Designation',
  'Gross Pay',
  'Days',
  'OT Hrs',
  'OT Rate',
  'Allowance',
  'Leave',
  'Leave Rate',
  'Cycle Days',
  'EOBI Amount',
  'EOBI On',
  'Advance',
  'Eid Advance',
  'Fine',
  'Hold',
  'Released',
] as const;

type ExportEntry = Prisma.PayrollEntryGetPayload<{
  include: { employee: true; site: true; workLines: true };
}>;

function buildExportRow(entry: ExportEntry): string[] {
  // Guaranteed by the architecture — every PayrollEntry always has at least one WorkLine
  // (database/payroll-entry.md §12a) — work lines are pre-sorted by sortOrder ascending by the
  // caller, so [0] is always the primary line.
  const primary = entry.workLines[0]!;
  return [
    entry.employee.cnic ?? '',
    entry.employee.employeeCode ?? '',
    // Phase 7F Refinement (2026-08-04) — was `entry.employee.name` (always the *live* Employee
    // Registry name, unconditionally, even for a released/archived row) — the one export column
    // that was never frozen at all, the opposite problem from `designation`/`grossPay` below (which
    // were always frozen, even while still Draft). `employeeNameSnapshot` is what
    // `withLiveMasterData` (applied in `resolveExportEntries`) already overlays with the live name
    // while unreleased and leaves untouched once frozen at release — the same one column every
    // other Employee Name read in this codebase (Payslips) already uses. The `?? entry.employee.name`
    // fallback only ever matters for a pre-migration legacy row with a null snapshot
    // (`database/payroll-entry.md §12`'s own note on this column's nullability).
    entry.employeeNameSnapshot ?? entry.employee.name,
    entry.site.name,
    entry.designation,
    entry.grossPay.toString(),
    primary.days.toString(),
    primary.otHours.toString(),
    primary.otRate?.toString() ?? '',
    entry.allowance.toString(),
    entry.leaveDays.toString(),
    entry.leaveRate?.toString() ?? '',
    String(primary.cycleDays),
    entry.eobiAmount.toString(),
    entry.eobiApplicable ? 'Yes' : 'No',
    entry.advanceDeduction.toString(),
    entry.eidAdvanceDeduction.toString(),
    entry.fine.toString(),
    entry.hold ? 'Yes' : 'No',
    entry.released ? 'Yes' : 'No',
  ];
}

export interface PayrollEntryExportResult {
  buffer: Buffer;
  rowCount: number;
}

/**
 * Resolves the site filter exactly like `listPayrollEntries` does (`payroll-entry.service.ts`) —
 * duplicated here as a small, deliberate exception rather than reused directly, since that
 * function is paginated and single-`siteId`-scoped (the grid's own fetch shape) while export needs
 * every row across a caller-supplied *set* of sites in one pass, the same shape
 * `employees-import-export.service.ts`'s own `buildExportRows` needs from `listEmployees`.
 *
 * **Phase 7F Refinement (2026-08-04)** — every row now passes through the same
 * `withLiveMasterData` overlay the Payroll Entry grid itself reads through, so an exported Draft
 * row shows exactly the same `designation`/`grossPay`/`employeeNameSnapshot` values the on-screen
 * grid currently shows (a corrected bank/salary/name in Employee Registry is reflected in the next
 * export immediately, no separate resync) — closing the gap where export previously read the
 * entry's own stored column directly, unconditionally, and could show a stale value the grid no
 * longer did. A Released/Archived row is untouched by this (the same `released ||
 * payoutOutcome !== null` gate `withLiveMasterData` already enforces everywhere else it's used) —
 * its export row keeps reading the frozen, historical snapshot exactly as stored, exactly as
 * before. No calculation is affected — this export has no computed/net-salary column, and
 * `withLiveMasterData` itself never touches `calcNet` inputs beyond the display values it already
 * overlays elsewhere in this codebase. Release semantics (`payroll-release.service.ts`) are
 * entirely untouched by this change — this file has no write path of its own.
 */
async function resolveExportEntries(
  currentUser: SessionUser,
  cycleId: string,
  siteIds?: string[],
): Promise<ExportEntry[]> {
  await getPayrollCycle(cycleId);

  if (siteIds) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
  }
  const siteIdFilter = siteIds ?? (!isMasterAdmin(currentUser) ? currentUser.siteIds : undefined);

  const entries = await prisma.payrollEntry.findMany({
    where: { cycleId, ...(siteIdFilter && { siteId: { in: siteIdFilter } }) },
    include: { employee: true, site: true, workLines: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  });
  return entries.map((entry) => withLiveMasterData(entry));
}

export async function exportPayrollEntriesToCsv(
  currentUser: SessionUser,
  cycleId: string,
  siteIds?: string[],
): Promise<PayrollEntryExportResult> {
  const entries = await resolveExportEntries(currentUser, cycleId, siteIds);
  const rows = entries.map(buildExportRow);
  const csv = stringifyCsvSafe([PAYROLL_ENTRY_TEMPLATE_HEADERS as unknown as string[], ...rows]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: entries.length };
}

export async function exportPayrollEntriesToXlsx(
  currentUser: SessionUser,
  cycleId: string,
  siteIds?: string[],
): Promise<PayrollEntryExportResult> {
  const entries = await resolveExportEntries(currentUser, cycleId, siteIds);
  const rows = entries.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Payroll Entry');
  sheet.addRow(PAYROLL_ENTRY_TEMPLATE_HEADERS as unknown as string[]);
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: entries.length };
}
