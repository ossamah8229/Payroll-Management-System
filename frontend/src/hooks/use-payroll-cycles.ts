import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePayrollCycleInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';
import { payrollEntriesQueryKey } from './use-payroll-entries';

export type PayrollCycleStatus = 'DRAFT' | 'RELEASED' | 'ARCHIVED';

export interface PayrollCycle {
  id: string;
  year: number;
  month: number;
  status: PayrollCycleStatus;
  sourceCycleId: string | null;
  createdAt: string;
  createdBy: string;
  releasedAt: string | null;
  releasedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  /** Phase 5 Checkpoint 4 — derived server-side, `status === 'DRAFT'`. */
  isCurrentDraft: boolean;
}

const PAYROLL_CYCLES_QUERY_KEY = ['payroll-cycles'] as const;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Computed display label, never stored (docs/architecture/database/schema-invariants.md §22: "PayrollCycle
 * display label... computed from year/month, never stored"). */
export function formatCycleLabel(cycle: Pick<PayrollCycle, 'year' | 'month'>): string {
  return `${MONTH_NAMES[cycle.month - 1]} ${cycle.year}`;
}

/** `"July 2026 · Draft"` — the shared selector's own option/label format (Phase 5 Checkpoint 4),
 * built on `formatCycleLabel` rather than duplicating the month-name lookup. */
export function formatCycleOptionLabel(cycle: Pick<PayrollCycle, 'year' | 'month' | 'status'>): string {
  return `${formatCycleLabel(cycle)} · ${formatCycleStatusLabel(cycle.status)}`;
}

export function formatCycleStatusLabel(status: PayrollCycleStatus): string {
  return status === 'DRAFT' ? 'Draft' : status === 'RELEASED' ? 'Released' : 'Archived';
}

/** `"2026-07"` — the shared period-slug convention every historical export filename now uses
 * (Phase 5 Checkpoint 4), matching the backend's own identical construction
 * (`bank-sheets.routes.ts`/`cash-receiving.routes.ts`/`payslips.routes.ts`). */
export function formatCyclePeriodSlug(cycle: Pick<PayrollCycle, 'year' | 'month'>): string {
  return `${cycle.year}-${String(cycle.month).padStart(2, '0')}`;
}

/**
 * The default-cycle-selection rule, shared across every page with a selector (Phase 5 Checkpoint 4
 * architecture review, §8): the Draft cycle if one exists, otherwise the newest Released cycle,
 * otherwise the newest Archived cycle, otherwise `undefined` (the true empty-install case). `cycles`
 * is already newest-first (the backend's own `[{ year: 'desc' }, { month: 'desc' }]` ordering), so
 * a plain `.find()` for each status already returns the newest match for that status.
 */
export function resolveDefaultCycleId(cycles: PayrollCycle[]): string | undefined {
  return (
    cycles.find((c) => c.status === 'DRAFT') ??
    cycles.find((c) => c.status === 'RELEASED') ??
    cycles.find((c) => c.status === 'ARCHIVED')
  )?.id;
}

export function usePayrollCycles() {
  return useQuery({
    queryKey: PAYROLL_CYCLES_QUERY_KEY,
    queryFn: () =>
      apiRequest<{ cycles: PayrollCycle[] }>('/api/v1/payroll-cycles').then((res) => res.cycles),
  });
}

/**
 * The cycle Payroll Entry operates against. Only one cycle is ever `DRAFT` at a time
 * (docs/architecture/workflows/payroll-lifecycle.md §4) — that is always the editable one. If none is Draft
 * (e.g. a brand-new install with zero cycles ever created), `cycle` is `undefined` and the page
 * shows its empty state rather than falling back to a non-Draft cycle, since nothing in this
 * checkpoint's scope can ever render a released/archived cycle as anything but read-only, and this
 * checkpoint doesn't build the historical Payroll Cycle Selector (a later phase's concern).
 */
export function useCurrentPayrollCycle() {
  const query = usePayrollCycles();
  const cycle = query.data?.find((c) => c.status === 'DRAFT');
  return { ...query, cycle };
}

export function useCreatePayrollCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePayrollCycleInput) =>
      apiRequest<{ cycle: PayrollCycle }>('/api/v1/payroll-cycles', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYROLL_CYCLES_QUERY_KEY });
    },
  });
}

/**
 * The most recently created cycle, regardless of status — unlike `useCurrentPayrollCycle` (which
 * only ever returns the one `DRAFT` cycle, for pages that operate on the editable cycle), Salary
 * Release needs to keep showing the cycle it was just displaying through a Finalize transition
 * (`DRAFT` → `RELEASED`), not fall back to an empty state the instant it stops being Draft. The
 * list is already ordered `[{ year: 'desc' }, { month: 'desc' }]` by the backend, so the first row
 * is always the latest. This is deliberately not a historical cycle selector (a later phase's
 * concern, docs/architecture/workflows/payroll-lifecycle.md §4) — it only ever shows the single
 * newest cycle, never lets the user browse older ones.
 */
export function useLatestPayrollCycle() {
  const query = usePayrollCycles();
  const cycle = query.data?.[0];
  return { ...query, cycle };
}

export function useFinalizePayrollCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cycleId: string) =>
      apiRequest<{ cycle: PayrollCycle }>(`/api/v1/payroll-cycles/${cycleId}/finalize`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYROLL_CYCLES_QUERY_KEY });
    },
  });
}

export interface RolloverPayrollCycleResult {
  outgoingCycle: PayrollCycle;
  newCycle: PayrollCycle;
  backupPackageId: string;
  backupPackageVersion: number;
  entriesCreated: number;
  departedObligationEntries: number;
  advancesMaterialized: number;
}

/**
 * Phase 5 Checkpoint 3 — the month-end rollover workflow. No request body: the next calendar
 * period is always derived server-side from the outgoing cycle's own `(year, month)`, never
 * caller-supplied (docs/architecture/workflows/payroll-lifecycle.md §4).
 */
export function useRolloverPayrollCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (outgoingCycleId: string) =>
      apiRequest<RolloverPayrollCycleResult>(
        `/api/v1/payroll-cycles/${outgoingCycleId}/archive-and-create-next`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYROLL_CYCLES_QUERY_KEY });
    },
  });
}

export interface ReconcileDraftCycleRosterResult {
  reconciledCount: number;
  reconciledEmployeeIds: string[];
}

/**
 * Draft Payroll Roster Reconciliation (2026-07-24) — `payroll-entry-page.tsx` fires this once,
 * silently, on mount for a Draft cycle when the viewing session holds `payroll-cycle:manage` (the
 * same permission this action's own backend route requires — see `reconcileDraftCycleRoster`'s own
 * doc comment for why a cycle-wide write is gated at that level, not the narrower `payroll:entry` a
 * day-to-day Payroll Manager holds). This is what makes opening the current Draft self-healing
 * without the Payroll Entry list's own `GET` ever doing a write itself — the read stays a pure read,
 * and this is its own explicit, separately-audited mutation the page happens to trigger
 * automatically. Invalidates the entries query only when something actually changed
 * (`reconciledCount > 0`), so an already-complete roster never causes a pointless refetch.
 */
export function useReconcileDraftCycleRoster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cycleId: string) =>
      apiRequest<ReconcileDraftCycleRosterResult>(`/api/v1/payroll-cycles/${cycleId}/reconcile-roster`, {
        method: 'POST',
      }),
    onSuccess: (result, cycleId) => {
      if (result.reconciledCount > 0) {
        queryClient.invalidateQueries({ queryKey: payrollEntriesQueryKey(cycleId) });
      }
    },
  });
}
