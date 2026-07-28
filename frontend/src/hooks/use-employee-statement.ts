import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

/**
 * Phase 7A Checkpoint 2 — the frontend's own copy of the canonical Statement DTO shape
 * (`backend/src/modules/statements/statements.types.ts`), following this codebase's own
 * established convention of a frontend-local mirror rather than a cross-workspace import
 * (`PayslipListItem`/`use-payslips.ts`, `BalanceAdjustment`/`use-balance-adjustments.ts`) — the
 * backend module stays the single source of truth for what these fields *mean*; this file only
 * describes the wire shape so the frontend can read it.
 */

export type StatementLedgerCategory = 'SALARY' | 'CORRECTION' | 'ADVANCE';

export type StatementLedgerEventKind =
  | 'CYCLE_PAID'
  | 'CYCLE_NO_PAY_DUE'
  | 'CYCLE_RECOVERY_DUE'
  | 'CYCLE_PENDING'
  | 'CYCLE_LEGACY_NEGATIVE_ANOMALY'
  | 'CORRECTION_APPROVED'
  | 'BALANCE_ADJUSTMENT_CREATED'
  | 'BALANCE_ADJUSTMENT_SETTLED'
  | 'CORRECTION_PAYMENT'
  | 'ADVANCE_GIVEN'
  | 'ADVANCE_DEDUCTION_RESERVED'
  | 'ADVANCE_DEDUCTION_FINAL'
  | 'ADVANCE_SCHEDULE_CHANGED'
  | 'ADVANCE_PAID_OFF'
  | 'ADVANCE_CANCELLED';

export type StatementBalanceKind = 'PAYABLE' | 'RECOVERABLE' | 'ADVANCE';
export type StatementMovementDirection = 'INCREASE' | 'DECREASE';

export interface StatementMovement {
  balance: StatementBalanceKind;
  direction: StatementMovementDirection;
  amount: string;
}

export interface StatementBalances {
  payableOutstanding: string;
  recoveryOutstanding: string;
  advanceOutstanding: string;
}

export interface StatementLedgerReference {
  payrollEntryId?: string;
  correctionId?: string;
  balanceAdjustmentId?: string;
  balanceAdjustmentSettlementId?: string;
  correctionPaymentId?: string;
  advanceId?: string;
  advanceScheduleChangeId?: string;
}

export interface StatementLedgerEntry {
  id: string;
  date: string;
  cycleId: string | null;
  cycleYear: number | null;
  cycleMonth: number | null;
  category: StatementLedgerCategory;
  kind: StatementLedgerEventKind;
  isInformational: boolean;
  movement: StatementMovement | null;
  runningBalances: StatementBalances;
  description: string;
  reference: StatementLedgerReference;
  sequence: number;
}

export interface StatementEmployeeIdentity {
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  name: string;
  currentSiteId: string;
  currentSiteName: string;
}

export interface StatementCycleRef {
  id: string;
  year: number;
  month: number;
}

export interface StatementRange {
  fromCycle: StatementCycleRef | null;
  toCycle: StatementCycleRef | null;
  cycleCount: number;
}

export type AdvanceHistoryRestrictionReason = 'CURRENT_SITE_OUT_OF_SCOPE';

export interface StatementScope {
  advanceHistoryIncluded: boolean;
  advanceHistoryRestriction?: AdvanceHistoryRestrictionReason;
}

export interface EmployeeStatement {
  employee: StatementEmployeeIdentity;
  range: StatementRange;
  scope: StatementScope;
  openingBalances: StatementBalances;
  closingBalances: StatementBalances;
  entries: StatementLedgerEntry[];
  generatedAt: string;
}

export interface EmployeeStatementRangeParams {
  /** Both or neither — the backend rejects one without the other. Omitted entirely resolves to
   * the latest 12 `PayrollCycle` rows system-wide, computed server-side (`statements.service.ts`)
   * so this hook never needs its own copy of that default. */
  fromCycleId?: string;
  toCycleId?: string;
}

/** Builds the exact query string `GET /api/v1/employees/:employeeId/statement` accepts — pulled
 * out as a pure function so the request-shape contract (`employeeId` + optional `fromCycleId`/
 * `toCycleId`) is directly unit-testable without mounting the page or mocking `fetch`. */
export function employeeStatementUrl(employeeId: string, range: EmployeeStatementRangeParams): string {
  const params = new URLSearchParams();
  if (range.fromCycleId) params.set('fromCycleId', range.fromCycleId);
  if (range.toCycleId) params.set('toCycleId', range.toCycleId);
  const query = params.toString();
  return `/api/v1/employees/${employeeId}/statement${query ? `?${query}` : ''}`;
}

/**
 * The one read this checkpoint's frontend performs — a plain `GET`, never a mutation (Phase 7A
 * Checkpoint 2 brief §11: viewing a Statement must cause only the backend's own already-designed
 * `statement.viewed` audit entry, nothing else). `enabled` is false until a caller has resolved a
 * complete, valid selection (employee, and either both range cycles or neither) — the page itself
 * owns exactly what "complete" means, this hook just refuses to fire without an `employeeId`.
 * `fromCycleId`/`toCycleId` are part of the query key, so switching Site/Unit selection alone
 * (without changing the resolved employee or range) never triggers a refetch — see the page's own
 * "no repeated Statement fetch from unrelated selector state" requirement.
 */
export function useEmployeeStatement(employeeId: string | undefined, range: EmployeeStatementRangeParams) {
  return useQuery({
    queryKey: ['employee-statement', employeeId ?? '', range.fromCycleId ?? '', range.toCycleId ?? ''],
    queryFn: () => apiRequest<EmployeeStatement>(employeeStatementUrl(employeeId!, range)),
    enabled: Boolean(employeeId),
  });
}
