/**
 * Shared ExcelJS presentation helpers used by every module's XLSX export. Extracted (Phase 7
 * Reports, Employee Payroll History Checkpoint 1A) from three independent, byte-identical copies
 * (`bank-sheets.service.ts`, `reports.service.ts`, `statements.service.ts`) once a third/fourth
 * consumer (this checkpoint's Employee Payroll History export) made "duplicate again" the wrong
 * call — per this project's standing "grep for duplicates on new shared utility" rule.
 *
 * Behavior-preserving: identical formula (`longest + 3`) to every prior copy, so no export's
 * column widths change as a result of this extraction.
 */

/** The Dynamic Width Rule (2026-07-13): every column's width comes from its own longest exported
 * value (header included), plus a small margin — never a manually guessed number, so a
 * business-critical identifier is never visually truncated in the spreadsheet. */
export function excelColumnWidth(header: string, values: string[]): number {
  const longest = values.reduce((max, value) => Math.max(max, value.length), header.length);
  return longest + 3;
}
