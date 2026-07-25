import { useSyncExternalStore } from 'react';
import { formatMoney, formatNumber } from '@payroll/shared';
import { cn } from '@/lib/cn';
import { PAYROLL_COLUMNS } from './columns';
import { LIVE_TOTAL_KEYS, type LiveTotals, type LiveTotalsStore } from './live-totals-store';

// Only genuine payment amounts get the PKR prefix (docs/design-system.md §4) — rates (OT Rate,
// Leave Rate) and counts (days, hours, cycle days) are plain numbers, consistent with each other.
const MONEY_COLUMNS = new Set(['grossPay', 'allowance', 'eobiAmount', 'advanceDeduction', 'eidAdvanceDeduction', 'fine', 'netSalary']);
const DEDUCTION_COLUMNS = new Set(['advanceDeduction', 'eidAdvanceDeduction', 'fine']);
// A live-total column is a genuine JS `Set`, but `LIVE_TOTAL_KEYS` is the single already-existing
// source of truth for "which columns get a summed total" — reused here rather than a second,
// independently-maintained list that could itself drift from `live-totals-store.ts`.
const NUMERIC_TOTAL_COLUMN_IDS = new Set<string>(LIVE_TOTAL_KEYS);

/**
 * Sticky totals row — subscribes directly to the live-totals store (`useSyncExternalStore`) so it
 * re-renders on every row edit without requiring the parent grid (all other rows) to re-render
 * too. Every user-entered numeric column gets a live sum; Net Salary is the grand total, computed
 * from the same per-row `calcNet` results the grid itself displays (docs/architecture/
 * database/payroll-entry.md §12) — never a second, independently-derived total.
 *
 * **Renders by iterating `PAYROLL_COLUMNS` itself, one cell per column, in that exact order**
 * (Operational Stabilization Checkpoint, 2026-07-24 root-cause fix) — the previous version was a
 * hand-written, positionally-ordered list of cells that had to be kept manually in sync with
 * `PAYROLL_COLUMNS` and silently drifted (missing the IBAN column's own placeholder cell), shifting
 * every total from Gross Pay onward one column to the left. Iterating the canonical array directly
 * makes that whole class of drift structurally impossible: adding, removing, or reordering a column
 * there automatically keeps this row's cell count and order correct, with no second list to update.
 * Every cell also carries `data-col-id` (matching the header's own `header.column.id` and the body
 * row's per-cell `data-col-id`) so header/body/totals alignment is mechanically verifiable, in a
 * real browser or in a test, rather than only visually apparent.
 */
export function PayrollEntryTotalsRow({
  store,
  gridTemplateColumns,
}: {
  store: LiveTotalsStore;
  /** The one shared, dynamically-computed grid template — see `PayrollEntryRow`'s identical prop
   * for why this is passed down rather than computed here independently. */
  gridTemplateColumns: string;
}) {
  const totals = useSyncExternalStore(store.subscribe, store.getTotals, store.getTotals);

  function cellContent(columnId: string): React.ReactNode {
    if (columnId === 'serial') return 'Σ';
    // The employee count belongs under the "Employee" column (`employeeName`, `columns.ts`) — the
    // column it's actually counting — not "Code" (`employeeCode`), a distinct column with its own
    // (empty) total cell. Attaching it to the wrong id was the reported "6 employees visually
    // detached from the Employee column" defect (Presentation & Workflow Stabilization Checkpoint,
    // 2026-07-25): the count still rendered somewhere in the row, in `PAYROLL_COLUMNS` order, just
    // one column left of the one it labels.
    if (columnId === 'employeeName') return `${store.rowCount} ${store.rowCount === 1 ? 'employee' : 'employees'}`;
    if (NUMERIC_TOTAL_COLUMN_IDS.has(columnId)) {
      const value = totals[columnId as keyof LiveTotals];
      return MONEY_COLUMNS.has(columnId) ? formatMoney(value) : formatNumber(value);
    }
    return null;
  }

  // Every cell is `whitespace-nowrap` only — never `truncate` — so a summed total (which can be
  // legitimately wider than the widest individual row, since column widths are measured from
  // per-row values, not the sum) is never silently clipped with an ellipsis. This prevents the
  // original wrapping bug (a cell's text breaking onto a second line, e.g. "1,502 employees") the
  // same way `truncate` would, without `truncate`'s downside of hiding real digits of a financial
  // total. A too-wide total instead overflows visibly into the row's own horizontal scroll
  // container, matching `ReadOnlyCell`'s own `overflow-visible whitespace-nowrap` option and this
  // codebase's established rule that business-critical/financial values are never truncated.
  function cellClassName(columnId: string): string {
    const base = 'overflow-visible px-1.5 py-2';
    if (columnId === 'serial') return cn(base, 'text-center text-text-muted');
    if (columnId === 'employeeName') return cn(base, 'text-text');
    if (NUMERIC_TOTAL_COLUMN_IDS.has(columnId)) {
      return cn(
        base,
        'text-right tabular-nums',
        DEDUCTION_COLUMNS.has(columnId) && 'text-danger',
        columnId === 'netSalary' && 'text-success',
      );
    }
    return base;
  }

  return (
    <div
      role="row"
      style={{ gridTemplateColumns }}
      className="grid items-center whitespace-nowrap border-t-2 border-border-strong bg-surface text-xs font-semibold"
    >
      {PAYROLL_COLUMNS.map((column) => (
        <div key={column.id} role="cell" data-col-id={column.id} className={cellClassName(column.id)}>
          {cellContent(column.id)}
        </div>
      ))}
    </div>
  );
}
