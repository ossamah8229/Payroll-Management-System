// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  payrollEntrySaveStatusStore,
  usePayrollEntryCycleSaveSummary,
  usePayrollEntryUnloadGuard,
} from './payroll-entry-save-status-store';

/**
 * Phase 7E durability checkpoint (A7) — direct tests for the aggregate save-status store: the
 * cycle-level summary (A1's banner reads this) and the native `beforeunload` guard (A2). Every
 * entry/cycle id here is unique per test (a counter, not a fixed constant) so tests never see
 * leftover state from one another in this module-level singleton.
 */

let uidCounter = 0;
function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

// The store is a real module-level singleton (by design — see its own doc comment), so any test
// that leaves a record pending would otherwise leak into every later test's `hasAnyPending()`
// check. `trackedSet` records every `{entryId, cycleId}` this file ever writes so a global
// `afterEach` can force it back to `'idle'` (clearing it), regardless of what a given test itself
// asserted about that record's final state.
const writtenRecords: { entryId: string; cycleId: string }[] = [];
function trackedSet(
  entryId: string,
  cycleId: string,
  status: Parameters<typeof payrollEntrySaveStatusStore.set>[2],
  message?: string,
  retry?: () => void,
): void {
  writtenRecords.push({ entryId, cycleId });
  payrollEntrySaveStatusStore.set(entryId, cycleId, status, message, retry);
}

function dispatchBeforeUnload(): { defaultPrevented: boolean; returnValueSet: boolean } {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  let returnValueSet = false;
  Object.defineProperty(event, 'returnValue', {
    get: () => '',
    set: () => {
      returnValueSet = true;
    },
  });
  window.dispatchEvent(event);
  return { defaultPrevented: event.defaultPrevented, returnValueSet };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const { entryId, cycleId } of writtenRecords.splice(0)) {
    payrollEntrySaveStatusStore.clear(entryId, cycleId);
  }
});

describe('payrollEntrySaveStatusStore — cycle summary aggregation', () => {
  it('reports pendingCount 0 / all clear when nothing is tracked for this cycle', () => {
    const cycleId = uid('cycle');
    const { result } = renderHook(() => usePayrollEntryCycleSaveSummary(cycleId));
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.hasSaving).toBe(false);
  });

  it('counts dirty/saving/error/conflict independently and only for the requested cycle', () => {
    const cycleId = uid('cycle');
    const otherCycleId = uid('cycle');
    const { result } = renderHook(() => usePayrollEntryCycleSaveSummary(cycleId));

    act(() => {
      trackedSet(uid('entry'), cycleId, 'dirty');
      trackedSet(uid('entry'), cycleId, 'saving');
      trackedSet(uid('entry'), cycleId, 'error', 'boom');
      trackedSet(uid('entry'), cycleId, 'conflict', 'changed elsewhere');
      // A different cycle's own pending row must never bleed into this cycle's count.
      trackedSet(uid('entry'), otherCycleId, 'dirty');
    });

    expect(result.current.dirtyCount).toBe(1);
    expect(result.current.savingCount).toBe(1);
    expect(result.current.errorCount).toBe(1);
    expect(result.current.conflictCount).toBe(1);
    expect(result.current.pendingCount).toBe(4);
    expect(result.current.hasSaving).toBe(true);
  });

  it('drops a record once it resolves to saved/idle — pendingCount returns to 0', () => {
    const cycleId = uid('cycle');
    const entryId = uid('entry');
    const { result } = renderHook(() => usePayrollEntryCycleSaveSummary(cycleId));

    act(() => {
      trackedSet(entryId, cycleId, 'error', 'boom');
    });
    expect(result.current.pendingCount).toBe(1);

    act(() => {
      trackedSet(entryId, cycleId, 'saved');
    });
    expect(result.current.pendingCount).toBe(0);
  });

  it('retryAllFailed invokes every failed row\'s own stored retry callback, and only the failed ones', () => {
    const cycleId = uid('cycle');
    const retryA = vi.fn();
    const retryB = vi.fn();
    const { result } = renderHook(() => usePayrollEntryCycleSaveSummary(cycleId));

    act(() => {
      trackedSet(uid('entry'), cycleId, 'error', 'boom', retryA);
      trackedSet(uid('entry'), cycleId, 'error', 'boom', retryB);
      trackedSet(uid('entry'), cycleId, 'dirty');
    });

    result.current.retryAllFailed();

    expect(retryA).toHaveBeenCalledTimes(1);
    expect(retryB).toHaveBeenCalledTimes(1);
  });
});

describe('usePayrollEntryUnloadGuard — native beforeunload (items 2, 3, 18)', () => {
  it('warns on beforeunload while a row is dirty — even mid-debounce, before any request fires (item 18)', () => {
    const cycleId = uid('cycle');
    const entryId = uid('entry');
    renderHook(() => usePayrollEntryUnloadGuard());

    act(() => {
      trackedSet(entryId, cycleId, 'dirty');
    });

    const { defaultPrevented, returnValueSet } = dispatchBeforeUnload();
    expect(defaultPrevented).toBe(true);
    expect(returnValueSet).toBe(true);

    // cleanup for subsequent tests
    act(() => {
      trackedSet(entryId, cycleId, 'saved');
    });
  });

  it('warns while saving and while in conflict, not only while dirty', () => {
    const cycleId = uid('cycle');
    const entryId = uid('entry');
    renderHook(() => usePayrollEntryUnloadGuard());

    act(() => {
      trackedSet(entryId, cycleId, 'saving');
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    act(() => {
      trackedSet(entryId, cycleId, 'conflict', 'changed elsewhere');
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    act(() => {
      trackedSet(entryId, cycleId, 'idle');
    });
  });

  it('never warns once everything is confirmed saved (item 3)', () => {
    const cycleId = uid('cycle');
    const entryId = uid('entry');
    renderHook(() => usePayrollEntryUnloadGuard());

    act(() => {
      trackedSet(entryId, cycleId, 'dirty');
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    act(() => {
      trackedSet(entryId, cycleId, 'saved');
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it('never warns when nothing has ever been dirty', () => {
    renderHook(() => usePayrollEntryUnloadGuard());
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});
