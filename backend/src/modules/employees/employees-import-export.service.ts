import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { stringify as stringifyCsvSync } from 'csv-stringify/sync';
import { createEmployeeSchema, formatDate, pluralize, toIsoDateOnly } from '@payroll/shared';
import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../common/http-error';
import { assertSiteAccess, listEmployees } from './employees.service';

/**
 * The official Employee Registry template header set, in column order, extracted verbatim from
 * real client files (reference/PROJECT_SPEC.md, "Official Data Template") — this exact header set
 * is required, not a house style. Note the source template has two apparently-redundant pairs
 * ("Area" / "Area/Location", and a bare "Branch Code" alongside "Bank Branch Code") inherited from
 * the client's real spreadsheets; the mapping decisions below are documented per-column since nothing
 * in the spec disambiguates them further and this should be confirmed with the client, matching the
 * spirit of docs/architecture/database-schema.md §26.
 */
export const EMPLOYEE_TEMPLATE_HEADERS = [
  'Sr. No',
  'Project',
  'Employee Number/Code',
  'Religion',
  'Name',
  'Father Name',
  'CNIC',
  'DOB',
  'DOJ',
  'DOL',
  'Mobile Number',
  'Designation',
  'Area',
  'Branch Code',
  'Area/Location',
  'Project Bank',
  'Bank Branch Code',
  'Account Number',
  'Basic/Gross Pay',
] as const;

/**
 * Parses common date representations from real-world spreadsheets (`YYYY-MM-DD`, `DD/MM/YYYY`,
 * `DD-MM-YYYY`) into an ISO date string, or returns null for a blank cell. Throws for anything it
 * can't confidently parse, rather than guessing — an ambiguous date is a row error, not a silent
 * best-effort import.
 */
function parseImportDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const slashOrDash = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashOrDash) {
    const [, day, month, year] = slashOrDash;
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  }

  throw new Error(`Unrecognized date format: "${raw}"`);
}

async function buildExportRows(currentUser: SessionUser, siteIds?: string[]) {
  const employees = await listEmployees(currentUser, { siteIds });

  return employees.map((employee, index) => [
    String(index + 1),
    employee.site.name,
    employee.employeeCode ?? '',
    employee.religion ?? '',
    employee.name,
    employee.fatherName ?? '',
    employee.cnic ?? '',
    formatDate(employee.dateOfBirth),
    formatDate(employee.dateOfJoining),
    formatDate(employee.dateOfLeaving),
    employee.mobileNumber ?? '',
    employee.designation,
    employee.site.name, // "Area" — documented assumption: aliases Project, see header comment above
    // "Branch Code" — now the employee's own ProjectUnit.code (Phase 2.5 Checkpoint 2;
    // ProjectSite itself no longer owns a single branch code, see database-schema.md §8's revision
    // note). Full column remap (a dedicated Unit name/code export scheme) is Checkpoint 3 — this is
    // an interim, additive improvement using data Checkpoint 2 makes available on Employee.
    employee.unit.code ?? '',
    employee.site.name, // "Area/Location" — documented assumption: aliases Project, see above
    employee.bank?.name ?? '',
    employee.branchCode ?? '', // "Bank Branch Code" — the employee's own bank branch code
    employee.accountNumber ?? '',
    employee.grossPay.toString(),
  ]);
}

export async function exportEmployeesToCsv(currentUser: SessionUser, siteIds?: string[]): Promise<Buffer> {
  const rows = await buildExportRows(currentUser, siteIds);
  const csv = stringifyCsvSync([EMPLOYEE_TEMPLATE_HEADERS as unknown as string[], ...rows]);
  return Buffer.from(csv, 'utf-8');
}

export async function exportEmployeesToXlsx(currentUser: SessionUser, siteIds?: string[]): Promise<Buffer> {
  const rows = await buildExportRows(currentUser, siteIds);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Employee Registry');
  sheet.addRow(EMPLOYEE_TEMPLATE_HEADERS as unknown as string[]);
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
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
  const expected = EMPLOYEE_TEMPLATE_HEADERS as unknown as string[];
  const headerMatches = expected.every((column, index) => header[index] === column);
  if (!headerMatches) {
    throw badRequest(
      `Header row does not match the official Employee Registry template. Expected: ${expected.join(', ')}`,
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
export async function parseEmployeeImportFile(buffer: Buffer, filename: string): Promise<ParsedRow[]> {
  if (!filename.toLowerCase().endsWith('.xlsx')) {
    const table = parseCsvSync(buffer, { skip_empty_lines: true }) as string[][];
    return rowsFromTable(table);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw badRequest('The uploaded workbook has no sheets');

  const table: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      if (value === null || value === undefined) cells.push('');
      else if (value instanceof Date) cells.push(toIsoDateOnly(value));
      else if (typeof value === 'object' && 'text' in value) cells.push(String((value as { text: unknown }).text));
      else cells.push(String(value));
    });
    table.push(cells);
  });

  return rowsFromTable(table);
}

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: ImportRowError[];
}

