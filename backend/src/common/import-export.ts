import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';
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
