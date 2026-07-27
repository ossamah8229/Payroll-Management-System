import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import { sumMoney } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { stringifyCsvSafe } from '../../common/import-export';
import { assertSiteAccess, isMasterAdmin } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { computeEntryCalc } from '../payroll-entry/payroll-entry.service';

/**
 * Bank Sheets (Phase 4 Checkpoint 3, docs/architecture/database/relationships.md §"Bank Sheets,
 * Cash Receiving... have no tables of their own — they are query modules"). Purely derived,
 * read-only: every row is computed live from `PayrollEntry`'s own already-frozen columns, never
 * stored anywhere. `Amount = PayrollEntry.netSalary ± settling BalanceAdjustments`
 * (`docs/architecture/workflows/corrections-and-balance-adjustments.md`) — `BalanceAdjustment`
 * doesn't exist yet (Phase 6), so `Amount = netSalary` exactly for now, the same documented gap
 * Phase 4 Checkpoint 2 already left for the release sweep.
 *
 * **Scope decision (explicit, Phase 4 Checkpoint 3):** rather than building the frozen
 * architecture's separate future "Cash Receiving" module (`docs/architecture/overview.md`), this
 * checkpoint implements one unified Bank Sheet feature whose bank filter accepts either a real,
 * active `Bank` or the `CASH_BANK_FILTER` sentinel (employees with no bank account on file) — per
 * this checkpoint's own explicit scope instruction ("filtering by every active supported Bank and
 * Cash... this is generation filtering, not release filtering"). A dedicated Cash Receiving module
 * remains future work, not built here.
 *
 * **The release boundary is untouched and unreopened** — this module only ever *reads*
 * `PayrollEntry.released` (set exclusively by `payroll-release.service.ts`'s per-Project-Unit
 * sweep, Checkpoint 2); it never writes it, and never gates on `PayrollCycle.status`, since a Unit
 * can release — and its Bank Sheet become generatable — while the cycle as a whole is still Draft
 * (`docs/IMPLEMENTATION_PLAN.md` Phase 4: "generated per Unit-release event, not only per
 * whole-Cycle release").
 */

export const CASH_BANK_FILTER = 'cash';

export interface BankSheetRow {
  entryId: string;
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  employeeName: string;
  siteId: string;
  siteName: string;
  designation: string;
  bankId: string | null;
  /** Bank Code only, not the full Bank Name — the approved Bank display rule (2026-07-13): a
   * dense transaction table displays the Code specifically so the column stays compact without
   * losing meaning. The full name remains available via `bankId` → Settings → Banks if ever
   * needed; `getBankSheet`'s own `bankLabel` (the whole sheet's single selected bank) still uses
   * the full name, since that is a one-time filter-selection descriptor, not a dense grid cell. */
  bankCode: string | null;
  branchCode: string | null;
  accountNumber: string | null;
  iban: string | null;
  /** Banking refinement (2026-07-11): **derived, never stored** — the frozen client Bank Sheet
   * format (`reference/PROJECT_SPEC.md`, "Sample Bank Sheet Format") requires a "Title of Account"
   * column; Account Title itself is no longer a stored field anywhere, so this is always exactly
   * the entry's own frozen `employee.name` snapshot, never a separately-entered/stored string. */
  accountTitle: string;
  netSalary: string;
  releasedAt: string | null;
}

export interface BankSheetResult {
  bankFilter: string;
  bankLabel: string;
  rows: BankSheetRow[];
  totalNetSalary: string;
}

async function resolveBankFilter(
  bankFilter: string,
): Promise<{ bankId: string | null; label: string; code: string | null }> {
  if (bankFilter === CASH_BANK_FILTER) {
    return { bankId: null, label: 'Cash', code: null };
  }

  const bank = await prisma.bank.findUnique({ where: { id: bankFilter } });
  if (!bank) {
    throw notFound('Bank not found');
  }
  if (!bank.isActive) {
    throw badRequest('Cannot generate a Bank Sheet for an inactive bank');
  }

  // `label` (the full name) is still used for the whole sheet's one-time filter-selection
  // descriptor (`bankLabel`, export filenames, audit log) — a selection context, not a dense grid
  // cell, so it keeps the same "clarity is useful" treatment as Employee Registry's own dropdown.
  return { bankId: bank.id, label: bank.name, code: bank.code };
}

type EntryForSheet = Prisma.PayrollEntryGetPayload<{
  include: { employee: true; site: true; workLines: true };
}>;

