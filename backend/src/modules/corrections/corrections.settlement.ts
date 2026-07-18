import { Decimal } from 'decimal.js';
import {
  SettlementValidationError,
  type SettlementCalculationInput,
  type SettlementCalculationResult,
} from './corrections.settlement.types';

/**
 * Phase 6 Checkpoint 4 — the pure settlement calculation engine. No Prisma, no I/O, no
 * `Date.now()` — a caller can unit-test it with plain strings and get the exact same answer every
 * time (Principle 5), the same discipline `corrections.calculation.ts` established for Checkpoint
 * 2. All arithmetic via `decimal.js`, never native JS floats, matching this codebase's monetary
 * convention throughout.
 */

/**
 * Validates and applies one proposed settlement amount against a `BalanceAdjustment`'s current
 * state. Throws a typed `SettlementValidationError` for every invalid case; never silently clamps
 * or coerces. No hidden tolerance — `settlementAmount <= remainingAmount` is an exact decimal
 * comparison, not a fuzzy one, since this codebase's monetary framework (`decimal.js`, exact
 * 2dp figures throughout) has no notion of acceptable rounding slack for money.
 */
export function calculateSettlement(input: SettlementCalculationInput): SettlementCalculationResult {
  if (input.status === 'SETTLED') {
    throw new SettlementValidationError({
      code: 'ALREADY_SETTLED',
      message: 'This BalanceAdjustment is already fully settled and cannot accept another settlement.',
    });
  }

  let proposed: Decimal;
  try {
    proposed = new Decimal(input.proposedAmount);
  } catch {
    throw new SettlementValidationError({
      code: 'INVALID_SETTLEMENT_AMOUNT',
      message: `The settlement amount must be a valid number, got ${JSON.stringify(input.proposedAmount)}.`,
    });
  }
  if (!proposed.isFinite()) {
    throw new SettlementValidationError({
      code: 'INVALID_SETTLEMENT_AMOUNT',
      message: `The settlement amount must be a finite number, got ${JSON.stringify(input.proposedAmount)}.`,
    });
  }
  if (proposed.isZero()) {
    throw new SettlementValidationError({
      code: 'ZERO_SETTLEMENT_AMOUNT',
      message: 'The settlement amount must be greater than zero.',
    });
  }
  if (proposed.isNegative()) {
    throw new SettlementValidationError({
      code: 'NEGATIVE_SETTLEMENT_AMOUNT',
      message: 'The settlement amount must be positive.',
    });
  }

  const remaining = new Decimal(input.remainingAmount);
  if (proposed.greaterThan(remaining)) {
    throw new SettlementValidationError({
      code: 'OVER_SETTLEMENT',
      message: `The settlement amount (${proposed.toFixed(2)}) exceeds the current remaining balance (${remaining.toFixed(2)}).`,
    });
  }

  // Review Question 1 fix — a reservation-aware settlement ceiling, the settlement-side mirror of
  // `corrections.materialization.ts`'s own `availableToMaterialize`. Without this, an amount already
  // reserved into a Draft cycle's own PayrollEntry (and therefore already headed for that cycle's
  // release) could also be settled here, paying or deducting the same obligation twice.
  const activeReserved = new Decimal(input.activeReservedAmount ?? '0');
  const availableForSettlement = remaining.minus(activeReserved);
  if (proposed.greaterThan(availableForSettlement)) {
    throw new SettlementValidationError({
      code: 'RESERVED_AMOUNT_UNAVAILABLE',
      message: `The settlement amount (${proposed.toFixed(2)}) exceeds the amount available for settlement (${availableForSettlement.toFixed(2)}) — ${activeReserved.toFixed(2)} of the remaining balance (${remaining.toFixed(2)}) is already reserved by an active Draft-cycle materialization and must be resolved before it can also be settled here.`,
    });
  }

  const newRemainingAmount = remaining.minus(proposed);
  const fullySettled = newRemainingAmount.isZero();

  return {
    acceptedAmount: proposed.toFixed(2),
    newRemainingAmount: newRemainingAmount.toFixed(2),
    newStatus: fullySettled ? 'SETTLED' : 'PENDING',
    fullySettled,
  };
}

/** The one `CorrectionPayment`-specific rule `calculateSettlement` itself doesn't know about:
 * a standalone payment always settles the *entire* remaining balance in one shot (the schema's
 * own `@unique` constraint on `balanceAdjustmentId` and its "always equals ... remainingAmount"
 * column comment) — there is no partial `CorrectionPayment`. Returns the full remaining amount as
 * the accepted settlement amount, reusing `calculateSettlement` for every other rule (already
 * settled, zero/negative remaining edge cases) rather than re-deriving them. */
export function calculateStandalonePayment(input: Omit<SettlementCalculationInput, 'proposedAmount'>): SettlementCalculationResult {
  return calculateSettlement({ ...input, proposedAmount: input.remainingAmount });
}
