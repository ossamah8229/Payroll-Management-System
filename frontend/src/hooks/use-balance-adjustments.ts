import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BalanceAdjustmentPaymentTiming,
  BalanceAdjustmentStatus,
  BalanceAdjustmentType,
  ListBalanceAdjustmentsQuery,
  PreviewSettlementInput,
  RecordBalanceAdjustmentSettlementInput,
  RecordCorrectionPaymentInput,
} from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/** Mirrors the backend's own `balanceAdjustmentDetailInclude` (`corrections.repository.ts`)
 * verbatim — every field the Ledger, the detail page, and the settlement/payment forms need,
 * nothing re-derived client-side (Checkpoint 6's own "all authoritative values come from backend
 * APIs" rule). `remainingAmount` here is the *raw* remaining balance — it does **not** already
 * subtract active reservations; `activeReservedAmount`/`availableForSettlement` come from the
 * materializations list + the settlement preview response, never computed here. */
export interface BalanceAdjustment {
  id: string;
  correctionId: string;
  correction: { id: string; field: string; payrollEntryId: string };
  employeeId: string;
  employee: { id: string; name: string; employeeCode: string | null; siteId: string; dateOfLeaving: string | null };
  sourceCycleId: string;
  sourceCycle: { id: string; year: number; month: number };
  adjustmentTypeId: string;
  adjustmentType: { id: string; code: string; label: string };
  amount: string;
  type: BalanceAdjustmentType;
  status: BalanceAdjustmentStatus;
  paymentTiming: BalanceAdjustmentPaymentTiming | null;
  recoveryInstallmentAmount: string | null;
  remainingAmount: string;
  remark: string;
  settledInCycleId: string | null;
  settledInCycle: { id: string; year: number; month: number } | null;
  settledAt: string | null;
  createdAt: string;
  correctionPayment: CorrectionPayment | null;
  settlements: BalanceAdjustmentSettlement[];
}

export interface CorrectionPayment {
  id: string;
  balanceAdjustmentId: string;
  employeeId: string;
  amount: string;
  bankId: string | null;
  branchCode: string | null;
  accountNumber: string | null;
  iban: string | null;
  paidAt: string;
  paidById: string;
}

export interface BalanceAdjustmentSettlement {
  id: string;
  balanceAdjustmentId: string;
  cycleId: string;
  cycle: { id: string; year: number; month: number };
  amountApplied: string;
  appliedAt: string;
}

export interface BalanceAdjustmentMaterialization {
  id: string;
  balanceAdjustmentId: string;
  payrollEntryId: string;
  cycleId: string;
  cycle: { id: string; year: number; month: number };
  amount: string;
  status: 'ACTIVE' | 'CONSUMED' | 'CANCELLED';
  settlementId: string | null;
  consumedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface SettlementCalculationResult {
  acceptedAmount: string;
  newRemainingAmount: string;
  newStatus: BalanceAdjustmentStatus;
  fullySettled: boolean;
}

const BALANCE_ADJUSTMENTS_QUERY_KEY = ['balance-adjustments'] as const;
const SETTLEMENTS_QUERY_KEY = ['balance-adjustment-settlements'] as const;
const MATERIALIZATIONS_QUERY_KEY = ['balance-adjustment-materializations'] as const;

/** The Corrections Ledger's own data source (Phase 6 Checkpoint 6). */
export function useBalanceAdjustments(filters: ListBalanceAdjustmentsQuery = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  const queryString = params.toString();

  return useQuery({
    queryKey: [...BALANCE_ADJUSTMENTS_QUERY_KEY, filters],
    queryFn: () =>
      apiRequest<{ balanceAdjustments: BalanceAdjustment[] }>(
        `/api/v1/balance-adjustments${queryString ? `?${queryString}` : ''}`,
      ).then((res) => res.balanceAdjustments),
  });
}

export function useBalanceAdjustment(id: string | undefined) {
  return useQuery({
    queryKey: [...BALANCE_ADJUSTMENTS_QUERY_KEY, id],
    queryFn: () =>
      apiRequest<{ balanceAdjustment: BalanceAdjustment }>(`/api/v1/balance-adjustments/${id}`).then(
        (res) => res.balanceAdjustment,
      ),
    enabled: Boolean(id),
  });
}

export function useBalanceAdjustmentSettlements(id: string | undefined) {
  return useQuery({
    queryKey: [...SETTLEMENTS_QUERY_KEY, id],
    queryFn: () =>
      apiRequest<{ settlements: BalanceAdjustmentSettlement[] }>(
        `/api/v1/balance-adjustments/${id}/settlements`,
      ).then((res) => res.settlements),
    enabled: Boolean(id),
  });
}

/** Reservation state (Checkpoint 5/5A) — every `ACTIVE` row here is money already headed for
 * payment/deduction through its own Draft cycle's release, and therefore unavailable for a second,
 * independent settlement (`RESERVED_AMOUNT_UNAVAILABLE`). */
export function useBalanceAdjustmentMaterializations(id: string | undefined) {
  return useQuery({
    queryKey: [...MATERIALIZATIONS_QUERY_KEY, id],
    queryFn: () =>
      apiRequest<{ materializations: BalanceAdjustmentMaterialization[] }>(
        `/api/v1/balance-adjustments/${id}/materializations`,
      ).then((res) => res.materializations),
    enabled: Boolean(id),
  });
}

/** Advisory dry run of either settlement path — never persists anything. Surfaces
 * `RESERVED_AMOUNT_UNAVAILABLE`/`OVER_SETTLEMENT`/`DEPARTED_EMPLOYEE_RECOVERY_PENDING` the same
 * way the recording mutation below does, so a form can show the same error before the user even
 * submits. */
export function usePreviewSettlement(balanceAdjustmentId: string | undefined) {
  return useMutation({
    mutationFn: (input: PreviewSettlementInput) =>
      apiRequest<{ preview: SettlementCalculationResult }>(
        `/api/v1/balance-adjustments/${balanceAdjustmentId}/settlements/preview`,
        { method: 'POST', body: input },
      ).then((res) => res.preview),
  });
}

function invalidateBalanceAdjustmentQueries(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  queryClient.invalidateQueries({ queryKey: BALANCE_ADJUSTMENTS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: [...SETTLEMENTS_QUERY_KEY, id] });
}

export function useRecordCorrectionPayment(balanceAdjustmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordCorrectionPaymentInput) =>
      apiRequest<{ balanceAdjustment: BalanceAdjustment; correctionPayment: CorrectionPayment }>(
        `/api/v1/balance-adjustments/${balanceAdjustmentId}/payments`,
        { method: 'POST', body: input },
      ),
    onSuccess: () => invalidateBalanceAdjustmentQueries(queryClient, balanceAdjustmentId),
  });
}

export function useRecordBalanceAdjustmentSettlement(balanceAdjustmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordBalanceAdjustmentSettlementInput) =>
      apiRequest<{ balanceAdjustment: BalanceAdjustment; settlement: BalanceAdjustmentSettlement }>(
        `/api/v1/balance-adjustments/${balanceAdjustmentId}/settlements`,
        { method: 'POST', body: input },
      ),
    onSuccess: () => invalidateBalanceAdjustmentQueries(queryClient, balanceAdjustmentId),
  });
}
