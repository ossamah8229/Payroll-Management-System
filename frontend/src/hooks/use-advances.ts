import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdvanceRepaymentType,
  AdvanceStatus,
  AdvanceType,
  CreateAdvanceInput,
  DeferAdvanceScheduleInput,
  UpdateAdvanceInput,
} from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/** A newly-created Advance can immediately materialize a deduction into the current Draft cycle's
 * `PayrollEntry` (Operational Stabilization Checkpoint, 2026-07-24, Section E) — invalidating this
 * query too, not just Advances' own, is what makes an already-open Payroll Entry page reflect it
 * without a manual refresh. Broad (no cycle id) since this hook has no reliable way to know which
 * cycle was actually touched; only the currently-mounted query, if any, actually refetches. */
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
  employee: { id: string; name: string; employeeCode: string | null; cnic: string | null; siteId: string };
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

const ADVANCES_QUERY_KEY = ['advances'] as const;

export interface AdvancesFilters {
  employeeId?: string;
  siteId?: string;
  type?: AdvanceType;
  status?: AdvanceStatus;
}

export function useAdvances(filters: AdvancesFilters = {}) {
  const params = new URLSearchParams();
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  const queryString = params.toString();

  return useQuery({
    queryKey: [...ADVANCES_QUERY_KEY, filters],
    queryFn: () =>
      apiRequest<{ advances: Advance[] }>(`/api/v1/advances${queryString ? `?${queryString}` : ''}`).then(
        (res) => res.advances,
      ),
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
    },
  });
}
