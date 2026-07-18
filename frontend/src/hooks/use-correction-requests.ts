import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveCorrectionRequestInput,
  CorrectionField,
  CorrectionRequestStatus,
  CreateCorrectionRequestInput,
  ListCorrectionRequestsQuery,
  PreviewCorrectionInput,
  RejectCorrectionRequestInput,
} from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/** The backend's `CorrectionCalculationInput`/`DeltaPreview` shapes
 * (`corrections.types.ts`) — never re-derived client-side (Checkpoint 6's own "do not reproduce
 * financial calculations in React" rule). `delta.amount` is signed: positive = PAYABLE,
 * negative = RECOVERY, matching the backend's own documented sign convention. */
export interface CorrectionPreview {
  payrollEntryId: string;
  field: CorrectionField;
  oldValue: string;
  newValue: string;
  oldNetSalary: string;
  newNetSalary: string;
  delta: { amount: string; classification: 'PAYABLE' | 'RECOVERY' };
  reversesCorrectionId: string | null;
}

export interface Correction {
  id: string;
  payrollEntryId: string;
  field: CorrectionField;
  oldValue: string;
  newValue: string;
  oldNetSalary: string;
  newNetSalary: string;
  adjustmentTypeId: string;
  adjustmentType: { id: string; code: string; label: string };
  reversesCorrectionId: string | null;
  reason: string;
  approvedById: string;
  approvedBy?: { id: string; name: string; email: string };
  approvedAt: string;
}

export interface BalanceAdjustmentSummary {
  id: string;
  correctionId: string;
  employeeId: string;
  type: 'PAYABLE' | 'RECOVERY' | 'NONE';
  status: 'PENDING' | 'SETTLED';
  amount: string;
  remainingAmount: string;
  paymentTiming: 'IMMEDIATE' | 'DEFERRED' | null;
  recoveryInstallmentAmount: string | null;
}

export interface CorrectionRequest {
  id: string;
  payrollEntryId: string;
  payrollEntry: {
    id: string;
    employeeId: string;
    siteId: string;
    cycleId: string;
    employee: { id: string; name: string; employeeCode: string | null };
    cycle: { id: string; year: number; month: number };
  };
  field: CorrectionField;
  proposedNewValue: string;
  adjustmentTypeId: string;
  adjustmentType: { id: string; code: string; label: string };
  reason: string;
  requestedById: string;
  requestedBy: { id: string; name: string; email: string };
  requestedAt: string;
  status: CorrectionRequestStatus;
  reviewedById: string | null;
  reviewedBy: { id: string; name: string; email: string } | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  resultingCorrectionId: string | null;
  resultingCorrection: Correction | null;
}

export interface ApproveCorrectionRequestResult {
  correctionRequest: CorrectionRequest;
  correction: Correction;
  balanceAdjustment: BalanceAdjustmentSummary;
}

const CORRECTION_REQUESTS_QUERY_KEY = ['correction-requests'] as const;
const CORRECTION_HISTORY_QUERY_KEY = ['correction-history'] as const;

export function useCorrectionRequests(filters: ListCorrectionRequestsQuery = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.payrollEntryId) params.set('payrollEntryId', filters.payrollEntryId);
  const queryString = params.toString();

  return useQuery({
    queryKey: [...CORRECTION_REQUESTS_QUERY_KEY, filters],
    queryFn: () =>
      apiRequest<{ correctionRequests: CorrectionRequest[] }>(
        `/api/v1/correction-requests${queryString ? `?${queryString}` : ''}`,
      ).then((res) => res.correctionRequests),
  });
}

export function useCorrectionRequest(id: string | undefined) {
  return useQuery({
    queryKey: [...CORRECTION_REQUESTS_QUERY_KEY, id],
    queryFn: () =>
      apiRequest<{ correctionRequest: CorrectionRequest }>(`/api/v1/correction-requests/${id}`).then(
        (res) => res.correctionRequest,
      ),
    enabled: Boolean(id),
  });
}

/** Every approved `Correction` for one `PayrollEntry` — the entry's own immutable history, shown
 * from the Payroll Entry "Request correction" flow and from a Ledger row's source-entry link. */
export function useCorrectionHistoryForEntry(payrollEntryId: string | undefined) {
  return useQuery({
    queryKey: [...CORRECTION_HISTORY_QUERY_KEY, payrollEntryId],
    queryFn: () =>
      apiRequest<{ corrections: Correction[] }>(`/api/v1/payroll-entries/${payrollEntryId}/corrections`).then(
        (res) => res.corrections,
      ),
    enabled: Boolean(payrollEntryId),
  });
}

/** Advisory only — the backend's fresh transactional recalculation at approval time is always the
 * authoritative one (Checkpoint 6's own "Preview is advisory" rule). Not cached as a query: every
 * keystroke in the request/approval forms wants a fresh call, and `useMutation` naturally
 * supersedes an in-flight call when fired again rather than needing manual cancellation. */
export function usePreviewCorrection(payrollEntryId: string | undefined) {
  return useMutation({
    mutationFn: (input: PreviewCorrectionInput) =>
      apiRequest<{ preview: CorrectionPreview }>(`/api/v1/payroll-entries/${payrollEntryId}/corrections/preview`, {
        method: 'POST',
        body: input,
      }).then((res) => res.preview),
  });
}

export function useCreateCorrectionRequest(payrollEntryId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCorrectionRequestInput) =>
      apiRequest<{ correctionRequest: CorrectionRequest }>(
        `/api/v1/payroll-entries/${payrollEntryId}/correction-requests`,
        { method: 'POST', body: input },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CORRECTION_REQUESTS_QUERY_KEY });
    },
  });
}

export function useApproveCorrectionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ApproveCorrectionRequestInput }) =>
      apiRequest<ApproveCorrectionRequestResult>(`/api/v1/correction-requests/${id}/approve`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CORRECTION_REQUESTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['balance-adjustments'] });
      queryClient.invalidateQueries({ queryKey: CORRECTION_HISTORY_QUERY_KEY });
    },
  });
}

export function useRejectCorrectionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RejectCorrectionRequestInput }) =>
      apiRequest<{ correctionRequest: CorrectionRequest }>(`/api/v1/correction-requests/${id}/reject`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CORRECTION_REQUESTS_QUERY_KEY });
    },
  });
}
