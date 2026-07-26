import ExcelJS from 'exceljs';
import { ZodError } from 'zod';
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

export interface ParseTableOptions {
  /** xlsx only: sheet names to look for, in priority order — the first one present in the
   * workbook is used, regardless of its tab position. Lets an importer target its real data sheet
   * by name (e.g. "Import Data") rather than assuming sheet order, per the Import Templates
   * checkpoint's Instructions/Import Data/Example workbook standard. */
  preferredSheetNames?: string[];
  /** xlsx only: sheet names to never treat as the data sheet when none of `preferredSheetNames`
   * matches — guarantees a template's "Instructions"/"Example" sheets are never parsed as data
   * even if the real data sheet was renamed and no longer matches `preferredSheetNames`. */
  excludeSheetNames?: string[];
}

function pickWorksheet(workbook: ExcelJS.Workbook, options: ParseTableOptions): ExcelJS.Worksheet {
  for (const name of options.preferredSheetNames ?? []) {
    const sheet = workbook.getWorksheet(name);
    if (sheet) return sheet;
  }

  const exclude = new Set(options.excludeSheetNames ?? []);
  const candidates = workbook.worksheets.filter((sheet) => !exclude.has(sheet.name));
  if (candidates.length === 0) {
    throw badRequest(
      `No data sheet found — expected a sheet named ${(options.preferredSheetNames ?? []).map((n) => `"${n}"`).join(' or ')}`,
    );
  }
  return candidates[0]!;
}

/**
 * Parses an uploaded CSV or XLSX buffer into a raw `string[][]` table (header row included) — the
 * common half of every import parser in this codebase. Originally written for the Employee
 * Registry importer (Phase 2) and extracted here, unchanged, when Payroll Entry (Phase 3
 * Checkpoint 5) needed the identical CSV/XLSX-to-table logic for its own, differently-headered
 * import — each module still owns its own header validation and column-keyed row construction on
 * top of this (see `employees-import-export.service.ts`'s and
 * `payroll-entry-import-export.service.ts`'s own `rowsFromTable`).
 *
 * `options` (Import Templates checkpoint) lets a caller pin down which worksheet is the real data
 * sheet by name instead of assuming index 0 — see `pickWorksheet` above. A CSV upload has no sheet
 * concept, so `options` is ignored for `.csv` files.
 */
