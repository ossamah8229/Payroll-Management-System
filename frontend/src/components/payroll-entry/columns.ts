export type ColumnAlign = 'left' | 'center' | 'right';

export interface PayrollColumnDef {
  id: string;
  label: string;
  width: number;
  align?: ColumnAlign;
  /** Groups columns under one shared header label (e.g. "Bank Details", "EOBI") — purely visual. */
  group?: string;
}

/**
 * Every Payroll Entry column defined by the frozen architecture (docs/architecture/
 * database/payroll-entry.md §12/§12a) that this checkpoint's grid exposes. A fixed-width column model
 * (rather than CSS table auto-layout) is what keeps the sticky header, virtualized body, and
 * sticky totals row's columns pixel-aligned with each other — all three render from this same
 * array, so there is exactly one place column widths are defined.
 */
export const PAYROLL_COLUMNS: PayrollColumnDef[] = [
  { id: 'serial', label: '#', width: 60, align: 'center' },
  { id: 'employeeCode', label: 'Code', width: 90 },
  { id: 'employeeName', label: 'Employee', width: 170 },
  { id: 'designation', label: 'Designation', width: 140 },
  { id: 'site', label: 'Site', width: 130 },
  { id: 'bankId', label: 'Bank', width: 110, group: 'Bank Details' },
  { id: 'branchCode', label: 'Branch Code', width: 100, group: 'Bank Details' },
  { id: 'accountNumber', label: 'Account No.', width: 130, group: 'Bank Details' },
  { id: 'accountTitle', label: 'Account Title', width: 140, group: 'Bank Details' },
  { id: 'grossPay', label: 'Gross Pay', width: 105, align: 'right' },
  { id: 'units', label: 'Units', width: 100, align: 'center' },
  { id: 'days', label: 'Working Days', width: 95, align: 'right' },
  { id: 'otHours', label: 'OT Hours', width: 90, align: 'right' },
  { id: 'otRate', label: 'OT Rate', width: 90, align: 'right' },
  { id: 'cycleDays', label: 'Cycle Days', width: 90, align: 'right' },
  { id: 'leaveDays', label: 'Leave Days', width: 90, align: 'right' },
  { id: 'leaveRate', label: 'Leave Rate', width: 95, align: 'right' },
  { id: 'allowance', label: 'Allowance', width: 100, align: 'right' },
  { id: 'eobiAmount', label: 'Amount', width: 90, align: 'right', group: 'EOBI' },
  { id: 'eobiApplicable', label: 'Applicable', width: 80, align: 'center', group: 'EOBI' },
  { id: 'advanceDeduction', label: 'Advance Ded.', width: 110, align: 'right' },
  { id: 'eidAdvanceDeduction', label: 'Eid Advance Ded.', width: 115, align: 'right' },
  { id: 'fine', label: 'Fine', width: 90, align: 'right' },
  { id: 'hold', label: 'Hold', width: 70, align: 'center' },
  { id: 'remarks', label: 'Remarks', width: 180 },
  { id: 'netSalary', label: 'Net Salary', width: 120, align: 'right' },
];

export function gridTemplateColumns(columns: PayrollColumnDef[] = PAYROLL_COLUMNS): string {
  return columns.map((column) => `${column.width}px`).join(' ');
}

export function totalGridWidth(columns: PayrollColumnDef[] = PAYROLL_COLUMNS): number {
  return columns.reduce((sum, column) => sum + column.width, 0);
}

/** Column ids that are plain text/number editable inputs and therefore participate in Arrow-key
 * grid navigation (`data-col` index). Toggle/select cells are included too — navigation just needs
 * to reach and focus them, not necessarily type into them the same way. */
export const NAVIGABLE_COLUMN_IDS = PAYROLL_COLUMNS.filter((c) =>
  ['designation', 'bankId', 'branchCode', 'accountNumber', 'accountTitle', 'grossPay', 'days', 'otHours', 'otRate', 'cycleDays', 'leaveDays', 'leaveRate', 'allowance', 'eobiAmount', 'eobiApplicable', 'advanceDeduction', 'eidAdvanceDeduction', 'fine', 'hold', 'remarks'].includes(
    c.id,
  ),
).map((c) => c.id);