function buildRow(entry: EntryForSheet, bankCode: string | null): BankSheetRow {
  return {
    entryId: entry.id,
    employeeId: entry.employeeId,
    employeeCode: entry.employee.employeeCode,
    cnic: entry.employee.cnic,
    employeeName: entry.employee.name,
    siteId: entry.siteId,
    siteName: entry.site.name,
    // designation/bank fields below are read exclusively from PayrollEntry's own frozen columns
    // (copied at entry-creation/edit time, immutable once released, docs/architecture/database/
    // payroll-entry.md §12) — never from Employee's current record, so a later employee edit can
    // never alter a previously released Bank Sheet (this checkpoint's own explicit requirement).
    designation: entry.designation,
    bankId: entry.bankId,
    bankCode: entry.bankId ? bankCode : null,
    branchCode: entry.branchCode,
    accountNumber: entry.accountNumber,
    iban: entry.iban,
    // "Title of Account" (2026-07-11 refinement) — derived from the employee's own name, never a
    // separately stored field. `entry.employee.name` is read here rather than `entry.designation`'s
    // sibling frozen columns because `Employee.name` itself has no PayrollEntry-level snapshot copy
    // (only banking/designation/site fields do, per §12) — an employee's legal name is not expected
    // to change the way a bank account might, so this one field is intentionally read live.
    accountTitle: entry.employee.name,
    netSalary: computeEntryCalc(entry).netSalary,
    releasedAt: entry.releasedAt?.toISOString() ?? null,
  };
}

/**
 * Resolves the site filter exactly like `payroll-entry-import-export.service.ts`'s
 * `resolveExportEntries` does — an explicit `siteIds` list (each independently
 * `assertSiteAccess`-checked) or, when omitted, every site the caller is assigned to (Master User:
 * unrestricted).
 */
async function resolveSiteIdFilter(currentUser: SessionUser, siteIds?: string[]): Promise<string[] | undefined> {
  if (siteIds) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
    return siteIds;
  }
  return !isMasterAdmin(currentUser) ? currentUser.siteIds : undefined;
}

/**
 * The single query this whole module is built on — released-only, non-held, one bank/Cash filter,
 * one row per employee (`PayrollEntry`'s own `(cycleId, employeeId)` uniqueness). Used identically
 * by the on-screen view and both export formats below, so there is exactly one implementation of
 * "which rows belong on this Bank Sheet," never a second one for exports (this checkpoint's own
 * "no duplicate business logic" instruction).
 */
export async function getBankSheet(
  currentUser: SessionUser,
  cycleId: string,
  bankFilter: string,
  siteIds?: string[],
): Promise<BankSheetResult> {
  await getPayrollCycle(cycleId); // 404s cleanly if the cycle doesn't exist
  const { bankId, label, code } = await resolveBankFilter(bankFilter);
  const siteIdFilter = await resolveSiteIdFilter(currentUser, siteIds);

  const entries = await prisma.payrollEntry.findMany({
    where: {
      cycleId,
      // Bank Sheets are generated only from released payroll, never Draft (this checkpoint's own
      // explicit rule) — `hold: false` is redundant given the release sweep already excludes held
      // entries (Checkpoint 2), but stated explicitly to match the frozen architecture's own
      // "released, non-held" phrasing rather than relying on an implicit derived guarantee.
      released: true,
      hold: false,
      bankId,
      ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    },
    include: { employee: true, site: true, workLines: { orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ site: { name: 'asc' } }, { sortOrder: 'asc' }],
  });

  // Negative Payroll Recovery checkpoint (2026-07-26) — defense-in-depth, not the primary guard:
  // going forward, `released = true` is only ever set for `netSalary > 0` (`payroll-release.service.ts`),
  // so this filter should never actually drop anything new. It exists so a pre-existing bad row
  // (a negative-net entry marked `released` before this checkpoint shipped) can never resurface as
  // a payable Bank Sheet row if a historical cycle's sheet is ever regenerated — Bank Sheet totals
  // must never include a zero/negative payable amount (Part A5), with no netting against any other
  // employee's total.
  const rows = entries.map((entry) => buildRow(entry, code)).filter((row) => Number(row.netSalary) > 0);

  return {
    bankFilter,
    bankLabel: label,
    rows,
    totalNetSalary: sumMoney(rows.map((row) => row.netSalary)),
  };
}

export const BANK_SHEET_HEADERS = [
  'Employee Code',
  'CNIC',
  'Employee Name',
  'Site',
  'Designation',
  'Bank',
  'Branch Code',
  'Account Number',
  'IBAN',
  'Account Title',
  'Net Salary',
] as const;

export function buildExportRow(row: BankSheetRow): string[] {
  return [
    row.employeeCode ?? '',
    row.cnic ?? '',
    row.employeeName,
    row.siteName,
    row.designation,
    row.bankCode ?? 'Cash',
    row.branchCode ?? '',
    row.accountNumber ?? '',
    row.iban ?? '',
    row.accountTitle,
    row.netSalary,
  ];
}