export async function parseTableFromFile(
  buffer: Buffer,
  filename: string,
  options: ParseTableOptions = {},
): Promise<string[][]> {
  if (!filename.toLowerCase().endsWith('.xlsx')) {
    return parseCsvSync(buffer, { skip_empty_lines: true }) as string[][];
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  if (workbook.worksheets.length === 0) throw badRequest('The uploaded workbook has no sheets');
  const sheet = pickWorksheet(workbook, options);

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

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Shared Instructions/Import Data/Example import-template infrastructure (Import Templates
 * checkpoint, extended for Project Sites) — genuinely module-agnostic structural helpers, factored
 * out of the original Employee Registry implementation once a second module (Project Sites) needed
 * the identical workbook shape, header-diff logic, and row-error formatting. What stays here is
 * strictly "how to build/parse the standard workbook"; what a specific module's columns are, which
 * of them get a dropdown, and what business rule each row obeys all stay in that module's own
 * `*-import-export.service.ts` (docs/architecture/import-template-architecture.md). This is
 * deliberately not a single generic "run the whole import" function — each module still owns its
 * own `generateXImportTemplate`/`importX` orchestration, calling into these pieces rather than the
 * reverse.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The three standard sheet names every module's import template uses — literal, shared constants
 * rather than each module re-typing the same three strings, so a typo can never make one module's
 * "Import Data" sheet silently diverge from another's. */
export const STANDARD_INSTRUCTIONS_SHEET_NAME = 'Instructions';
export const STANDARD_IMPORT_DATA_SHEET_NAME = 'Import Data';
export const STANDARD_EXAMPLE_SHEET_NAME = 'Example';

export type ImportColumnRequirement = 'required' | 'optional' | 'conditional';

/**
 * One column's full contract: its Instructions "Column Guide" row, its Import Data header styling,
 * and (via `buildValidation` or the `dataType`/`maxLength`/`numericRange` defaults) its Excel data
 * validation. A module builds a `readonly ImportColumnSpec[]` describing every column in its
 * template, in header order, and passes it to the helpers below — the same array also drives the
 * module's own row-error formatting (`schemaField` → `formatImportValidationError`'s column map).
 */
export interface ImportColumnSpec {
  header: string;
  requirement: ImportColumnRequirement;
  dataType: 'text' | 'date' | 'number' | 'enum';
  /** Human-readable "Allowed Values / Format" cell for the Instructions Column Guide. */
  allowedFormat: string;
  maxLength?: number;
  /** `dataType: 'number'` only — the generic decimal validator's inclusive bounds. Omit to skip
   * Excel-side numeric validation for this column (still Zod/schema-validated server-side). */
  numericRange?: { min: number; max: number };
  example: string;
  notes: string;
  /** Forces the column to Excel's Text number format so a leading-zero identifier (a code, not a
   * quantity) survives ordinary spreadsheet editing instead of being silently read as a number. */
  preserveLeadingZeros?: boolean;
  /** The schema field this column feeds, when there's a 1:1 mapping — used to translate a Zod
   * validation issue's field path back into the template's own column name for row-error
   * reporting. Columns with no direct schema field omit this. */
  schemaField?: string;
  /** Overrides the generic per-`dataType` default validation — for a dropdown (needs a source
   * list) or a cross-field custom formula (needs sibling-cell references), neither of which the
   * generic defaults below can express without extra, module-specific context. `listRowCount` is
   * the only such context every caller gets for free (how many rows the module's own hidden
   * "Lists" sheet populated, `0` if it has none); anything else a formula needs (which columns to
   * reference) is baked into the closure the module builds. A `type: 'custom'` validation's
   * formula may contain the literal placeholder `{row}`, substituted with the real row number by
   * `withRowNumber` when applied. Return `undefined` to fall back to the generic default. */
  buildValidation?: (listRowCount: number) => ExcelJS.DataValidation | undefined;
}

export const IMPORT_REQUIREMENT_LABEL: Record<ImportColumnRequirement, string> = {
  required: 'Required',
  optional: 'Optional',
  conditional: 'Conditional',
};

/** Header fill colors — required columns get a distinct warm highlight, conditional columns a
 * cooler one, so "must fill this in" vs. "fill in at least one of this group" read differently at
 * a glance without relying on color alone (each also gets a header comment and an explicit
 * Required/Optional/Conditional row in the Instructions Column Guide). */
export const IMPORT_REQUIREMENT_FILL: Record<ImportColumnRequirement, string> = {
  required: 'FFFDE9C8',
  conditional: 'FFDCEBFB',
  optional: 'FFF2F2F2',
};

/** A generously wide, deliberately not-app-specific calendar bound for every `dataType: 'date'`
 * column's Excel validation — narrower than this would risk rejecting a genuine historical date
 * (an employee's DOB, say); the real business rule (if any) stays server-side. */
export const IMPORT_DATE_VALIDATION_RANGE: [Date, Date] = [
  new Date(Date.UTC(1900, 0, 1)),
  new Date(Date.UTC(2100, 11, 31)),
];

/** How many blank data rows an Import Data sheet's Excel validation/text-formatting is applied to
 * by default — generous enough for any single realistic bulk upload (including the ~600-site
 * Project Site onboarding case) while keeping the workbook a normal size. A caller with a larger
 * known need can override via `styleImportDataSheet`'s `dataRowCount` option. */
export const IMPORT_TEMPLATE_DATA_ROW_COUNT = 500;

/** Excel column letters A, B, C, … for the first 26 columns — every template built on this
 * infrastructure stays well under that. */
export function importColumnLetter(oneIndexedColumn: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + oneIndexedColumn - 1);
}

/**
 * The context-free default Excel validation for a column, derived purely from its own
 * `dataType`/`requirement`/`maxLength`/`numericRange` — text length (required columns also reject
 * blank via the same rule), a numeric range, or a date bound. Returns `undefined` for `'enum'`
 * (always needs a source list, so it always needs `buildValidation`) and for any column with no
 * expressible default (e.g. `dataType: 'text'` with no `maxLength`).
 */
export function buildGenericColumnValidation(column: ImportColumnSpec): ExcelJS.DataValidation | undefined {
  const errorTitle = `Invalid ${column.header}`;

  if (column.dataType === 'text') {
    if (!column.maxLength) return undefined;
    return {
      type: 'textLength',
      allowBlank: column.requirement !== 'required',
      operator: column.requirement === 'required' ? 'between' : 'lessThanOrEqual',
      formulae: column.requirement === 'required' ? [1, column.maxLength] : [column.maxLength],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle,
      error:
        column.requirement === 'required'
          ? `${column.header} is required (max ${column.maxLength} characters).`
          : `Maximum ${column.maxLength} characters.`,
    };
  }

  if (column.dataType === 'number' && column.numericRange) {
    const { min, max } = column.numericRange;
    return {
      type: 'decimal',
      allowBlank: column.requirement !== 'required',
      operator: 'between',
      formulae: [min, max],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle,
      error: `Enter a number between ${min} and ${max.toLocaleString('en-US')} (up to 2 decimal places).`,
    };
  }

  if (column.dataType === 'date') {
    return {
      type: 'date',
      allowBlank: true,
      operator: 'between',
      formulae: IMPORT_DATE_VALIDATION_RANGE,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle,
      error: 'Enter a valid date (DD-MM-YYYY).',
    };
  }

  return undefined;
}

/** Substitutes a `type: 'custom'` validation's `{row}` placeholder with the real row number being
 * applied — every other validation type is row-invariant and is returned as a shallow clone
 * (cheap, and avoids several hundred cells sharing one mutable object reference). */
export function withRowNumber(validation: ExcelJS.DataValidation, row: number): ExcelJS.DataValidation {
  if (validation.type !== 'custom') return { ...validation };
  return {
    ...validation,
    formulae: validation.formulae.map((formula) => String(formula).replace(/\{row\}/g, String(row))),
  };
}

/**
 * Styles a template's "Import Data" sheet in place: frozen header row, an autofilter across the
 * full header width, per-column width/leading-zero text formatting, required/conditional/optional
 * header fill + a comment stating the column's full rule, and — for every column with a
 * `buildValidation` override or an expressible generic default — Excel data validation applied to
 * every data row. The header row itself (`EMPLOYEE_TEMPLATE_HEADERS`-equivalent) must already be
 * written to row 1 before calling this.
 */
export function styleImportDataSheet(
  sheet: ExcelJS.Worksheet,
  columns: readonly ImportColumnSpec[],
  options: { listRowCount?: number; dataRowCount?: number } = {},
): void {
  const listRowCount = options.listRowCount ?? 0;
  const dataRowCount = options.dataRowCount ?? IMPORT_TEMPLATE_DATA_ROW_COUNT;

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = `A1:${importColumnLetter(columns.length)}1`;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.height = 20;

  columns.forEach((column, index) => {
    const columnIndex = index + 1;
    const excelColumn = sheet.getColumn(columnIndex);
    excelColumn.width = Math.max(14, Math.min(32, column.header.length + 4));
    if (column.preserveLeadingZeros) excelColumn.numFmt = '@';

    const headerCell = headerRow.getCell(columnIndex);
    headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IMPORT_REQUIREMENT_FILL[column.requirement] } };
    headerCell.alignment = { vertical: 'middle', wrapText: true };
    headerCell.note = `${IMPORT_REQUIREMENT_LABEL[column.requirement]}\n\n${column.allowedFormat}\n\n${column.notes}`;

    const validation = column.buildValidation?.(listRowCount) ?? buildGenericColumnValidation(column);
    if (!validation) return;
    for (let row = 2; row <= dataRowCount + 1; row += 1) {
      sheet.getCell(row, columnIndex).dataValidation = withRowNumber(validation, row);
    }
  });
}

