/**
 * A tiny external store the sticky totals row subscribes to (`useSyncExternalStore`) so it can
 * update live while any row is being edited, without forcing every other row in a
 * 1,500–10,000-row grid to re-render on every keystroke.
 *
 * The store tracks a snapshot for **every** entry in the cycle, not only the ones currently
 * mounted by the virtualizer — TanStack Virtual only renders a small window of rows at a time
 * (a few dozen, regardless of total row count), so a totals row that only summed *mounted* rows
 * would silently undercount everything scrolled out of view. `setBase` seeds/refreshes every
 * entry's snapshot from the grid's own (server-cache-backed) `entries` array; a mounted row's own
 * `set()` calls override its *own* entry with live, not-yet-saved figures while it's being edited,
 * and `unmount()` hands back a fresh server-truth snapshot for that entry so its contribution to
 * the grand total is never lost just because it scrolled out of the rendered window.
 *
 * "Every user-entered numeric column" (the totals-row requirement) sums only values actually
 * entered — a `null` rate (OT Rate / Leave Rate left at "auto") is excluded from that column's
 * sum rather than counted as zero, since zero would misrepresent rows that never had a value to
 * begin with.
 */

export interface RowLiveSnapshot {
  grossPay: number | null;
  days: number | null;
  otHours: number | null;
  otRate: number | null;
  cycleDays: number | null;
  leaveDays: number | null;
  leaveRate: number | null;
  allowance: number | null;
  eobiAmount: number | null;
  advanceDeduction: number | null;
  eidAdvanceDeduction: number | null;
  fine: number | null;
  netSalary: number | null;
}

export const LIVE_TOTAL_KEYS: (keyof RowLiveSnapshot)[] = [
  'grossPay',
  'days',
  'otHours',
  'otRate',
  'cycleDays',
  'leaveDays',
  'leaveRate',
  'allowance',
  'eobiAmount',
  'advanceDeduction',
  'eidAdvanceDeduction',
  'fine',
  'netSalary',
];

export type LiveTotals = Record<keyof RowLiveSnapshot, number>;

/** `Number(x)` on `null`/`undefined`/empty-string-safe input, matching this codebase's decimal
 * wire-format convention (a numeric field is always a string, or null when genuinely unset). */
export function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export class LiveTotalsStore {
  private snapshots = new Map<string, RowLiveSnapshot>();
  /** entryIds currently mounted (actively edited or at least on-screen) — `setBase` never
   * overwrites one of these, so a sibling row's save completing (which produces a new `entries`
   * array reference and re-triggers `setBase`) can never clobber an in-progress live edit. */
  private mounted = new Set<string>();
  private listeners = new Set<() => void>();
  private cached: LiveTotals | null = null;

  /** Called by a mounted row on every live change (every keystroke, not debounced) — marks the
   * entry as actively tracked so a concurrent `setBase` from elsewhere never overrides it. */
  set = (id: string, snapshot: RowLiveSnapshot): void => {
    this.mounted.add(id);
    this.snapshots.set(id, snapshot);
    this.cached = null;
    this.emit();
  };

  /** Called when a row unmounts (scrolled out of the virtualizer's rendered window) — stops
   * treating it as actively live, but replaces its snapshot with a fresh one computed from
   * current server-cache truth (never the possibly-unsaved draft it had a moment ago), so the
   * grand total still counts it correctly. */
  unmount = (id: string, serverSnapshot: RowLiveSnapshot): void => {
    this.mounted.delete(id);
    this.snapshots.set(id, serverSnapshot);
    this.cached = null;
    this.emit();
  };

  /** Seeds/refreshes every entry's snapshot from the grid's current `entries` array — the only
   * mechanism that accounts for rows the virtualizer has never mounted at all. Skips any entry
   * that's currently actively tracked (mid-edit), so this can be called freely (e.g. whenever the
   * `entries` array reference changes) without ever overwriting a live, not-yet-saved edit. */
  setBase = (entries: { id: string; snapshot: RowLiveSnapshot }[]): void => {
    for (const { id, snapshot } of entries) {
      if (!this.mounted.has(id)) {
        this.snapshots.set(id, snapshot);
      }
    }
    // Drop any tracked row that's no longer part of the entries array at all (e.g. a cycle
    // switch) — otherwise a stale row could keep contributing to the total forever.
    const validIds = new Set(entries.map((e) => e.id));
    for (const id of this.snapshots.keys()) {
      if (!validIds.has(id)) {
        this.snapshots.delete(id);
        this.mounted.delete(id);
      }
    }
    this.cached = null;
    this.emit();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  getTotals = (): LiveTotals => {
    if (this.cached) return this.cached;
    const totals = {} as LiveTotals;
    for (const key of LIVE_TOTAL_KEYS) {
      let sum = 0;
      for (const snapshot of this.snapshots.values()) {
        const value = snapshot[key];
        if (value !== null) sum += value;
      }
      totals[key] = sum;
    }
    this.cached = totals;
    return totals;
  };

  get rowCount(): number {
    return this.snapshots.size;
  }
}
