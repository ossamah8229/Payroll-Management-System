import ExcelJS from 'exceljs';
import type { Bank, Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { stringifyCsvSafe } from '../../common/import-export';
import { assertSiteAccess, isMasterAdmin } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { computeEntryCalc, withLiveMasterData, WORK_LINES_INCLUDE } from './payroll-entry.service';

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
 * purely to describe the CSV/Excel *export* column order.
 *
 * **v1.0.0 Payroll Entry Working-Days Aggregation and Export Correctness checkpoint (2026-08-24):**
 * the original 20-column set above `Released` reused the grid's now-corrected primary-work-line-only
 * shape (`Days`/`OT Hrs`/`OT Rate`/`Cycle Days` came from the entry's primary line only). `Days` now
 * reads the same canonical `calcNet().totalWorkingDays` aggregate the grid/footer use — the sum of
 * every work line's own `days`, not just the primary line's (docs/architecture/database/
 * payroll-entry.md §12a) — while `OT Hrs`/`OT Rate`/`Cycle Days` deliberately stay primary-line-only,
 * unchanged: OT rate and cycle-days are rate/divisor bases, not summable quantities, the same
 * "primary-line-dependent" treatment `leaveRate` already has (§12), and OT Hours aggregation was
 * explicitly out of this checkpoint's scope (not a reported defect) — see
 * `docs/PROJECT_PROGRESS.md`'s own checkpoint entry for the disclosed follow-up. Nine columns
 * appended after `Released`, preserving every existing column's position: `Net Salary` (previously
 * absent entirely); `Bank`/`Bank Name` (the employee's bank — `Bank Name` resolved via `bankId`
 * *after* `withLiveMasterData`'s live-master-data overlay, never via a stale pre-overlay Prisma
 * relation, exactly mirroring the frontend grid's own `bankCodeById` lookup pattern,
 * `frontend/src/components/payroll-entry/columns.ts`); `Branch Code` (`PayrollEntry.branchCode` —
 * the employee's own bank branch code, already an existing column, previously never exported);
 * `Account Number`/`IBAN` (previously never exported); `Deputed Branch Code`/`Deputed Branch Name`
 * (the primary work line's own `ProjectUnit.code`/`.name` — the grid's "Deputed Branch" column,
 * mirroring `unitCode`'s own primary-line-only semantics, unchanged by this checkpoint); `Unit
 * Working Days Breakdown` (blank for a single-line entry — "remains simple," per the approved
 * product decision — populated only for a genuine split employee, preserving every line's own unit
 * identity and days so a multi-unit total is never flattened into an unreconcilable single figure);
 * `Remarks` (previously never exported, a genuine grid business column). **`Bank`/`Bank Name` are
 * deliberately two separate columns, not one "Branch Name" column** — this schema has no bank-
 * *branch*-name field anywhere (only a free-text `branchCode`); inventing one was explicitly
 * rejected (approved product decision, 2026-08-24) in favor of the two fields that genuinely already
 * exist. If a real bank-branch-name requirement emerges later, that is a separate, dedicated
 * schema/data-capture checkpoint, not a relabeling of `Bank.name` here.
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
  'Net Salary',
  'Bank',
  'Bank Name',
  'Branch Code',
  'Account Number',
  'IBAN',
  'Deputed Branch Code',
  'Deputed Branch Name',
  'Unit Working Days Breakdown',
  'Remarks',
] as const;

type ExportEntry = Prisma.PayrollEntryGetPayload<{
  include: { employee: true; site: true; workLines: { include: { unit: true } } };
}>;

/** One line per work line, `"{unit name} ({unit code}): {days}"`, semicolon-joined — the least
 * disruptive representation for a genuinely variable-cardinality breakdown inside a flat CSV/XLSX
 * row (least-disruptive per the approved product decision, 2026-08-24): a bounded set of "Unit N"
 * column pairs would silently truncate an entry with more lines than the bound, and this system's
 * `PayrollEntryWorkLine` count is not itself bounded (§12a). Blank for a single-line entry — the
 * `Days`/`Deputed Branch...` columns already fully and unambiguously describe it, so nothing here
 * would add information, matching the "single-unit employees remain simple and readable" product
 * decision. Falls back to just the unit's name when it has no `code` (nullable, §8a).
 */
function formatUnitWorkingDaysBreakdown(workLines: ExportEntry['workLines']): string {
  if (workLines.length <= 1) return '';
  return workLines
    .map((line) => `${line.unit.name}${line.unit.code ? ` (${line.unit.code})` : ''}: ${line.days.toString()}`)
    .join('; ');
}

function buildExportRow(entry: ExportEntry, bankById: Map<string, Bank>): string[] {
  // Guaranteed by the architecture — every PayrollEntry always has at least one WorkLine
  // (database/payroll-entry.md §12a) — work lines are pre-sorted by sortOrder ascending by the
  // caller, so [0] is always the primary line.
  const primary = entry.workLines[0]!;
  // Single canonical computation (Principle 5) — `totalWorkingDays`/`netSalary` are never
  // re-derived independently here; this is the exact same `calcNet` result the grid/footer read.
  const calc = computeEntryCalc(entry);
  const bank = entry.bankId ? bankById.get(entry.bankId) : undefined;
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
    // Employee aggregate Working Days (v1.0.0 audit-correctness fix) — sum of every work line's
    // own `days`, never just the primary line's; see this file's own header-array doc comment.
    calc.totalWorkingDays,
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
    calc.netSalary,
    bank?.code ?? '',
    bank?.name ?? '',
    entry.branchCode ?? '',
    entry.accountNumber ?? '',
    entry.iban ?? '',
    primary.unit.code ?? '',
    primary.unit.name,
    formatUnitWorkingDaysBreakdown(entry.workLines),
    entry.remarks ?? '',
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
 *
 * **v1.0.0 checkpoint (2026-08-24):** `workLines` now includes each line's own `unit` (the shared
 * `WORK_LINES_INCLUDE`, matching every other read of a `PayrollEntry` in this codebase) — the source
 * of the new `Deputed Branch Code`/`Deputed Branch Name`/`Unit Working Days Breakdown` columns. Also
 * resolves every distinct `bankId` actually present *after* the `withLiveMasterData` overlay below
 * into a `Bank` map, returned alongside the entries — never joined via Prisma's own `bank` relation
 * on the initial query, which would be resolved against each row's *stored* (pre-overlay) `bankId`
 * and could point at the wrong bank for an unreleased Draft entry whose live Employee Registry bank
 * has since changed. This mirrors the frontend grid's own established pattern for the exact same
 * hazard (`columns.ts`'s `bankCodeById`, built from a separately-fetched bank list and looked up by
 * the entry's own already-live-overlaid `bankId`), not a new one invented for this export.
 */
async function resolveExportEntries(
  currentUser: SessionUser,
  cycleId: string,
  siteIds?: string[],
): Promise<{ entries: ExportEntry[]; bankById: Map<string, Bank> }> {
  await getPayrollCycle(cycleId);

  if (siteIds) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
  }
  const siteIdFilter = siteIds ?? (!isMasterAdmin(currentUser) ? currentUser.siteIds : undefined);

  const rawEntries = await prisma.payrollEntry.findMany({
    where: { cycleId, ...(siteIdFilter && { siteId: { in: siteIdFilter } }) },
    include: { employee: true, site: true, workLines: WORK_LINES_INCLUDE },
    orderBy: { sortOrder: 'asc' },
  });
  const entries = rawEntries.map((entry) => withLiveMasterData(entry));

  const bankIds = [...new Set(entries.map((entry) => entry.bankId).filter((id): id is string => id !== null))];
  const banks = bankIds.length > 0 ? await prisma.bank.findMany({ where: { id: { in: bankIds } } }) : [];
  const bankById = new Map(banks.map((bank) => [bank.id, bank]));

  return { entries, bankById };
}

export async function exportPayrollEntriesToCsv(
  currentUser: SessionUser,
  cycleId: string,
  siteIds?: string[],
): Promise<PayrollEntryExportResult> {
  const { entries, bankById } = await resolveExportEntries(currentUser, cycleId, siteIds);
  const rows = entries.map((entry) => buildExportRow(entry, bankById));
  const csv = stringifyCsvSafe([PAYROLL_ENTRY_TEMPLATE_HEADERS as unknown as string[], ...rows]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: entries.length };
}

export async function exportPayrollEntriesToXlsx(
  currentUser: SessionUser,
  cycleId: string,
  siteIds?: string[],
): Promise<PayrollEntryExportResult> {
  const { entries, bankById } = await resolveExportEntries(currentUser, cycleId, siteIds);
  const rows = entries.map((entry) => buildExportRow(entry, bankById));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Payroll Entry');
  sheet.addRow(PAYROLL_ENTRY_TEMPLATE_HEADERS as unknown as string[]);
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: entries.length };
}
