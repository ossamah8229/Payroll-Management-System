/**
 * Phase 6 Checkpoint 4 (Settlement, Payment Recording & Outstanding Balance Lifecycle). Shared
 * domain types for the settlement engine — independent of Prisma's generated types and any HTTP
 * concern, the same discipline `corrections.types.ts` established for Checkpoints 2/3.
 *
 * **Model responsibility (this checkpoint's own "First task"):** `CorrectionPayment` and
 * `BalanceAdjustmentSettlement` (`backend/prisma/schema.prisma`) are not duplicates — the schema's
 * own structural constraints already enforce a clean split:
 * - `CorrectionPayment.balanceAdjustmentId` is `@unique` — at most **one** per `BalanceAdjustment`,
 *   ever. It carries payment-*execution* metadata (`bankId`/`branchCode`/`accountNumber`/`iban`
 *   snapshot, `paidAt`, `paidById`) and no `cycleId` at all. It represents the **standalone,
 *   out-of-cycle, one-shot, full-settlement** payment — the one exception the workflow doc
 *   describes for an `IMMEDIATE PAYABLE` with no open `PayrollEntry` to fold into: "not part of
 *   any PayrollCycle's ordinary sheets... its own one-off document." `CorrectionPayment.amount`
 *   "always equals the settling BalanceAdjustment.remainingAmount at the moment of payment" — so
 *   there is no such thing as a *partial* `CorrectionPayment`.
 * - `BalanceAdjustmentSettlement` has `@@unique([balanceAdjustmentId, cycleId])` — **many** rows
 *   permitted per `BalanceAdjustment`, one per distinct cycle. `cycleId` is required (never null)
 *   and there is no payment-execution metadata at all — it is a pure **ledger** entry: "this
 *   cycle's release applied $X toward this BalanceAdjustment," partial or full, repeatable across
 *   cycles. This is the shape both `RECOVERY` installments and a `DEFERRED PAYABLE`'s eventual
 *   settlement use.
 *
 * The two axes — standalone-vs-cycle-scoped, and exactly-once-full-vs-repeatable-partial — are
 * genuinely distinct concerns with no overlap, confirmed by the schema's own unique constraints,
 * not merely by this checkpoint's own reading of prose. No schema defect exists; see this
 * checkpoint's final report for the full analysis. `CorrectionPayment` is additionally
 * `PAYABLE`-only (its bank/branch/account/iban fields have no meaning for a `RECOVERY`, where
 * money moves the other direction).
 */

export type SettlementValidationErrorCode =
  | 'BALANCE_ADJUSTMENT_NOT_FOUND'
  | 'ALREADY_SETTLED'
  | 'ZERO_SETTLEMENT_AMOUNT'
  | 'NEGATIVE_SETTLEMENT_AMOUNT'
  | 'INVALID_SETTLEMENT_AMOUNT'
  | 'OVER_SETTLEMENT'
  | 'RESERVED_AMOUNT_UNAVAILABLE'
  | 'WRONG_ADJUSTMENT_TYPE_FOR_PAYMENT'
  | 'DEPARTED_EMPLOYEE_RECOVERY_PENDING'
  | 'INVALID_BANK'
  | 'INVALID_CYCLE'
  | 'STALE_CONCURRENT_WRITE';

export interface SettlementValidationErrorDetails {
  code: SettlementValidationErrorCode;
  message: string;
}

/** Thrown by every pure/validation function in `corrections.settlement.ts` — never an `HttpError`,
 * matching `CorrectionValidationError`'s own design (Checkpoint 2). Kept as a distinct class
 * (not folded into `CorrectionValidationError`) since settlement is a genuinely separate concern
 * from correction calculation — its error codes describe settlement-lifecycle failures, not
 * baseline/delta ones. */
export class SettlementValidationError extends Error implements SettlementValidationErrorDetails {
  public readonly code: SettlementValidationErrorCode;

  constructor(details: SettlementValidationErrorDetails) {
    super(details.message);
    this.name = 'SettlementValidationError';
    this.code = details.code;
  }
}

export interface SettlementCalculationInput {
  /** `BalanceAdjustment.remainingAmount` at the moment this is calculated — always the freshly
   * re-read, post-lock value in the transactional path; the not-yet-locked value in a preview. */
  remainingAmount: string;
  /** `BalanceAdjustment.status` at the same moment. */
  status: 'PENDING' | 'SETTLED';
  /** The amount this settlement event proposes to apply. */
  proposedAmount: string;
  /** Sum of every `ACTIVE` `BalanceAdjustmentMaterialization` row for this adjustment, across every
   * Draft cycle — the same reservation ledger `corrections.materialization.ts`'s own
   * `availableToMaterialize` reads (Checkpoint 5). Money already reserved into a Draft cycle's own
   * `PayrollEntry.correctionBalancePayable`/`.correctionBalanceRecovery` (and therefore already
   * counted in that entry's `calcNet`) is not available for a *second*, independent settlement here
   * — settling it too would pay or deduct the same obligation twice, once through that cycle's
   * eventual release and once through this settlement. Defaults to `'0'` (no reservation) so every
   * existing caller/test that never mentions materialization keeps its exact prior behavior. */
  activeReservedAmount?: string;
}

export interface SettlementCalculationResult {
  /** Canonical (2dp) form of the accepted amount — identical to `proposedAmount` numerically,
   * never re-derived from anything else (Checkpoint 4 has no "auto-fill the rest" behavior). */
  acceptedAmount: string;
  newRemainingAmount: string;
  newStatus: 'PENDING' | 'SETTLED';
  fullySettled: boolean;
}
