import { useEffect, useSyncExternalStore } from 'react';
import type { SaveStatus } from '@/hooks/use-payroll-entry-editor';

/**
 * Phase 7E durability checkpoint — a module-level singleton (not a React Context, not created per
 * page mount) so that:
 *
 * 1. It survives `PayrollEntryPage` unmounting. A row's own `usePayrollEntryEditor` instance keeps
 *    running its debounce/retry timers after its component unmounts (the virtualizer-unmount fix,
 *    `use-payroll-entry-editor.ts`) — this store is what lets that still-in-flight save remain
 *    visible/countable even though the component that started it is gone.
 * 2. A different route (`SalaryReleasePage`) can ask "does this cycle have unsaved Payroll Entry
 *    work right now" without any prop-drilling or cross-route context — the release interlock
 *    (A4) reads the exact same live truth the Payroll Entry page's own banner reads.
 *
 * This is deliberately **not** an independent source of truth: every `set()` call is driven
 * directly from the same `status` transitions `usePayrollEntryEditor` already computes for its own
 * per-row UI (`SaveStatusIndicator`) — this just also mirrors each transition into one aggregate,
 * imperatively (a plain function call, not a `useEffect`), specifically so a transition that
 * happens *after* the reporting component has unmounted (a retry succeeding/failing in the
 * background) still updates this store — a `useEffect` tied to that unmounted component's own
 * state could never fire again once it's gone.
 *
 * Scope note (documented, not a gap): this store is per-tab/per-JS-runtime, the same as every
 * other piece of Payroll Entry's client-side state (Part A's own "no offline payroll storage"
 * constraint — nothing here is persisted to localStorage/IndexedDB, and nothing here is payroll
 * *data*, only ephemeral save-status bookkeeping). It does not see another browser tab's or
 * another user's pending edits — that cross-session case is closed at the backend instead (the
 * release endpoint's own `expectedVersions` check, `payroll-release.service.ts`), which is the
 * only layer that can actually see across sessions.
 */

export type PendingSaveStatus = Exclude<SaveStatus, 'idle' | 'saved'>;

export interface EntrySaveRecord {
  cycleId: string;
  status: PendingSaveStatus;
  errorMessage?: string;
  /** The exact row's own `retryNow` — reused so a page-level "Retry all failed" action re-enters
   * the identical retry path a user clicking that one row's own icon would, never a second retry
   * mechanism. May be stale after its owning row re-renders, but every closure this hook produces
   * reads through refs (`use-payroll-entry-editor.ts`), so an older one is still safe to call. */
  retry?: () => void;
}

export interface CycleSaveSummary {
  /** Total rows currently not server-confirmed-saved (dirty, saving, error, or conflict). */
  pendingCount: number;
  savingCount: number;
  dirtyCount: number;
  errorCount: number;
  conflictCount: number;
  /** True while at least one row is actively mid-request — distinct from merely dirty (still
   * inside the debounce window) for the "Saving changes…" vs "N rows have unsaved changes" copy. */
  hasSaving: boolean;
  retryAllFailed: () => void;
}

const EMPTY_SUMMARY: CycleSaveSummary = {
  pendingCount: 0,
  savingCount: 0,
  dirtyCount: 0,
  errorCount: 0,
  conflictCount: 0,
  hasSaving: false,
  retryAllFailed: () => {},
};

class PayrollEntrySaveStatusStore {
  private records = new Map<string, EntrySaveRecord>();
  private listeners = new Set<() => void>();
  private summaryCache = new Map<string, CycleSaveSummary>();

  /** Called at every status transition `usePayrollEntryEditor` already makes for its own row —
   * `'saved'`/`'idle'` mean "nothing left to track," so the record is dropped rather than kept
   * around forever (bounds this map to genuinely-pending rows only, even at a 10,000-row cycle). */
  set = (entryId: string, cycleId: string, status: SaveStatus, errorMessage?: string, retry?: () => void): void => {
    if (status === 'saved' || status === 'idle') {
      if (this.records.delete(entryId)) {
        this.summaryCache.delete(cycleId);
        this.emit();
      }
      return;
    }
    this.records.set(entryId, { cycleId, status, errorMessage, retry });
    this.summaryCache.delete(cycleId);
    this.emit();
  };

