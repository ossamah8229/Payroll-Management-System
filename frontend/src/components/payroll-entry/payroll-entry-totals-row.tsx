import { useSyncExternalStore } from 'react';
import { formatMoney, formatNumber } from '@payroll/shared';
import { gridTemplateColumns } from './columns';
import type { LiveTotalsStore } from './live-totals-store';

// Only genuine payment amounts get the PKR prefix (docs/design-system.md §4) — rates (OT Rate,
// Leave Rate) and counts (days, hours, cycle days) are plain numbers, consistent with each other.
const MONEY_COLUMNS = new Set(['grossPay', 'allowance', 'eobiAmount', 'advanceDeduction', 'eidAdvanceDeduction', 'fine', 'netSalary']);

/**
 * Sticky totals row — subscribes directly to the live-totals store (`useSyncExternalStore`) so it
 * re-renders on every row edit without requiring the parent grid (all other rows) to re-render
 * too. Every user-entered numeric column gets a live sum; Net Salary is the grand total, computed
 * from the same per-row `calcNet` results the grid itself displays (docs/architecture/
 * database/payroll-entry.md §12) — never a second, independently-derived total.
 */
export function PayrollEntryTotalsRow({ store }: { store: LiveTotalsStore }) {
  const totals = useSyncExternalStore(store.subscribe, store.getTotals, store.getTotals);

  function cell(key: keyof typeof totals) {
    const value = totals[key];
    return MONEY_COLUMNS.has(key) ? formatMoney(value) : formatNumber(value);
  }

  return (
    <div
      role="row"
      style={{ gridTemplateColumns: gridTemplateColumns() }}
      className="grid items-center border-t-2 border-border-strong bg-surface text-xs font-semibold"
    >
      <div role="cell" className="px-1.5 py-2 text-center text-text-muted">
        Σ
      </div>
      <div role="cell" className="px-1.5 py-2 text-text-muted" />
      <div role="cell" className="px-1.5 py-2 text-text">
        {store.rowCount} {store.rowCount === 1 ? 'employee' : 'employees'}
      </div>
      <div role="cell" className="px-1.5 py-2" />
      <div role="cell" className="px-1.5 py-2" />
      <div role="cell" className="px-1.5 py-2" />
      <div role="cell" className="px-1.5 py-2" />
      <div role="cell" className="px-1.5 py-2" />
      <div role="cell" className="px-1.5 py-2" />
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums">{cell('grossPay')}</div>
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums">{cell('days')}</div>
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums">{cell('otHours')}</div>
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums">{cell('otRate')}</div>
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums">{cell('cycleDays')}</div>
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums">{cell('leaveDays')}</div>
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums">{cell('leaveRate')}</div>
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums">{cell('allowance')}</div>
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums">{cell('eobiAmount')}</div>
      <div role="cell" className="px-1.5 py-2" />
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums text-danger">{cell('advanceDeduction')}</div>
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums text-danger">{cell('eidAdvanceDeduction')}</div>
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums text-danger">{cell('fine')}</div>
      <div role="cell" className="px-1.5 py-2" />
      <div role="cell" className="px-1.5 py-2" />
      <div role="cell" className="px-1.5 py-2 text-right tabular-nums text-success">
        {cell('netSalary')}
      </div>
    </div>
  );
}
