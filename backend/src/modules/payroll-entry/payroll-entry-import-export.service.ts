import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { normalizeCnic, updatePayrollEntrySchema, updateWorkLineSchema } from '@payroll/shared';
import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../common/http-error';
import { parseTableFromFile, stringifyCsvSafe, type ImportRowError } from '../../common/import-export';
import { assertSiteAccess, isMasterAdmin } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { assertEntryEditable, mapUpdateInputToEntryData, mapUpdateInputToWorkLineData } from './payroll-entry.service';

/**
 * The Payroll Entry import/export template (Phase 3 Checkpoint 5, `reference/PROJECT_SPEC.md`
 * "A separate Payroll Entry import/export exists for the monthly variable data"), extended per
 * the approved architecture review with one addition beyond the frozen spec text: an `Employee
 * Code` column, since `CNIC` alone cannot address an employee whose CNIC is null (Phase 2.5
 * Checkpoint 4 finalized CNIC as optional) — the same two-key match the Employee Registry importer
 * already uses.
 *
 * **Option C (approved, frozen 2026-07-09): this format is deliberately flat and represents only
 * an entry's *primary* work line** (`Days`/`OT Hrs`/`OT Rate`/`Cycle Days`) — mirroring Checkpoint
 * 4's own frozen "Copy to All touches the primary line only" precedent. A split employee's
 * non-primary lines are never represented here and are never touched by import; they remain
 * reachable exclusively through the grid's Split by {unitLabel} modal. The frontend surfaces this
 * limitation via UI copy, per the approved decision, rather than the file format growing a
 * Unit column and multi-row-per-employee semantics.
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
    entry.employee.name,
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

  return prisma.payrollEntry.findMany({
    where: { cycleId, ...(siteIdFilter && { siteId: { in: siteIdFilter } }) },
    include: { employee: true, site: true, workLines: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  });
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

interface ParsedRow {
  rowNumber: number;
  cells: Record<string, string>;
}

function rowsFromTable(table: string[][]): ParsedRow[] {
  if (table.length === 0) {
    throw badRequest('The uploaded file is empty');
  }

  const header = table[0]!.map((cell) => cell.trim());
  const expected = PAYROLL_ENTRY_TEMPLATE_HEADERS as unknown as string[];
  const headerMatches = expected.every((column, index) => header[index] === column);
  if (!headerMatches) {
    throw badRequest(
      `Header row does not match the official Payroll Entry template. Expected: ${expected.join(', ')}`,
    );
  }

  return table.slice(1).map((cells, index) => {
    const record: Record<string, string> = {};
    expected.forEach((column, columnIndex) => {
      record[column] = (cells[columnIndex] ?? '').toString().trim();
    });
    return { rowNumber: index + 2, cells: record }; // +2: 1-indexed, plus the header row itself
  });
}

/** Parses an uploaded CSV or XLSX buffer into header-keyed rows, validating the header set first. */
export async function parsePayrollEntryImportFile(buffer: Buffer, filename: string): Promise<ParsedRow[]> {
  const table = await parseTableFromFile(buffer, filename);
  return rowsFromTable(table);
}

export interface PayrollEntryImportResult {
  updated: number;
  skipped: ImportRowError[];
}

type ImportEntry = Prisma.PayrollEntryGetPayload<{
  include: { employee: true; workLines: true };
}>;

/**
 * Resolves a row to an existing `PayrollEntry` in the target cycle by `Employee Code` and/or
 * `CNIC` (both matched case-insensitively; CNIC normalized the same way every other CNIC
 * comparison in this codebase is, `normalizeCnic`, `shared/src/lib/cnic.ts`) — the approved
 * two-key match, since CNIC alone (the frozen spec's original, single match key) cannot address an
 * employee with no CNIC on file. A row naming neither key, or naming two keys that resolve to
 * different employees, is a per-row error, never a guess — the same defense-in-depth posture
 * `employees-import-export.service.ts`'s `resolveRowUnit` already applies to its own two-key
 * (code/name) resolution.
 */
function resolveRowEntry(row: ParsedRow, entries: ImportEntry[]): ImportEntry {
  const codeRaw = row.cells['Employee Code']!.trim();
  const cnicRaw = row.cells['CNIC']!.trim();
  const normalizedCnic = cnicRaw ? normalizeCnic(cnicRaw) : '';

  if (!codeRaw && !normalizedCnic) {
    throw new Error('Row does not identify an employee — provide "Employee Code" and/or "CNIC"');
  }

  let byCode: ImportEntry | undefined;
  if (codeRaw) {
    byCode = entries.find(
      (entry) => (entry.employee.employeeCode ?? '').trim().toLowerCase() === codeRaw.toLowerCase(),
    );
  }

  let byCnic: ImportEntry | undefined;
  if (normalizedCnic) {
    byCnic = entries.find((entry) => entry.employee.cnic === normalizedCnic);
  }

  if (byCode && byCnic && byCode.id !== byCnic.id) {
    throw new Error(
      `"Employee Code" ("${codeRaw}") and "CNIC" ("${cnicRaw}") identify two different employees — they must match the same one`,
    );
  }

  const match = byCode ?? byCnic;
  if (!match) {
    throw new Error('No payroll entry found in this cycle for the given Employee Code/CNIC');
  }
  return match;
}

/** Blank ⇒ "leave unchanged" (`undefined`); anything else ⇒ the trimmed string, so a legitimate
 * "0" is never mistaken for a blank cell (a plain `||` fallback would do exactly that, which
 * would have been a real bug for zero-valued Days/Fine/Advance/etc. rows). */
function cell(row: ParsedRow, column: string): string | undefined {
  const value = row.cells[column]?.trim() ?? '';
  return value === '' ? undefined : value;
}

