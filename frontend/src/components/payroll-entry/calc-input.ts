import { calcNet, type PayrollEntryCalcInput } from '@payroll/shared';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { parseValidCycleDays } from './numeric-validation';
import { toNumberOrNull, type RowLiveSnapshot } from './live-totals-store';

/** The entry-level fields this checkpoint's grid can edit (a subset of `UpdatePayrollEntryInput` —
 * excludes the non-calculation fields like designation/bank/hold/remarks, which don't feed
 * `calcNet`). */
export interface EntryCalcOverrides {
  grossPay?: string;
  allowance?: string;
  leaveDays?: string;
  leaveRate?: string | null;
  eobiAmount?: string;
  eobiApplicable?: boolean;
  advanceDeduction?: string;
  eidAdvanceDeduction?: string;
  fine?: string;
}

/** One work line's editable fields (docs/architecture/database/payroll-entry.md §12a) — every line
 * an entry has, not just the primary one, since Checkpoint 3's "Split by {unitLabel}" modal edits
 * non-primary lines through this exact same overlay mechanism (`usePayrollEntryEditor`'s
 * `lineDrafts`, keyed by work-line id). */
export interface WorkLineCalcOverrides {
  days?: string;
  otHours?: string;
  otRate?: string | null;
  /** Raw, possibly-incomplete typed text (e.g. `"3"` while typing toward `"31"`, or briefly
   * empty) — parsed and range-checked here, never trusted as-is. An invalid/incomplete value is
   * simply not applied, falling back to the line's real stored `cycleDays`, so a mid-typing
   * keystroke never corrupts the live calculation or the divisor `calcNet` divides by. */
  cycleDays?: string;
}

/**
 * Builds shared `calcNet`'s input contract from an entry's stored figures, overlaid with whatever
 * local, not-yet-saved edits are currently pending — this is what makes the grid's live totals and
 * displayed net salary always come from the one shared calculation library (never a second,
 * frontend-only reimplementation of the formula), even before a save round-trips to the server.
 * `lineOverrides` is keyed by work-line id so a draft on *any* line — the primary one edited inline
 * in the grid, or an additional one edited in the Split by {unitLabel} modal — feeds the same one
 * calculation path (Principle 5); a line with no entry in the map is used exactly as last saved.
 *
 * This function only ever reconciles *which* values to feed `calcNet` — it does not, and cannot,
 * guard against an incomplete/invalid *decimal* string (`grossPay`, `days`, `otRate`, etc.)  being
 * passed straight through; `calcNet`'s underlying `decimal.js` throws on those mid-typing.
 * Callers computing a *live* preview (as opposed to a value already known-valid from the server)
 * must wrap this in a try/catch — see `usePayrollEntryEditor`.
 */
export function buildCalcInput(
  entry: PayrollEntry,
  entryOverrides: EntryCalcOverrides = {},
  lineOverrides: Record<string, WorkLineCalcOverrides> = {},
): PayrollEntryCalcInput {
  // Guaranteed by the architecture — every PayrollEntry always has at least one WorkLine
  // (docs/architecture/database/payroll-entry.md §12a) — mirrors calcNet's own `assertHasWorkLines`.
  if (entry.workLines.length === 0) {
    throw new Error('buildCalcInput: a PayrollEntry must have at least one PayrollEntryWorkLine');
  }
  const mergedLines = entry.workLines.map((line) => {
    const overrides = lineOverrides[line.id];
    if (!overrides) return line;
    const validCycleDays =
      overrides.cycleDays !== undefined ? parseValidCycleDays(overrides.cycleDays) : undefined;
    return { ...line, ...overrides, cycleDays: validCycleDays ?? line.cycleDays };
  });

  return {
    grossPay: entryOverrides.grossPay ?? entry.grossPay,
    allowance: entryOverrides.allowance ?? entry.allowance,
    leaveDays: entryOverrides.leaveDays ?? entry.leaveDays,
    leaveRate: entryOverrides.leaveRate !== undefined ? entryOverrides.leaveRate : entry.leaveRate,
    eobiAmount: entryOverrides.eobiAmount ?? entry.eobiAmount,
    eobiApplicable: entryOverrides.eobiApplicable ?? entry.eobiApplicable,
    advanceDeduction: entryOverrides.advanceDeduction ?? entry.advanceDeduction,
    eidAdvanceDeduction: entryOverrides.eidAdvanceDeduction ?? entry.eidAdvanceDeduction,
    fine: entryOverrides.fine ?? entry.fine,
    workLines: mergedLines.map((line) => ({
      sortOrder: line.sortOrder,
      days: line.days,
      otHours: line.otHours,
      otRate: line.otRate,
      cycleDays: line.cycleDays,
    })),
  };
}

/**
 * A `RowLiveSnapshot` computed purely from an entry's current *server-cache* figures — never a
 * local draft. Used to seed the live-totals store for every entry in the cycle (`setBase`,
 * including the ones the virtualizer has never mounted) and to hand a row's contribution back to
 * the store when it unmounts, so scrolling a row out of view never drops it from the grand total
 * or leaves a stale, possibly-unsaved value behind.
 */
export function computeServerSnapshot(entry: PayrollEntry): RowLiveSnapshot {
  const primary = entry.workLines[0];
  return {
    grossPay: toNumberOrNull(entry.grossPay),
    days: toNumberOrNull(primary?.days),
    otHours: toNumberOrNull(primary?.otHours),
    otRate: toNumberOrNull(primary?.otRate),
    cycleDays: primary?.cycleDays ?? null,
    leaveDays: toNumberOrNull(entry.leaveDays),
    leaveRate: toNumberOrNull(entry.leaveRate),
    allowance: toNumberOrNull(entry.allowance),
    eobiAmount: toNumberOrNull(entry.eobiAmount),
    advanceDeduction: toNumberOrNull(entry.advanceDeduction),
    eidAdvanceDeduction: toNumberOrNull(entry.eidAdvanceDeduction),
    fine: toNumberOrNull(entry.fine),
    netSalary: toNumberOrNull(calcNet(buildCalcInput(entry)).netSalary),
  };
}
