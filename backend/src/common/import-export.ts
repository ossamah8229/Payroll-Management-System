import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { stringify as stringifyCsvSync } from 'csv-stringify/sync';
import { toIsoDateOnly } from '@payroll/shared';
import { badRequest } from './http-error';

/** A single skipped/failed row from any import operation in this codebase — one shape, reused by
 * every module's `ImportResult` rather than redefined per module (Employee Registry, Payroll
 * Entry). */
export interface ImportRowError {
  row: number;
  reason: string;
}

/**
 * Parses an uploaded CSV or XLSX buffer into a raw `string[][]` table (header row included) — the
 * common half of every import parser in this codebase. Originally written for the Employee
 * Registry importer (Phase 2) and extracted here, unchanged, when Payroll Entry (Phase 3
 * Checkpoint 5) needed the identical CSV/XLSX-to-table logic for its own, differently-headered
 * import — each module still owns its own header validation and column-keyed row construction on
 * top of this (see `employees-import-export.service.ts`'s and
 * `payroll-entry-import-export.service.ts`'s own `rowsFromTable`).
 */
export async function parseTableFromFile(buffer: Buffer, filename: string): Promise<string[][]> {
  if (!filename.toLowerCase().endsWith('.xlsx')) {
    return parseCsvSync(buffer, { skip_empty_lines: true }) as string[][];
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

  return table;
}

/**
 * Cells whose content opens with one of these characters are interpreted as a formula by Excel,
 * Google Sheets, and LibreOffice Calc when the CSV is opened — the classic CSV/spreadsheet-formula-
 * injection vector (OWASP). Every free-text field this codebase exports (employee/site/unit name,
 * designation, remarks, the company name pulled into Cash Receiving's document header) is
 * unrestricted-character user input at the schema level, so this is a genuine surface, not a
 * theoretical one — the same reasoning `lib/pdf/html-escape.ts`'s `escapeHtml` already documents
 * for the PDF layer.
 */
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Neutralizes a single CSV cell against formula injection without touching legitimate content.
 * Only strings are ever at risk (numbers/booleans/nullish values can't carry a formula), and a
 * value that parses as a genuine number — most commonly a negative monetary figure — is left
 * untouched: prefixing it would corrupt the export's own numeric formatting for the one case this
 * codebase actually needs a leading "-" to mean "negative," not "formula." Everything else that
 * opens with a trigger character is prefixed with a leading apostrophe, the standard neutralization
 * every major spreadsheet application renders as literal text rather than evaluating.
 */
export function sanitizeCsvCell<T>(value: T): T | string {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (!FORMULA_TRIGGER_CHARS.has(value.charAt(0))) return value;
  if (value.trim().length > 0 && !Number.isNaN(Number(value))) return value;
  return `'${value}`;
}

/**
 * The one CSV-serialization entry point every export in this codebase must use — a thin wrapper
 * around `csv-stringify` that runs every cell through `sanitizeCsvCell` first. Introduced as a
 * security correction (formula-injection finding) once every existing CSV export (Employee
 * Registry, Payroll Entry, Bank Sheet — including its combined Backup Package variant — and Cash
 * Receiving) was found calling `csv-stringify` directly with unsanitized free text. XLSX exports
 * are not affected — ExcelJS writes each value into a typed cell rather than a line of text a
 * spreadsheet application re-parses, so the formula-injection vector doesn't apply there.
 */
export function stringifyCsvSafe(rows: readonly (readonly unknown[])[]): string {
  return stringifyCsvSync(rows.map((row) => row.map(sanitizeCsvCell)));
}
