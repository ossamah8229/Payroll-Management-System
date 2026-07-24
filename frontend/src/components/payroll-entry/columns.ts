import { calcNet, formatMoney } from '@payroll/shared';
import type { Bank } from '@/hooks/use-banks';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { buildCalcInput } from './calc-input';
import { measureColumnWidth } from './measure-column-width';

export type ColumnAlign = 'left' | 'center' | 'right';

export interface PayrollColumnDef {
  id: string;
  label: string;
  align?: ColumnAlign;
  /** Groups columns under one shared header label (e.g. "Bank Details", "EOBI") — purely visual. */
  group?: string;
  /** A true fixed-width UI control (a toggle switch, the serial/save-status column, the Units pill
   * button) — not text-content-driven, so dynamic measurement doesn't apply; this is the control's
   * own intrinsic/decided size, the "unless a true fixed width is required by a control" exception
   * the permanent Layout Integrity Rule (2026-07-13) explicitly allows. Every other column is
   * measured dynamically from the full loaded dataset via `computeColumnWidths` below — never a
   * manually guessed pixel number for business-identifier or monetary content. */
  fixedWidth?: number;
  /** Minimum width floor for a dynamically-measured column — never narrower even when the loaded
   * dataset is empty or every current value happens to be short, so the header stays readable and
   * the grid doesn't visibly jump when the first long value appears later. */
  minWidth?: number;
}

export interface ResolvedPayrollColumnDef extends PayrollColumnDef {
  width: number;
}

/**
 * Every Payroll Entry column defined by the frozen architecture (docs/architecture/
 * database/payroll-entry.md §12/§12a) that this checkpoint's grid exposes. A single flat array
 * (rather than CSS table auto-layout) is what keeps the sticky header, virtualized body, and
 * sticky totals row's columns pixel-aligned with each other — all three render from the same
 * *resolved* array (`computeColumnWidths`, below), so there is exactly one place column widths are
 * decided, and it is content-driven, not a hardcoded guess (permanent Layout Integrity Rule,
 * corrected 2026-07-13 — a fixed-pixel guess is exactly the defect this correction removes).
 */
export const PAYROLL_COLUMNS: PayrollColumnDef[] = [
  // Fixed: a status icon + row number, not loaded text content.
  { id: 'serial', label: '#', align: 'center', fixedWidth: 60 },
  // Fixed: a Released badge + Correction/History actions, not loaded text content (Corrections
  // workflow completion, System-Wide RBAC Consistency remediation follow-up) — placed right after
  // the serial column so a released row's locked status and its available actions are visible
  // without scrolling right in an otherwise very wide grid.
  { id: 'status', label: 'Status', align: 'center', fixedWidth: 150 },
  { id: 'employeeCode', label: 'Code', minWidth: 70 },
  { id: 'employeeName', label: 'Employee', minWidth: 110 },
  { id: 'designation', label: 'Designation', minWidth: 100 },
  { id: 'site', label: 'Site', minWidth: 90 },
  // Bank Code only in this dense grid, per the approved Bank display rule (2026-07-13) — the full
  // Bank Name stays in Employee Registry's own dropdown, where users need it to pick the right one.
  { id: 'bankId', label: 'Bank', group: 'Bank Details', minWidth: 60 },
  { id: 'branchCode', label: 'Branch Code', group: 'Bank Details', minWidth: 80 },
  { id: 'accountNumber', label: 'Account No.', group: 'Bank Details', minWidth: 100 },
  { id: 'iban', label: 'IBAN', group: 'Bank Details', minWidth: 100 },
  { id: 'grossPay', label: 'Gross Pay', align: 'right', minWidth: 80 },
  // Fixed: a button showing "N {unitLabel}", not raw loaded text — its own intrinsic control size.
  { id: 'units', label: 'Units', align: 'center', fixedWidth: 100 },
  { id: 'days', label: 'Working Days', align: 'right', minWidth: 70 },
  { id: 'otHours', label: 'OT Hours', align: 'right', minWidth: 70 },
  { id: 'otRate', label: 'OT Rate', align: 'right', minWidth: 70 },
  { id: 'cycleDays', label: 'Cycle Days', align: 'right', minWidth: 70 },
  { id: 'leaveDays', label: 'Leave Days', align: 'right', minWidth: 70 },
  { id: 'leaveRate', label: 'Leave Rate', align: 'right', minWidth: 75 },
  { id: 'allowance', label: 'Allowance', align: 'right', minWidth: 80 },
  { id: 'eobiAmount', label: 'Amount', group: 'EOBI', align: 'right', minWidth: 70 },
  // Fixed: a toggle switch, not loaded text content.
  { id: 'eobiApplicable', label: 'Applicable', group: 'EOBI', align: 'center', fixedWidth: 80 },
  { id: 'advanceDeduction', label: 'Advance Ded.', align: 'right', minWidth: 90 },
  { id: 'eidAdvanceDeduction', label: 'Eid Advance Ded.', align: 'right', minWidth: 95 },
  { id: 'fine', label: 'Fine', align: 'right', minWidth: 70 },
  // Fixed: a toggle switch, not loaded text content.
  { id: 'hold', label: 'Hold', align: 'center', fixedWidth: 70 },
  { id: 'remarks', label: 'Remarks', minWidth: 120 },
  { id: 'netSalary', label: 'Net Salary', align: 'right', minWidth: 90 },
];