/**
 * A column's width from its actual exported content — the permanent Dynamic Width Rule
 * (2026-07-13): "do not assign arbitrary widths... every column must expand according to the
 * longest visible header or value it contains." ExcelJS has no native content-driven auto-width
 * (unlike an HTML `<table>`'s own `table-layout: auto`), so this is the closest equivalent: the
 * longest of the header and every exported row's value for that column, in ExcelJS's own
 * character-count width unit, plus a small margin — never a manually guessed number.
 */
function excelColumnWidth(header: string, values: string[]): number {
  const longest = values.reduce((max, value) => Math.max(max, value.length), header.length);
  return longest + 3;
}

export interface BankSheetExportResult {
  buffer: Buffer;
  rowCount: number;
  bankLabel: string;
}

export async function exportBankSheetToCsv(
  currentUser: SessionUser,
  cycleId: string,
  bankFilter: string,
  siteIds?: string[],
): Promise<BankSheetExportResult> {
  const sheet = await getBankSheet(currentUser, cycleId, bankFilter, siteIds);
  const rows = sheet.rows.map(buildExportRow);
  const totalRow = ['', '', '', '', '', '', '', '', '', 'Total', sheet.totalNetSalary];
  const csv = stringifyCsvSafe([
    BANK_SHEET_HEADERS as unknown as string[],
    ...rows,
    ...(rows.length > 0 ? [totalRow] : []),
  ]);
  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: sheet.rows.length, bankLabel: sheet.bankLabel };
}

export async function exportBankSheetToXlsx(
  currentUser: SessionUser,
  cycleId: string,
  bankFilter: string,
  siteIds?: string[],
): Promise<BankSheetExportResult> {
  const sheet = await getBankSheet(currentUser, cycleId, bankFilter, siteIds);
  const rows = sheet.rows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Bank Sheet');
  worksheet.addRow(BANK_SHEET_HEADERS as unknown as string[]);
  for (const row of rows) worksheet.addRow(row);
  worksheet.getRow(1).font = { bold: true };

  if (rows.length > 0) {
    const totalRow = worksheet.addRow(['', '', '', '', '', '', '', '', '', 'Total', sheet.totalNetSalary]);
    totalRow.font = { bold: true };
  }

  // Never truncate a business-critical identifier — the permanent Layout Integrity Rule. Every
  // column's width is computed from its own actual exported content (`excelColumnWidth`, above),
  // not a manually guessed number (corrected 2026-07-13 — a fixed pixel/character guess is exactly
  // what the Dynamic Width Rule removes, even one with generous margin). Net Salary (column 11) is
  // deliberately excluded — its right-aligned monetary format reads fine at ExcelJS's own default
  // width, and totals/individual values are short enough that this was never the constrained one.
  BANK_SHEET_HEADERS.forEach((header, index) => {
    if (header === 'Net Salary') return;
    const columnValues = rows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: sheet.rows.length, bankLabel: sheet.bankLabel };
}

export interface CombinedBankSheetResult {
  buffer: Buffer;
  rowCount: number;
}

/**
 * Backup Packages (Phase 5 Checkpoint 2) — one combined Bank Sheets CSV spanning every active Bank
 * plus Cash, for the whole cycle. **Deliberately not a new query/calculation path**: this loops
 * `getBankSheet()` (this module's own single query+calc implementation, above) once per active
 * Bank and once for Cash, reusing its rows, `buildExportRow`'s exact formatting, and
 * `BANK_SHEET_HEADERS`'s exact columns unchanged — the only new logic here is concatenation and one
 * combined grand total, matching the architecture review's explicit "do not introduce a second
 * calculation path" instruction.
 */
export async function buildCombinedBankSheetCsv(
  currentUser: SessionUser,
  cycleId: string,
): Promise<CombinedBankSheetResult> {
  const activeBanks = await prisma.bank.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  const bankFilters = [...activeBanks.map((bank) => bank.id), CASH_BANK_FILTER];

  const allRows: BankSheetRow[] = [];
  for (const bankFilter of bankFilters) {
    const sheet = await getBankSheet(currentUser, cycleId, bankFilter);
    allRows.push(...sheet.rows);
  }

  const exportRows = allRows.map(buildExportRow);
  const totalNetSalary = sumMoney(allRows.map((row) => row.netSalary));
  const totalRow = ['', '', '', '', '', '', '', '', '', 'Total', totalNetSalary];
  const csv = stringifyCsvSafe([
    BANK_SHEET_HEADERS as unknown as string[],
    ...exportRows,
    ...(exportRows.length > 0 ? [totalRow] : []),
  ]);

  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: allRows.length };
}
