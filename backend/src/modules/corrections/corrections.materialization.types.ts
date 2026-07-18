/**
 * Phase 6 Checkpoint 5 (Draft-Cycle Materialization of Outstanding Balance Adjustments). Shared
 * domain types for the materialization engine — independent of Prisma's generated types and any
 * HTTP concern, the same discipline `corrections.types.ts`/`corrections.settlement.types.ts`
 * established for Checkpoints 2–4.
 *
 * **Materialization is not settlement.** A `BalanceAdjustmentMaterialization` row is a
 * *reservation* — it reduces what can be materialized into a *future* cycle for the same
 * adjustment, but never touches `BalanceAdjustment.remainingAmount`/`.status`, `CorrectionPayment`,
 * or `BalanceAdjustmentSettlement` (`backend/prisma/schema.prisma`'s own model comment). The
 * `ACTIVE -> CONSUMED` transition (an actual settlement realizing a reservation) is explicitly a
 * later checkpoint's own event, not built here.
 */

export type MaterializationSkipReason =
  | 'ALREADY_MATERIALIZED'
  | 'FULLY_SETTLED'
  | 'NO_REMAINING_AMOUNT'
  | 'NO_AVAILABLE_AMOUNT'
  | 'TARGET_NOT_DRAFT'
  | 'DEPARTED_EMPLOYEE_RECOVERY'
  | 'EMPLOYEE_NOT_ELIGIBLE'
  | 'UNSUPPORTED_ADJUSTMENT_TYPE';

/** Orchestration-level failure — no specific `BalanceAdjustment` to evaluate against yet. */
export type MaterializationOrchestrationErrorCode = 'NO_CURRENT_DRAFT' | 'TARGET_NOT_DRAFT' | 'BALANCE_ADJUSTMENT_NOT_FOUND';

export interface MaterializationValidationErrorDetails {
  code: MaterializationOrchestrationErrorCode;
  message: string;
}

/** Thrown by orchestration-level failures (no target cycle, wrong cycle status, missing
 * adjustment) — matching `SettlementValidationError`'s own design (Checkpoint 4). Per-adjustment
 * eligibility failures are *not* thrown as errors — they are represented as a typed
 * `{ eligible: false, reason }` result (below), since "ineligible" is an expected, common outcome
 * for a batch scan, not an exceptional one. */
export class MaterializationValidationError extends Error implements MaterializationValidationErrorDetails {
  public readonly code: MaterializationOrchestrationErrorCode;

  constructor(details: MaterializationValidationErrorDetails) {
    super(details.message);
    this.name = 'MaterializationValidationError';
    this.code = details.code;
  }
}

export interface MaterializationEligibilityInput {
  adjustmentType: 'PAYABLE' | 'RECOVERY' | 'NONE';
  adjustmentStatus: 'PENDING' | 'SETTLED';
  paymentTiming: 'IMMEDIATE' | 'DEFERRED' | null;
  /** `BalanceAdjustment.remainingAmount` at read time. */
  remainingAmount: string;
  /** Sum of every `ACTIVE` `BalanceAdjustmentMaterialization.amount` for this adjustment, across
   * every cycle it has ever been reserved into — not just the target cycle. */
  activeReservedAmount: string;
  recoveryInstallmentAmount: string | null;
  employeeDeparted: boolean;
  targetCycleStatus: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
  /** Whether a `BalanceAdjustmentMaterialization` already exists for this exact
   * (`balanceAdjustmentId`, target `cycleId`) pair. */
  alreadyMaterializedForTargetCycle: boolean;
  /** Whether the employee has a `PayrollEntry` in the target cycle at all. */
  targetEntryExists: boolean;
}

export type MaterializationDecision =
  | { eligible: true; amount: string }
  | { eligible: false; reason: MaterializationSkipReason };

export interface MaterializationResult {
  balanceAdjustmentId: string;
  outcome: 'MATERIALIZED' | 'SKIPPED';
  amount?: string;
  reason?: MaterializationSkipReason;
  materializationId?: string;
}

export interface BatchMaterializationSummary {
  cycleId: string;
  materializedCount: number;
  skippedCount: number;
  results: MaterializationResult[];
}
