import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePayrollCycleInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

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