/** One column's rendered text for a given entry — must match exactly what `payroll-entry-row.tsx`
 * actually displays for that cell, or the measured width would silently drift from reality. Reads
 * each entry's own *stored* server values (never a live, not-yet-saved draft) — the grid resizing
 * mid-keystroke as someone types would be its own usability problem; `computeColumnWidths` is
 * re-run only when the loaded `entries` array itself changes (a fetch or a save), not per edit. */
function extractColumnValue(columnId: string, entry: PayrollEntry, bankCodeById: Map<string, string>): string {
  const primaryLine = entry.workLines[0];
  switch (columnId) {
    case 'employeeCode':
      return entry.employee.employeeCode ?? '';
    case 'employeeName':
      return entry.employee.name;
    case 'designation':
      return entry.designation;
    case 'site':
      return entry.site.name;
    case 'bankId':
      return entry.bankId ? (bankCodeById.get(entry.bankId) ?? '') : 'Cash';
    case 'branchCode':
      return entry.branchCode ?? '';
    case 'accountNumber':
      return entry.accountNumber ?? '';
    case 'iban':
      return entry.iban ?? '';
    case 'grossPay':
      return entry.grossPay;
    case 'days':
      return primaryLine?.days ?? '';
    case 'otHours':
      return primaryLine?.otHours ?? '';
    case 'otRate':
      return primaryLine?.otRate ?? 'auto';
    case 'cycleDays':
      return primaryLine ? String(primaryLine.cycleDays) : '';
    case 'leaveDays':
      return entry.leaveDays;
    case 'leaveRate':
      return entry.leaveRate ?? 'auto';
    case 'allowance':
      return entry.allowance;
    case 'eobiAmount':
      return entry.eobiAmount;
    case 'advanceDeduction':
      return entry.advanceDeduction;
    case 'eidAdvanceDeduction':
      return entry.eidAdvanceDeduction;
    case 'fine':
      return entry.fine;
    case 'remarks':
      return entry.remarks ?? '';
    case 'netSalary':
      // The one read-only, formatted (not raw-decimal) cell — matches ReadOnlyCell's own
      // `formatMoney(calc.netSalary)` exactly (payroll-entry-row.tsx), including the "PKR " prefix.
      return formatMoney(calcNet(buildCalcInput(entry)).netSalary);
    default:
      return '';
  }
}

/**
 * Resolves every column's real width from the full loaded `entries` array — not just whichever
 * rows the virtualizer currently has mounted (Layout Integrity Rule, corrected 2026-07-13: "the
 * sizing calculation must inspect the full loaded Payroll Entry dataset"). Returns one array,
 * reused as-is by the grouped header, the column header, every virtualized body row, and the
 * totals row (`gridTemplateColumns`/`totalGridWidth` below) — a single shared calculation, never
 * four independent ones that could drift out of alignment.
 */
export function computeColumnWidths(entries: PayrollEntry[], banks: Bank[]): ResolvedPayrollColumnDef[] {
  const bankCodeById = new Map(banks.map((b) => [b.id, b.code]));
  return PAYROLL_COLUMNS.map((column) => {
    if (column.fixedWidth !== undefined) {
      return { ...column, width: column.fixedWidth };
    }
    const values = entries.map((entry) => extractColumnValue(column.id, entry, bankCodeById));
    const width = measureColumnWidth({ header: column.label, values, minimumPx: column.minWidth });
    return { ...column, width };
  });
}

export function gridTemplateColumns(columns: ResolvedPayrollColumnDef[]): string {
  return columns.map((column) => `${column.width}px`).join(' ');
}

export function totalGridWidth(columns: ResolvedPayrollColumnDef[]): number {
  return columns.reduce((sum, column) => sum + column.width, 0);
}

/** Column ids that are plain text/number editable inputs and therefore participate in Arrow-key
 * grid navigation (`data-col` index). Toggle/select cells are included too — navigation just needs
 * to reach and focus them, not necessarily type into them the same way. */
export const NAVIGABLE_COLUMN_IDS = PAYROLL_COLUMNS.filter((c) =>
  ['designation', 'bankId', 'branchCode', 'accountNumber', 'iban', 'grossPay', 'days', 'otHours', 'otRate', 'cycleDays', 'leaveDays', 'leaveRate', 'allowance', 'eobiAmount', 'eobiApplicable', 'advanceDeduction', 'eidAdvanceDeduction', 'fine', 'hold', 'remarks'].includes(
    c.id,
  ),
).map((c) => c.id);