/** Blank ⇒ "leave unchanged" (`undefined`); `"yes"` (case-insensitive) ⇒ `true`; anything else
 * non-blank ⇒ `false`. */
function cellYesNo(row: ParsedRow, column: string): boolean | undefined {
  const value = cell(row, column);
  if (value === undefined) return undefined;
  return value.toLowerCase() === 'yes';
}

/**
 * Imports parsed rows into an already-existing cycle's `PayrollEntry` rows — **update-only, per
 * the approved architecture (Phase 3 Checkpoint 5)**: this never creates a `PayrollEntry` or
 * `PayrollEntryWorkLine`, never bootstraps an employee into the cycle, never modifies `siteId`
 * (permanently non-editable, `database/payroll-entry.md` §12's 2026-07-07 decision, unchanged),
 * and never modifies `released`/`releasedAt`/`releasedBy` — the exported `Released` column is
 * read-only/informational, never parsed back into a write. A row for an already-released entry is
 * rejected by the same `assertEntryEditable()` every single-row edit path already enforces, not a
 * reimplementation of that rule.
 *
 * **Editability (corrected 2026-07-14, Phase 5 Checkpoint 1 final review; extended 2026-07-15,
 * Phase 5 Checkpoint 4):** does not gate the whole import on `cycle.status` up front — a held,
 * unreleased entry stays reachable by this importer after its cycle finalizes (`RELEASED`), exactly
 * as any single-entity edit would (`assertEntryEditable`, `database/payroll-entry.md §12`).
 * Editability is enforced per row, below, the same as always; once the cycle is `ARCHIVED`,
 * `assertEntryEditable` now rejects every row regardless of `released`, so an import against an
 * Archived cycle skips every row with the same per-row "locked" reason an ordinary edit would give.
 *
 * Each row is validated and applied independently — one bad row is skipped and reported, never a
 * whole-file failure (`reference/PROJECT_SPEC.md`'s own explicit requirement for this importer,
 * matching Employee Registry's established precedent). Field validation reuses
 * `updatePayrollEntrySchema`/`updateWorkLineSchema` (minus `version`) rather than redefining the
 * same rules a second time; the field→Prisma-payload mapping reuses
 * `mapUpdateInputToEntryData`/`mapUpdateInputToWorkLineData` from `payroll-entry.service.ts`, the
 * exact functions the ordinary single-row PATCH routes use.
 *
 * **Optimistic locking (approved Checkpoint 4 administrative-bulk-operation precedent, not a new
 * exception): no per-row `version` is required in the file and none is checked before writing** —
 * every successful row write still increments `PayrollEntry.version`, so any row concurrently open
 * in the grid (an in-flight autosave, an open Split modal) correctly 409s on its own next save
 * against the now-stale version it holds. This mirrors `bulkUpdatePayrollEntries` exactly: an
 * administrative sweep never pre-checks a version on the way in, but never silently loses a
 * genuinely concurrent single-row edit either.
 *
 * One summary `AuditLog` entry is written by the route handler for the whole operation (Employee
 * Registry's `employee.import` precedent) — never one per row.
 */
export async function importPayrollEntries(
  currentUser: SessionUser,
  cycleId: string,
  rows: ParsedRow[],
): Promise<PayrollEntryImportResult> {
  // Confirms the cycle exists (404 otherwise) and captures its status for the per-row editability
  // check below; see this function's own doc comment.
  const cycle = await getPayrollCycle(cycleId);

  const entries = await prisma.payrollEntry.findMany({
    where: { cycleId },
    include: { employee: true, workLines: { orderBy: { sortOrder: 'asc' } } },
  });

  let updated = 0;
  const skipped: ImportRowError[] = [];

  for (const row of rows) {
    try {
      const entry = resolveRowEntry(row, entries);

      assertSiteAccess(currentUser, entry.siteId);
      assertEntryEditable({ released: entry.released, cycle: { status: cycle.status } });

      const primaryLine = entry.workLines[0]!;

      const entryInput = updatePayrollEntrySchema.omit({ version: true }).parse({
        designation: cell(row, 'Designation'),
        grossPay: cell(row, 'Gross Pay'),
        allowance: cell(row, 'Allowance'),
        leaveDays: cell(row, 'Leave'),
        leaveRate: cell(row, 'Leave Rate') ?? null,
        eobiAmount: cell(row, 'EOBI Amount'),
        eobiApplicable: cellYesNo(row, 'EOBI On'),
        advanceDeduction: cell(row, 'Advance'),
        eidAdvanceDeduction: cell(row, 'Eid Advance'),
        fine: cell(row, 'Fine'),
        hold: cellYesNo(row, 'Hold'),
      });

      const workLineInput = updateWorkLineSchema.omit({ version: true, unitId: true, sortOrder: true }).parse({
        days: cell(row, 'Days'),
        otHours: cell(row, 'OT Hrs'),
        otRate: cell(row, 'OT Rate') ?? null,
        cycleDays: cell(row, 'Cycle Days') ? Number(cell(row, 'Cycle Days')) : undefined,
      });

      const entryData = mapUpdateInputToEntryData(entryInput);
      const workLineData = mapUpdateInputToWorkLineData(workLineInput);

      await prisma.$transaction(async (tx) => {
        await tx.payrollEntry.update({
          where: { id: entry.id },
          data: { ...entryData, version: { increment: 1 } },
        });
        if (Object.keys(workLineData).length > 0) {
          await tx.payrollEntryWorkLine.update({ where: { id: primaryLine.id }, data: workLineData });
        }
      });

      updated += 1;
    } catch (error) {
      skipped.push({ row: row.rowNumber, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { updated, skipped };
}