/** Builds a template's "Example" sheet: the same header row (in the same order as `columns`) plus
 * exactly one fully-valid sample row taken from each column's own `example` value, with the same
 * leading-zero text formatting as the Import Data sheet. Structurally separate from Import Data on
 * purpose — see `parseTableFromFile`'s `excludeSheetNames`. */
export function buildExampleSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  headers: readonly string[],
  columns: readonly ImportColumnSpec[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow([...headers]);
  sheet.addRow(columns.map((column) => column.example));
  sheet.getRow(1).font = { bold: true };
  columns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    excelColumn.width = Math.max(14, Math.min(32, column.header.length + 4));
    if (column.preserveLeadingZeros) excelColumn.numFmt = '@';
  });
  return sheet;
}

/** Appends the standard "Column Guide" table (Column Name / Required? / Allowed Values-Format /
 * Max Length / Example / Notes) to an Instructions sheet — one row per column, in order, colored
 * to match its Required/Conditional/Optional fill. */
export function addColumnGuideTable(sheet: ExcelJS.Worksheet, columns: readonly ImportColumnSpec[]): void {
  const guideHeaderRow = sheet.addRow(['Column Name', 'Required?', 'Allowed Values / Format', 'Max Length', 'Example', 'Notes']);
  guideHeaderRow.font = { bold: true };
  guideHeaderRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
  });

  for (const column of columns) {
    const row = sheet.addRow([
      column.header,
      IMPORT_REQUIREMENT_LABEL[column.requirement],
      column.allowedFormat,
      column.maxLength ?? '—',
      column.example || '(blank)',
      column.notes,
    ]);
    row.alignment = { wrapText: true, vertical: 'top' };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IMPORT_REQUIREMENT_FILL[column.requirement] } };
  }
}

/** The four prose-writing primitives every module's Instructions sheet is built from — pure
 * formatting (bold/merge/wrap-text/row-height), never business content, so the mechanism is
 * shared while what each module actually writes (its own "What this import does" text, etc.)
 * stays in that module's own template generator. */