  /** Called when an entry is no longer part of any loaded dataset at all (defensive — there is no
   * ordinary "delete this entry" action reachable from the editor today, but a cycle switch must
   * never leave a phantom "pending" count behind for a row that no longer exists client-side). */
  clear = (entryId: string, cycleId: string): void => {
    if (this.records.delete(entryId)) {
      this.summaryCache.delete(cycleId);
      this.emit();
    }
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

  getSummary = (cycleId: string): CycleSaveSummary => {
    const cached = this.summaryCache.get(cycleId);
    if (cached) return cached;

    let savingCount = 0;
    let dirtyCount = 0;
    let errorCount = 0;
    let conflictCount = 0;
    const failedRetries: (() => void)[] = [];

    for (const record of this.records.values()) {
      if (record.cycleId !== cycleId) continue;
      if (record.status === 'saving') savingCount += 1;
      else if (record.status === 'dirty') dirtyCount += 1;
      else if (record.status === 'error') {
        errorCount += 1;
        if (record.retry) failedRetries.push(record.retry);
      } else if (record.status === 'conflict') conflictCount += 1;
    }

    const pendingCount = savingCount + dirtyCount + errorCount + conflictCount;
    if (pendingCount === 0) {
      this.summaryCache.set(cycleId, EMPTY_SUMMARY);
      return EMPTY_SUMMARY;
    }

    const summary: CycleSaveSummary = {
      pendingCount,
      savingCount,
      dirtyCount,
      errorCount,
      conflictCount,
      hasSaving: savingCount > 0,
      retryAllFailed: () => {
        for (const retry of failedRetries) retry();
      },
    };
    this.summaryCache.set(cycleId, summary);
    return summary;
  };

  /** The single check both the `beforeunload` guard (A2), the in-app navigation guard (A3), and
   * the Release interlock (A4) all share — "is there anything in this cycle that isn't yet
   * server-confirmed saved." */
  hasPendingForCycle = (cycleId: string | undefined): boolean => {
    if (!cycleId) return false;
    return this.getSummary(cycleId).pendingCount > 0;
  };

  /** Any cycle at all — used by the `beforeunload` guard, which must warn on a hard refresh/close
   * regardless of which cycle is currently selected (switching the cycle selector while dirty is
   * itself just an ordinary in-app navigation, already covered by the same store). */
  hasAnyPending = (): boolean => {
    return this.records.size > 0;
  };
}

export const payrollEntrySaveStatusStore = new PayrollEntrySaveStatusStore();

export function usePayrollEntryCycleSaveSummary(cycleId: string | undefined): CycleSaveSummary {
  return useSyncExternalStore(
    payrollEntrySaveStatusStore.subscribe,
    () => (cycleId ? payrollEntrySaveStatusStore.getSummary(cycleId) : EMPTY_SUMMARY),
  );
}

/**
 * A2 (Phase 7E) — the native `beforeunload` mechanism, gated on live store state at the moment of
 * the event, not on whatever render happened to run last. Installed once, globally (`App.tsx`),
 * not only while `PayrollEntryPage` itself is mounted: with the virtualizer-unmount fix
 * (`use-payroll-entry-editor.ts`), a pending save can still be in flight in the background after
 * the user has already navigated to a different page in this same tab (e.g. confirmed "Leave
 * anyway" on the in-app navigation guard, A3) — closing the tab at that point must still warn.
 * Never fires when everything is server-confirmed saved — `hasAnyPending()` is `false` the moment
 * the last pending row's status resolves to `'saved'`/`'idle'`.
 */
export function usePayrollEntryUnloadGuard(): void {
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!payrollEntrySaveStatusStore.hasAnyPending()) return;
      event.preventDefault();
      // Legacy assignment form — Chrome/Firefox/Safari all still require a non-empty
      // `returnValue` for the native confirmation prompt to actually appear, even though the
      // string itself is no longer displayed by any modern browser (each shows its own fixed
      // wording instead, precisely so a page can never fake a misleading dialog).
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);
}
