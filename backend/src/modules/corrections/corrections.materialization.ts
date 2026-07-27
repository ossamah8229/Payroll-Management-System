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

export interface ReleaseRecoveryAdjustment {
  /** The entry's true net salary for release-classification purposes — identical to
   * `calc.netSalary` unless a shortfall exists (below), in which case this is the *floor-adjusted*
   * figure that must be used instead, never the raw `calc.netSalary`. */
  adjustedNetSalary: string;
  /** How much of `calc.correctionBalanceRecovery` this cycle's release can actually settle against
   * the originating `BalanceAdjustment` — strictly less than `correctionBalanceRecovery` only when
   * this entry's own earnings can't cover the full scheduled deduction. */
  cappedRecoveryConsumption: string;
}

/**
 * Negative Payroll Recovery checkpoint (2026-07-26) — prevents a genuine double-counting bug:
 * when an entry's own `correctionBalanceRecovery` (a *prior* cycle's `RECOVERY` `BalanceAdjustment`
 * materialized into this cycle, via `determineMaterialization` above) is larger than what this
 * cycle's own earnings can actually absorb, `calcNet`'s `netSalary` goes negative purely as an
 * artifact of that already-existing obligation — not a *new* one. Without this adjustment,
 * `payroll-release.service.ts`'s release sweep would (wrongly) read that negative `netSalary` as
 * grounds to create a brand-new `RECOVERY` `BalanceAdjustment` for the shortfall, stacking a second
 * obligation on top of the first for the exact same debt.
 *
 * `baseNet` is this entry's earnings *before* this cycle's recovery deduction
 * (`netSalary + correctionBalanceRecovery` — algebraically exact, since `calcNet` computes
 * `netSalary = totalEarning - totalDeduction` and `correctionBalanceRecovery` is one additive term
 * of `totalDeduction`). Three cases, matching the accounting the checkpoint brief specifies:
 *
 * 1. `netSalary >= 0` (no shortfall — this cycle's earnings fully cover the recovery deduction and
 *    then some): no adjustment, `cappedRecoveryConsumption = correctionBalanceRecovery` in full.
 * 2. `netSalary < 0` and `baseNet >= 0` (earnings cover *some but not all* of the recovery
 *    deduction): the entry floors to exactly `0` (`No Pay Due`, never negative) and only `baseNet`
 *    of the recovery is actually consumed this cycle — the remainder (`correctionBalanceRecovery -
 *    baseNet`) stays owed on the *original* `BalanceAdjustment.remainingAmount` for a future cycle,
 *    never re-created as a new one.
 * 3. `netSalary < 0` and `baseNet < 0` (this entry is negative even setting the recovery deduction
 *    aside entirely — e.g. a large Advance/EID Advance/fine independently exceeds earnings): the
 *    existing recovery deduction consumes nothing this cycle (`cappedRecoveryConsumption = 0`,
 *    deferred whole to a future cycle) and `adjustedNetSalary = baseNet` becomes the basis for a
 *    *distinct*, new `RECOVERY_DUE` classification — a genuinely different obligation, not the same
 *    one being double-counted.
 */
export function computeReleaseRecoveryAdjustment(calc: {
  netSalary: string;
  correctionBalanceRecovery: string;
}): ReleaseRecoveryAdjustment {
  const netSalary = new Decimal(calc.netSalary);
  const materializedRecovery = new Decimal(calc.correctionBalanceRecovery);

  if (materializedRecovery.lessThanOrEqualTo(0) || netSalary.greaterThanOrEqualTo(0)) {
    return { adjustedNetSalary: netSalary.toFixed(2), cappedRecoveryConsumption: materializedRecovery.toFixed(2) };
  }

  const baseNet = netSalary.plus(materializedRecovery);
  const cappedRecoveryConsumption = Decimal.max(0, Decimal.min(materializedRecovery, baseNet));
  const adjustedNetSalary = baseNet.minus(cappedRecoveryConsumption);

  return {
    adjustedNetSalary: adjustedNetSalary.toFixed(2),
    cappedRecoveryConsumption: cappedRecoveryConsumption.toFixed(2),
  };
}
