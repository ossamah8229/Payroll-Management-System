import { calcNet } from '@payroll/shared';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { buildCalcInput } from './calc-input';

/** Payroll Entry usability checkpoint (2026-07-24) — the minimum sortable column set the grid
 * supports. Client-side only: `usePayrollEntries` already loads the whole cycle into memory
 * (Checkpoint 6's own architecture decision), so there is no server-side sort/pagination to wire
 * up here — sorting is a pure reordering of the already-fetched, already-site-filtered array. */
export type SortableColumnId = 'employeeName' | 'employeeCode' | 'unitCode' | 'grossPay' | 'netSalary';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  columnId: SortableColumnId;
  direction: SortDirection;
}

export const SORTABLE_COLUMN_IDS: readonly SortableColumnId[] = [
  'employeeName',
  'employeeCode',
  'unitCode',
  'grossPay',
  'netSalary',
];

export function isSortableColumnId(columnId: string): columnId is SortableColumnId {
  return (SORTABLE_COLUMN_IDS as readonly string[]).includes(columnId);
}

function compareText(a: string, b: string, direction: SortDirection): number {
  const cmp = a.localeCompare(b, undefined, { sensitivity: 'base' });
  return direction === 'asc' ? cmp : -cmp;
}

/** Missing values always sort last, in *both* directions — only the present values swap order
 * when the direction toggles, matching common spreadsheet sort convention rather than letting
 * blanks jump to the top the moment a column is reversed (a "deterministic handling of missing
 * values" the grid's sortable Deputed Branch column specifically needs, since a not-yet-assigned
 * `ProjectUnit.code` is a real, expected state). `numeric: true` gives sensible alphanumeric
 * ordering for codes like "A2" vs "A10". */
function compareAlphanumericNullsLast(a: string | null, b: string | null, direction: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? cmp : -cmp;
}

function compareNumeric(a: number, b: number, direction: SortDirection): number {
  const cmp = a - b;
  return direction === 'asc' ? cmp : -cmp;
}

function sortKeyCompare(a: PayrollEntry, b: PayrollEntry, sort: SortState): number {
  switch (sort.columnId) {
    case 'employeeName':
      return compareText(a.employee.name, b.employee.name, sort.direction);
    case 'employeeCode':
      return compareAlphanumericNullsLast(
        a.employee.employeeCode ?? null,
        b.employee.employeeCode ?? null,
        sort.direction,
      );
    case 'unitCode':
      return compareAlphanumericNullsLast(
        a.workLines[0]?.unit.code ?? null,
        b.workLines[0]?.unit.code ?? null,
        sort.direction,
      );
    case 'grossPay':
      return compareNumeric(Number(a.grossPay), Number(b.grossPay), sort.direction);
    case 'netSalary':
      return compareNumeric(
        Number(calcNet(buildCalcInput(a)).netSalary),
        Number(calcNet(buildCalcInput(b)).netSalary),
        sort.direction,
      );
    default:
      return 0;
  }
}

/**
 * Pure, stable, non-mutating sort over the currently-filtered entries — returns a new array and
 * never touches `entries` itself or any entry object in it, and never recomputes/writes payroll
 * figures, only reads them for comparison. Ties break on each entry's original position in
 * `entries` (whatever order the site filter/fetch already produced) so equal values never reorder
 * relative to each other, regardless of the sort engine's own stability guarantees.
 */
export function sortPayrollEntries(entries: PayrollEntry[], sort: SortState | null): PayrollEntry[] {
  if (!sort) return entries;
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((x, y) => {
      const cmp = sortKeyCompare(x.entry, y.entry, sort);
      return cmp !== 0 ? cmp : x.index - y.index;
    })
    .map((x) => x.entry);
}