/**
 * Imports parsed rows: matches an existing employee by CNIC first, then employee code, otherwise
 * creates a new one. Each row is validated and applied independently — one bad row is skipped and
 * reported, never a whole-file failure (per docs/IMPLEMENTATION_PLAN.md Phase 2 testing strategy).
 * A single summary audit log entry is written for the whole operation rather than one per row, to
 * keep the audit log readable for a bulk action instead of spammed with hundreds of near-identical
 * entries.
 *
 * **Interim Project Unit resolution (Phase 2.5 Checkpoint 2)**: the official template has no
 * dedicated Unit column yet — mapping `Area`/`Branch Code` onto `ProjectUnit` is Checkpoint 3's
 * job. Until then, a row's unit is resolved from its site alone: if the site has exactly one
 * `ProjectUnit`, that unit is used; if it has zero or more than one, the row is skipped with a
 * clear reason rather than guessing. This means re-importing an existing multi-unit employee
 * cannot yet target a specific unit — a known, narrow limitation Checkpoint 3 resolves.
 */
export async function importEmployees(currentUser: SessionUser, rows: ParsedRow[]): Promise<ImportResult> {
  const sites = await prisma.projectSite.findMany();
  const banks = await prisma.bank.findMany();
  const units = await prisma.projectUnit.findMany();
  const siteByName = new Map(sites.map((site) => [site.name.trim().toLowerCase(), site]));
  const bankByName = new Map(banks.map((bank) => [bank.name.trim().toLowerCase(), bank]));
  const unitsBySiteId = new Map<string, typeof units>();
  for (const unit of units) {
    unitsBySiteId.set(unit.siteId, [...(unitsBySiteId.get(unit.siteId) ?? []), unit]);
  }

  let created = 0;
  let updated = 0;
  const skipped: ImportRowError[] = [];

  for (const row of rows) {
    try {
      const projectName = row.cells['Project']!.toLowerCase();
      const site = siteByName.get(projectName);
      if (!site) {
        throw new Error(`Unknown project site: "${row.cells['Project']}"`);
      }

      assertSiteAccess(currentUser, site.id);

      const siteUnits = unitsBySiteId.get(site.id) ?? [];
      const unitLabelPlural = pluralize(site.unitLabel).toLowerCase();
      if (siteUnits.length === 0) {
        throw new Error(
          `Site "${site.name}" has no ${unitLabelPlural} — create one before importing employees for it`,
        );
      }
      if (siteUnits.length > 1) {
        throw new Error(
          `Site "${site.name}" has multiple ${unitLabelPlural} — column-based unit mapping is not yet available in this import (Phase 2.5 Checkpoint 3); assign a unit manually via the Employee Registry instead`,
        );
      }
      const unit = siteUnits[0]!;

      const bankName = row.cells['Project Bank'];
      const bank = bankName ? bankByName.get(bankName.toLowerCase()) : undefined;
      if (bankName && !bank) {
        throw new Error(`Unknown bank: "${bankName}"`);
      }

      const input = createEmployeeSchema.parse({
        employeeCode: row.cells['Employee Number/Code'] || null,
        cnic: row.cells['CNIC'] || null,
        name: row.cells['Name'],
        fatherName: row.cells['Father Name'] || null,
        religion: row.cells['Religion'] || null,
        dateOfBirth: parseImportDate(row.cells['DOB']!),
        mobileNumber: row.cells['Mobile Number'] || null,
        designation: row.cells['Designation'],
        siteId: site.id,
        unitId: unit.id,
        dateOfJoining: parseImportDate(row.cells['DOJ']!),
        grossPay: row.cells['Basic/Gross Pay'],
        bankId: bank?.id ?? null,
        branchCode: row.cells['Bank Branch Code'] || null,
        accountNumber: row.cells['Account Number'] || null,
      });

      const dateOfLeaving = parseImportDate(row.cells['DOL']!);

      const existing = row.cells['CNIC']
        ? await prisma.employee.findFirst({ where: { cnic: row.cells['CNIC'] } })
        : input.employeeCode
          ? await prisma.employee.findFirst({ where: { employeeCode: input.employeeCode } })
          : null;

      if (existing) {
        assertSiteAccess(currentUser, existing.siteId);
        await prisma.employee.update({
          where: { id: existing.id },
          data: { ...input, dateOfLeaving },
        });
        updated += 1;
      } else {
        await prisma.employee.create({ data: { ...input, dateOfLeaving } });
        created += 1;
      }
    } catch (error) {
      skipped.push({ row: row.rowNumber, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { created, updated, skipped };
}
