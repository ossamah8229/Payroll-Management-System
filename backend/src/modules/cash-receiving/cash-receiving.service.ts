import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import { sumMoney } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { stringifyCsvSafe } from '../../common/import-export';
import { assertSiteAccess, isMasterAdmin } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { computeEntryCalc } from '../payroll-entry/payroll-entry.service';

/**
 * Cash Receiving Sheets (Phase 4 Checkpoint 4, docs/architecture/database/relationships.md —
 * "Bank Sheets, Cash Receiving... have no tables of their own"). Purely derived, read-only, exactly
 * like Bank Sheets (`bank-sheets.service.ts`): every row is computed live from `PayrollEntry`'s own
 * already-frozen columns, never stored anywhere.
 *
 * **A deliberately separate module, not a bolt-on filter inside Bank Sheets** (approved architecture
 * decision) — the two documents have genuinely different shapes (this one carries no bank/account
 * columns at all, and a Signature/Remarks pair Bank Sheets doesn't need), even though they share the
 * same released/non-held query boundary and every calc/scope/export/audit primitive below.
 *
 * **Cash identification reuses Bank Sheets' own shipped, tested rule exactly: `bankId IS NULL`.**
 * `accountNumber` plays no role — deliberately not introduced here, per the approved decision to
 * never silently change this already-shipped classification behaviour.
 */

export interface CashReceivingRow {
  entryId: string;
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  employeeName: string;
  siteId: string;
  siteName: string;
  designation: string;
  netSalary: string;
  remarks: string | null;
}

export interface CashReceivingSheetResult {
  rows: CashReceivingRow[];
  totalNetSalary: string;
  totalEmployees: number;
}

type EntryForSheet = Prisma.PayrollEntryGetPayload<{
  include: { employee: true; site: true; workLines: true };
}>;

function buildRow(entry: EntryForSheet): CashReceivingRow {
  return {
    entryId: entry.id,
    employeeId: entry.employeeId,
    employeeCode: entry.employee.employeeCode,
    cnic: entry.employee.cnic,
    employeeName: entry.employee.name,
    siteId: entry.siteId,
    siteName: entry.site.name,
    // designation is read exclusively from PayrollEntry's own frozen column (copied at
    // entry-creation time, immutable once released) — never from Employee's current record,
    // matching Bank Sheets' own historical-snapshot guarantee exactly.
    designation: entry.designation,
    netSalary: computeEntryCalc(entry).netSalary,
    remarks: entry.remarks,
  };
}

/**
 * Resolves the site filter exactly like `bank-sheets.service.ts`'s own `resolveSiteIdFilter` does —
 * an explicit `siteIds` list (each independently `assertSiteAccess`-checked) or, when omitted, every
 * site the caller is assigned to (Master User: unrestricted).
 */
async function resolveSiteIdFilter(currentUser: SessionUser, siteIds?: string[]): Promise<string[] | undefined> {
  if (siteIds) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
    return siteIds;
  }
  return !isMasterAdmin(currentUser) ? currentUser.siteIds : undefined;
}

/**
 * The single query this whole module is built on — released-only, non-held, no-bank-account
 * (`bankId IS NULL`) employees only, one row per employee (`PayrollEntry`'s own `(cycleId,
 * employeeId)` uniqueness). Used identically by the on-screen view and both export formats below,
 * so there is exactly one implementation of "which rows belong on this sheet," matching Bank
 * Sheets' own "no duplicate business logic" precedent.
 */
export async function getCashReceivingSheet(
  currentUser: SessionUser,
  cycleId: string,
  siteIds?: string[],
): Promise<CashReceivingSheetResult> {
  await getPayrollCycle(cycleId); // 404s cleanly if the cycle doesn't exist
  const siteIdFilter = await resolveSiteIdFilter(currentUser, siteIds);

  const entries = await prisma.payrollEntry.findMany({
    where: {
      cycleId,
      // Cash Receiving Sheets are generated only from released payroll, never Draft, same rule as
      // Bank Sheets — `hold: false` is redundant given the release sweep already excludes held
      // entries, but stated explicitly to match the frozen architecture's "released, non-held"
      // phrasing rather than relying on an implicit derived guarantee.
      released: true,
      hold: false,
      bankId: null,
      ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    },
    include: { employee: true, site: true, workLines: { orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ site: { name: 'asc' } }, { sortOrder: 'asc' }],
  });

  const rows = entries.map(buildRow);

  return {
    rows,
    totalNetSalary: sumMoney(rows.map((row) => row.netSalary)),
    totalEmployees: rows.length,
  };
}