export interface InstructionsSheetWriter {
  addTitle: (text: string) => void;
  addSubheading: (text: string) => void;
  addParagraph: (text: string) => void;
  addBullet: (text: string) => void;
}

/** Creates a module's "Instructions" sheet with the standard 6-column width layout and returns
 * the prose-writing primitives above, ready to call in order. Call `addColumnGuideTable` at the
 * end to append the per-column Column Guide table. */
export function createInstructionsSheet(workbook: ExcelJS.Workbook, sheetName: string): { sheet: ExcelJS.Worksheet } & InstructionsSheetWriter {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 46;
  sheet.getColumn(4).width = 20;
  sheet.getColumn(5).width = 24;
  sheet.getColumn(6).width = 50;

  const addTitle = (text: string) => {
    const row = sheet.addRow([text]);
    row.font = { bold: true, size: 13 };
    sheet.mergeCells(row.number, 1, row.number, 6);
  };
  const addSubheading = (text: string) => {
    const row = sheet.addRow([text]);
    row.font = { bold: true, size: 11 };
    sheet.mergeCells(row.number, 1, row.number, 6);
  };
  const addParagraph = (text: string) => {
    const row = sheet.addRow([text]);
    row.alignment = { wrapText: true };
    sheet.mergeCells(row.number, 1, row.number, 6);
    row.height = Math.max(15, Math.ceil(text.length / 110) * 15);
  };
  const addBullet = (text: string) => addParagraph(`•  ${text}`);

  return { sheet, addTitle, addSubheading, addParagraph, addBullet };
}

export interface HeaderDiff {
  missing: string[];
  unexpected: string[];
  reordered: boolean;
}

/** Structural comparison between an uploaded header row and a template's expected header set — the
 * basis of `assertExactHeaderMatch`'s error message (identify exactly what differs, not just "the
 * header doesn't match"). */
export function diffHeaderRow(header: string[], expectedHeaders: readonly string[]): HeaderDiff {
  const expectedSet = new Set(expectedHeaders);
  const actualNonEmpty = header.filter((cell) => cell.length > 0);
  const actualSet = new Set(actualNonEmpty);

  const missing = expectedHeaders.filter((column) => !actualSet.has(column));
  const unexpected = actualNonEmpty.filter((cell) => !expectedSet.has(cell));
  const reordered =
    missing.length === 0 && unexpected.length === 0 && !expectedHeaders.every((column, index) => header[index] === column);

  return { missing, unexpected, reordered };
}

/**
 * Throws a `badRequest` naming exactly what's wrong (missing/unexpected/reordered columns) unless
 * `header` matches `expectedHeaders` both in content and position, with nothing extra trailing
 * past the expected length either (`expectedHeaders.every(...)` alone would silently accept a
 * trailing extra column, since `.every` never looks past its own array's length).
 */
export function assertExactHeaderMatch(
  header: string[],
  expectedHeaders: readonly string[],
  templateDisplayName: string,
  downloadHint: string,
): void {
  const exactMatch =
    expectedHeaders.every((column, index) => header[index] === column) &&
    header.slice(expectedHeaders.length).every((cell) => cell.length === 0);
  if (exactMatch) return;

  const { missing, unexpected, reordered } = diffHeaderRow(header, expectedHeaders);
  const problems: string[] = [];
  if (missing.length > 0) problems.push(`missing column(s): ${missing.map((c) => `"${c}"`).join(', ')}`);
  if (unexpected.length > 0) problems.push(`unexpected column(s): ${unexpected.map((c) => `"${c}"`).join(', ')}`);
  if (reordered) problems.push('columns are present but in the wrong order');
  const detail = problems.length > 0 ? problems.join('; ') : 'the header row does not match the official template';

  throw badRequest(
    `This file's columns do not match the current ${templateDisplayName} (${detail}). Your template may be out of date — ${downloadHint}, and do not rename, reorder, add, or remove columns on the "Import Data" sheet.`,
  );
}

/**
 * Turns a thrown validation error into a readable, column-named message for an Import Results
 * row — a `ZodError`'s own `.message` is a JSON-stringified issue array, not prose; surfacing that
 * raw would show a user something like `[{"code":"too_big","maximum":80,...}]` instead of
 * "Designation: String must contain at most 80 character(s)". `fieldToColumn` maps a schema field
 * path (e.g. `"designation"`) to its template column name (e.g. `"Designation"`) — every other
 * error path in an importer already throws a plain `Error` with a hand-written message and passes
 * through unchanged.
 */
export function formatImportValidationError(error: unknown, fieldToColumn: ReadonlyMap<string, string>): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => {
        const field = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : undefined;
        const column = field ? (fieldToColumn.get(field) ?? field) : undefined;
        return column ? `${column}: ${issue.message}` : issue.message;
      })
      .join('; ');
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
