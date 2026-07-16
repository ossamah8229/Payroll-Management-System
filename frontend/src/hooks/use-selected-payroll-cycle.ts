import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePayrollCycles, resolveDefaultCycleId, type PayrollCycle } from '@/hooks/use-payroll-cycles';

export interface UseSelectedPayrollCycleResult {
  /** The cycle id named in the URL — `undefined` on a flat, pre-historical-selector route
   * (`/payroll-entry`, `/release`, `/bank-sheet`, `/cash-receiving`, `/payslips`) until the
   * redirect below resolves one, or forever if no cycle exists at all. */
  cycleId: string | undefined;
  /** The matching row from the cycle list, once loaded — `undefined` while loading, on a truly
   * invalid/nonexistent explicit `cycleId` (never silently redirected away from, per the approved
   * architecture — the page's own existing data-fetch error state is what surfaces this), or when
   * `cycleId` itself is `undefined`. */
  cycle: PayrollCycle | undefined;
  /** The full cycle list, newest-first — every page's own `<select>` options come from this. */
  cycles: PayrollCycle[];
  isLoading: boolean;
  error: Error | null;
  /** Navigates to this same page for a different cycle — the one place a page's `<select>
   * onChange` needs to call, instead of local `setState`, now that the selection lives in the URL. */
  selectCycle: (cycleId: string) => void;
}

/**
 * The shared "which cycle is this page showing" hook (Phase 5 Checkpoint 4 architecture review,
 * §4/§9) — every cycle-aware page calls this once, with its own route suffix, instead of the
 * three independent local-state `useEffect` implementations Bank Sheet/Cash Receiving/Payslips
 * each had before this checkpoint (and instead of `useCurrentPayrollCycle`/`useLatestPayrollCycle`
 * for Payroll Entry/Salary Release, which only ever showed one cycle).
 *
 * **Route architecture:** every cycle-aware page is mounted at two paths — the flat, pre-existing
 * one (`/payroll-entry`) and the canonical one (`/payroll-cycles/:cycleId/payroll-entry`) — both
 * rendering the exact same page component. `routeSuffix` is that page's own trailing segment
 * (`'payroll-entry'`, `'release'`, `'bank-sheet'`, `'cash-receiving'`, `'payslips'`), used to build
 * the canonical URL this hook redirects the flat route to.
 *
 * **Redirect algorithm** (only runs when the URL has no explicit `:cycleId` — i.e. only on the flat
 * route): Draft → newest Released → newest Archived → nothing (empty state, no redirect). An
 * explicit, malformed, or nonexistent `:cycleId` already present in the URL is never touched or
 * redirected away from — the approved architecture decision — the page's own existing data hooks
 * (`usePayrollEntries`, `useBankSheet`, etc.) surface the ordinary 404/error state for a bad id
 * exactly as they always have, since none of them assume a "current cycle" internally.
 */
export function useSelectedPayrollCycle(routeSuffix: string): UseSelectedPayrollCycleResult {
  const { cycleId: routeCycleId } = useParams<{ cycleId?: string }>();
  const navigate = useNavigate();
  const cyclesQuery = usePayrollCycles();
  const cycles = useMemo(() => cyclesQuery.data ?? [], [cyclesQuery.data]);

  useEffect(() => {
    if (routeCycleId) return; // already on a canonical, explicit-cycle URL — nothing to redirect
    if (cyclesQuery.isLoading || cycles.length === 0) return; // nothing to redirect to (yet, or ever)
    const defaultId = resolveDefaultCycleId(cycles);
    if (defaultId) {
      navigate(`/payroll-cycles/${defaultId}/${routeSuffix}`, { replace: true });
    }
  }, [routeCycleId, cyclesQuery.isLoading, cycles, routeSuffix, navigate]);

  const cycle = routeCycleId ? cycles.find((c) => c.id === routeCycleId) : undefined;

  return {
    cycleId: routeCycleId,
    cycle,
    cycles,
    isLoading: cyclesQuery.isLoading,
    error: cyclesQuery.error,
    selectCycle: (nextCycleId: string) => navigate(`/payroll-cycles/${nextCycleId}/${routeSuffix}`),
  };
}
