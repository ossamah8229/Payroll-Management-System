import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdvanceRepaymentType,
  AdvanceStatus,
  AdvanceType,
  CancelAdvanceInput,
  CreateAdvanceInput,
  DeferAdvanceScheduleInput,
  UpdateAdvanceInput,
} from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/** Any Advance mutation that can change a `PayrollEntry`'s own `advanceDeduction`/
 * `eidAdvanceDeduction`/linked-balance display (create's own immediate current-Draft
 * materialization, defer's reversal, cancel's reversal, and a `totalAmount` edit changing the
 * balance the grid's own "Bal: ..." indicator shows) must invalidate Payroll Entry's query cache
 * too — not just Advances' own (Operational Stabilization Checkpoint, 2026-07-24, Section E: "the
 * affected Payroll Entry becomes current immediately through the appropriate
 * mutation/refetch/materialization mechanism"). Broad (no cycle id) rather than narrow: this hook
 * has no reliable way to know which cycle's entries were actually touched, and Payroll Entry's own
 * query key is cheap to invalidate wholesale (`['payroll-entries', cycleId]` — invalidating the
 * bare `['payroll-entries']` prefix matches every cycle's query, and only the currently-mounted one,
 * if any, actually refetches).
 */
const PAYROLL_ENTRIES_QUERY_KEY = ['payroll-entries'] as const;

export interface ScheduledPayrollPeriod {
  id: string;
  year: number;
  month: number;
  payrollCycleId: string | null;
  resolvedAt: string | null;
}

export interface Advance {
  id: string;
  employeeId: string;
  // fatherName added (Employee Identity Visibility, v1.0.1 Checkpoint 1, 2026-08-25) — already
  // present on every row the backend returns (`advances.service.ts`'s `include: { employee: true,
  // ... }`), just not previously typed/rendered here. No backend change.
  // site/unit added (v1.0.4 Deputation Visibility checkpoint) — joined server-side in the same
  // query (`advanceListInclude`, advances.service.ts), never a second per-row fetch.
  employee: {
    id: string;
    name: string;
    employeeCode: string | null;
    cnic: string | null;
    fatherName: string | null;
    siteId: string;
    site: { id: string; name: string; unitLabel: string };
    unit: { id: string; name: string; code: string | null };
  };
  type: AdvanceType;
  totalAmount: string;
  outstandingBalance: string;
  dateGiven: string;
  repaymentType: AdvanceRepaymentType;
  scheduledInstallmentAmount: string | null;
  notes: string | null;
  status: AdvanceStatus;
  originalScheduledPeriodId: string | null;
  currentScheduledPeriodId: string | null;
  originalScheduledPeriod: ScheduledPayrollPeriod | null;
  currentScheduledPeriod: ScheduledPayrollPeriod | null;
  paidOffAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Exported (Presentation & Workflow Stabilization Checkpoint, 2026-07-25) so `useReleaseProjectUnit`
// (use-payroll-release.ts) can invalidate this cache too — a per-Unit release can settle a
// `RESERVED` Advance to `PAID_OFF` (`settleAdvancesForReleasedEntries`, advances.service.ts), and
// the Advances page's own cache needs telling exactly like Payroll Entry's did (Issue 1's identical
// fix, same root cause: a mutation elsewhere in the app changing state this query reads).
export const ADVANCES_QUERY_KEY = ['advances'] as const;

// v1.0.4 Advances Scalability checkpoint — the established server-side pagination page size
// (mirrors the Advance Recovery Report's own `ADVANCE_RECOVERY_REPORT_DEFAULT_PAGE_SIZE`).
export const ADVANCES_PAGE_SIZE = 25;

export interface AdvancesFilters {
  employeeId?: string;
  // siteIds (plural) replaces the old single siteId (v1.0.4) — multiple selected sites are now
  // filtered server-side (repeated `siteId=` query values), not client-side over a partial page.
  siteIds?: string[];
  type?: AdvanceType;
  status?: AdvanceStatus;
  page?: number;
  pageSize?: number;
}

export interface AdvancesListResult {
  advances: Advance[];
  total: number;
  page: number;
  pageSize: number;
}

export function useAdvances(filters: AdvancesFilters = {}) {
  const params = new URLSearchParams();
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  for (const siteId of filters.siteIds ?? []) params.append('siteId', siteId);
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? ADVANCES_PAGE_SIZE));
  const queryString = params.toString();

  return useQuery({
    queryKey: [...ADVANCES_QUERY_KEY, filters],
    queryFn: () => apiRequest<AdvancesListResult>(`/api/v1/advances?${queryString}`),
  });
}

export function useAdvance(id: string | undefined) {
  return useQuery({
    queryKey: [...ADVANCES_QUERY_KEY, id],
    queryFn: () => apiRequest<{ advance: Advance }>(`/api/v1/advances/${id}`).then((res) => res.advance),
    enabled: Boolean(id),
  });
}

export function useCreateAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAdvanceInput) =>
      apiRequest<{ advance: Advance }>('/api/v1/advances', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADVANCES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: PAYROLL_ENTRIES_QUERY_KEY });
    },
  });
}

export function useUpdateAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAdvanceInput }) =>
      apiRequest<{ advance: Advance }>(`/api/v1/advances/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADVANCES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: PAYROLL_ENTRIES_QUERY_KEY });
    },
  });
}

export function useDeferAdvanceSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DeferAdvanceScheduleInput }) =>
      apiRequest<{ advance: Advance }>(`/api/v1/advances/${id}/defer`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADVANCES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: PAYROLL_ENTRIES_QUERY_KEY });
    },
  });
}

export function useCancelAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CancelAdvanceInput }) =>
      apiRequest<{ advance: Advance }>(`/api/v1/advances/${id}/cancel`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADVANCES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: PAYROLL_ENTRIES_QUERY_KEY });
    },
  });
}
