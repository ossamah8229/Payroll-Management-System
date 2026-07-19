import { Decimal } from 'decimal.js';
import type { MaterializationDecision, MaterializationEligibilityInput } from './corrections.materialization.types';

/**
 * Phase 6 Checkpoint 5 — pure eligibility and amount-selection logic. No Prisma, no I/O, no
 * `Date.now()` — the same discipline `corrections.calculation.ts`/`corrections.settlement.ts`
 * established for Checkpoints 2 and 4. All arithmetic via `decimal.js`.
 *
 * Checked in this exact order (each an independent, named skip reason, never a generic failure):
 * 1. Target cycle must be `DRAFT`.
 * 2. Not already materialized into this exact target cycle (idempotency).
 * 3. The adjustment must not already be fully `SETTLED`.
 * 4. The adjustment type must be one this checkpoint supports for cycle materialization:
 *    `RECOVERY`, or `PAYABLE` with `paymentTiming = DEFERRED` — `NONE` is never reachable (already
 *    `SETTLED` at creation) and `IMMEDIATE PAYABLE` has its own standalone `CorrectionPayment`
 *    path (Checkpoint 4), never a cycle materialization concept.
 * 5. The employee must have a `PayrollEntry` in the target cycle at all.
 * 6. That `PayrollEntry` must not already be released (Checkpoint 7 — see `.types.ts`'s own
 *    `targetEntryReleased` comment for why).
 * 7. `RECOVERY` against a departed employee is permanently pending — no materialization.
 * 8. `remainingAmount` must be positive.
 * 9. `availableToMaterialize` (`remainingAmount - activeReservedAmount`, the reservation ledger —
 *    see this module's sibling `.types.ts` file) must be positive.
 */
export function determineMaterialization(input: MaterializationEligibilityInput): MaterializationDecision {
  if (input.targetCycleStatus !== 'DRAFT') {
    return { eligible: false, reason: 'TARGET_NOT_DRAFT' };
  }
  if (input.alreadyMaterializedForTargetCycle) {
    return { eligible: false, reason: 'ALREADY_MATERIALIZED' };
  }
  if (input.adjustmentStatus === 'SETTLED') {
    return { eligible: false, reason: 'FULLY_SETTLED' };
  }
  if (input.adjustmentType === 'NONE') {
    return { eligible: false, reason: 'UNSUPPORTED_ADJUSTMENT_TYPE' };
  }
  if (input.adjustmentType === 'PAYABLE' && input.paymentTiming !== 'DEFERRED') {
    return { eligible: false, reason: 'UNSUPPORTED_ADJUSTMENT_TYPE' };
  }
  if (!input.targetEntryExists) {
    return { eligible: false, reason: 'EMPLOYEE_NOT_ELIGIBLE' };
  }
  if (input.targetEntryReleased) {
    return { eligible: false, reason: 'TARGET_ENTRY_ALREADY_RELEASED' };
  }
  if (input.adjustmentType === 'RECOVERY' && input.employeeDeparted) {
    return { eligible: false, reason: 'DEPARTED_EMPLOYEE_RECOVERY' };
  }

  const remainingAmount = new Decimal(input.remainingAmount);
  if (remainingAmount.lessThanOrEqualTo(0)) {
    return { eligible: false, reason: 'NO_REMAINING_AMOUNT' };
  }

  const activeReservedAmount = new Decimal(input.activeReservedAmount);
  const availableToMaterialize = remainingAmount.minus(activeReservedAmount);
  if (availableToMaterialize.lessThanOrEqualTo(0)) {
    return { eligible: false, reason: 'NO_AVAILABLE_AMOUNT' };
  }

  // PAYABLE (DEFERRED) always materializes its entire availability in one shot — mirrors
  // `calculateStandalonePayment`'s own "no partial CorrectionPayment" rule (Checkpoint 4).
  if (input.adjustmentType === 'PAYABLE') {
    return { eligible: true, amount: availableToMaterialize.toFixed(2) };
  }

  // RECOVERY: min(availableToMaterialize, recoveryInstallmentAmount ?? availableToMaterialize) —
  // exactly the brief's own stated rule. A null recoveryInstallmentAmount is not "missing" — the
  // schema's own documented meaning is "recover the full remaining amount in one cycle."
  const installment = input.recoveryInstallmentAmount ? new Decimal(input.recoveryInstallmentAmount) : availableToMaterialize;
  const amount = Decimal.min(installment, availableToMaterialize);
  return { eligible: true, amount: amount.toFixed(2) };
}