const CASH_RECEIVING_HEADERS = [
  'Serial No.',
  'Employee Code',
  'Employee Name',
  'CNIC',
  'Designation',
  'Site',
  'Net Salary',
  'Signature / Thumb Impression',
  'Remarks',
] as const;

function buildExportRow(row: CashReceivingRow, index: number): (string | number)[] {
  return [
    index + 1,
    row.employeeCode ?? '',
    row.employeeName,
    row.cnic ?? '',
    row.designation,
    row.siteName,
    row.netSalary,
    '',
    row.remarks ?? '',
  ];
}

export interface CashReceivingExportResult {
  buffer: Buffer;
  rowCount: number;
}

/** Document header/footer fields (Company / Payroll Cycle / Generation Date / Generated By /
 * Total Employees) the approved layout requires on the exported document — resolved once by the
 * route handler (it needs `CompanySettings` and the current cycle) and passed in here, rather than
 * this module reaching into other modules' tables directly. */
export interface CashReceivingDocumentMeta {
  companyName: string;
  cycleLabel: string;
  generatedByName: string;
  generatedAt: Date;
}

export async function exportCashReceivingSheetToCsv(
  currentUser: SessionUser,
  cycleId: string,
  meta: CashReceivingDocumentMeta,
  siteIds?: string[],
): Promise<CashReceivingExportResult> {
  const sheet = await getCashReceivingSheet(currentUser, cycleId, siteIds);
  const rows = sheet.rows.map(buildExportRow);
  const totalRow = ['', '', '', '', '', 'Total', sheet.totalNetSalary, '', ''];

  const csv = stringifyCsvSafe([
    [meta.companyName],
    [`Cash Receiving Sheet — ${meta.cycleLabel}`],
    [`Generated By: ${meta.generatedByName}`, `Generated On: ${meta.generatedAt.toLocaleString('en-US')}`],
    [],
    CASH_RECEIVING_HEADERS as unknown as string[],
    ...rows,
    ...(rows.length > 0 ? [totalRow] : []),
    [],
    [`Total Employees: ${sheet.totalEmployees}`],
  ]);

  return { buffer: Buffer.from(csv, 'utf-8'), rowCount: sheet.rows.length };
}

export async function exportCashReceivingSheetToXlsx(
  currentUser: SessionUser,
  cycleId: string,
  meta: CashReceivingDocumentMeta,
  siteIds?: string[],
): Promise<CashReceivingExportResult> {
  const sheet = await getCashReceivingSheet(currentUser, cycleId, siteIds);
  const rows = sheet.rows.map(buildExportRow);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Cash Receiving Sheet');

  worksheet.addRow([meta.companyName]).font = { bold: true, size: 13 };
  worksheet.addRow([`Cash Receiving Sheet — ${meta.cycleLabel}`]);
  worksheet.addRow([`Generated By: ${meta.generatedByName}`, `Generated On: ${meta.generatedAt.toLocaleString('en-US')}`]);
  worksheet.addRow([]);

  const headerRow = worksheet.addRow(CASH_RECEIVING_HEADERS as unknown as string[]);
  headerRow.font = { bold: true };

  for (const row of rows) worksheet.addRow(row);

  if (rows.length > 0) {
    const totalRow = worksheet.addRow(['', '', '', '', '', 'Total', sheet.totalNetSalary, '', '']);
    totalRow.font = { bold: true };
  }

  worksheet.addRow([]);
  worksheet.addRow([`Total Employees: ${sheet.totalEmployees}`]);

  // Layout Integrity (permanent rule): names, CNIC, and designation must never truncate; the
  // Signature/Thumb Impression column must keep enough reserved width to be physically usable for
  // a real signature once printed, not just wide enough for its own (otherwise blank) header text.
  worksheet.getColumn(3).width = 28; // Employee Name
  worksheet.getColumn(4).width = 18; // CNIC
  worksheet.getColumn(5).width = 20; // Designation
  worksheet.getColumn(8).width = 30; // Signature / Thumb Impression

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rowCount: sheet.rows.length };
}
