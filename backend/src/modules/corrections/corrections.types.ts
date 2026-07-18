import type { CorrectionField } from '@payroll/shared';

/**
 * Phase 6 Checkpoint 2 (Baseline Reconstruction & Delta Calculation Engine — pure calculation
 * only, no side effects). Shared domain types for the correction calculation engine, kept
 * independent of both Prisma's generated types and any HTTP concern so Checkpoint 3
 * (transactional approval/settlement) and Checkpoint 5 (frontend workflow, via the eventual API
 * layer) can consume them without redesign — `docs/architecture/workflows/
 * corrections-and-balance-adjustments.md`, Product Decision Resolution (2026-07-18).
 */

/** Every domain-validation failure this engine can raise, deliberately **not** an `HttpError`
 * (`backend/src/common/http-error.ts`) — this checkpoint has no HTTP surface, and mapping a code
 * to a status code is Checkpoint 4's job, not this one's. */
export type CorrectionValidationErrorCode =
  | 'UNSUPPORTED_FIELD'
  | 'IMMUTABLE_FIELD'
  | 'INVALID_ADJUSTMENT_TYPE'
  | 'SPLIT_WORK_LINE_RESTRICTED'
  | 'ZERO_DELTA'
  | 'INVALID_NUMERIC_VALUE'
  | 'ENTRY_NOT_RELEASED'
  | 'MALFORMED_ENUM_COMBINATION'
  | 'REVERSAL_TARGET_NOT_FOUND'
  | 'REVERSAL_TARGET_MISMATCH'
  | 'REVERSAL_SELF_REFERENCE'
  | 'ENTRY_NOT_FOUND';

/** The typed shape every `CorrectionValidationError` carries — exported separately from the error
 * class itself so a caller can build/inspect this shape (e.g. for a future API error response)
 * without needing an `Error` instance. */
export interface CorrectionValidationErrorDetails {
  code: CorrectionValidationErrorCode;
  message: string;
  /** The specific `CorrectionField` this failure concerns, when applicable — absent for
   * entry-level failures like `ENTRY_NOT_RELEASED`/`ENTRY_NOT_FOUND`. */
  field?: CorrectionField;
}

/** Thrown by every pure validation/calculation function in this module — never an `HttpError`.
 * Deliberately a plain domain error: no `statusCode`, no knowledge that HTTP exists at all. */
export class CorrectionValidationError extends Error implements CorrectionValidationErrorDetails {
  public readonly code: CorrectionValidationErrorCode;
  public readonly field?: CorrectionField;

  constructor(details: CorrectionValidationErrorDetails) {
    super(details.message);
    this.name = 'CorrectionValidationError';
    this.code = details.code;
    this.field = details.field;
  }
}

/** One field's currently-understood value, and — when an approved `Correction` produced it,
 * rather than the original `PayrollEntry`/`PayrollEntryWorkLine` row — which one. Never cached;
 * always the output of a fresh replay (`docs/architecture/workflows/
 * corrections-and-balance-adjustments.md`, "Baseline Reconstruction for Sequential Corrections"). */
export interface EffectiveFieldValue {
  field: CorrectionField;
  /** String representation, same wire convention as `Correction.newValue`/`.oldValue`. `null`
   * only for a work-line-scoped field (`DAYS`/`OT_HOURS`/`OT_RATE`/`CYCLE_DAYS`) on an entry that
   * currently has more than one `PayrollEntryWorkLine` — never correctable for such an entry
   * (Product Decision Resolution Q1), so there is no single value to report. */
  value: string | null;
  /** `null` when this field has never been corrected — the value is still the original
   * `PayrollEntry`/`PayrollEntryWorkLine` figure (or, for `LEAVE_RATE`/`OT_RATE`, `calcNet`'s own
   * derived rate when the stored column is itself null). */
  sourceCorrectionId: string | null;
}

/** The full reconstructed "current effective state" of one `PayrollEntry`, immediately before a
 * new correction — the output of replaying every approved `Correction` against it. */
export interface ReconstructedBaseline {
  payrollEntryId: string;
  /** One entry per `CorrectionField`, in enum declaration order — always all 13, regardless of
   * how many have ever been corrected. */
  fields: EffectiveFieldValue[];
  /** `calcNet` result over the fully reconstructed state (every field's current effective
   * value applied) — the "old net salary" baseline for a new correction against any field. */
  netSalary: string;
}

/** The signed monetary result of one correction, classified per
 * `docs/architecture/workflows/corrections-and-balance-adjustments.md` §4's sign convention.
 * `NONE` is deliberately not a member here — a net-zero delta is rejected by this engine
 * (`ZERO_DELTA`) before a preview is ever produced; see `corrections.calculation.ts`'s own
 * module comment for why this diverges from the settlement layer's own `BalanceAdjustmentType.NONE`. */
export interface DeltaPreview {
  /** Signed decimal string — positive for Balance Salary Payable, negative for Recovery. Never
   * `"0.00"` (that case throws `ZERO_DELTA` instead of returning a result). */
  amount: string;
  classification: 'PAYABLE' | 'RECOVERY';
}

/** The full preview of one proposed correction against one field of one `PayrollEntry` — exactly
 * the shape `Correction.oldValue`/`.newValue`/`.oldNetSalary`/`.newNetSalary` will be populated
 * from once Checkpoint 3 actually persists one. Never persisted by this checkpoint itself. */
export interface CorrectionPreview {
  payrollEntryId: string;
  field: CorrectionField;
  oldValue: string;
  newValue: string;
  oldNetSalary: string;
  newNetSalary: string;
  delta: DeltaPreview;
  /** Echoes the caller's requested reversal target, once validated — `null` for an ordinary,
   * non-reversing correction. */
  reversesCorrectionId: string | null;
}

/** Minimal shape this module needs from a `Correction` row — deliberately narrower than Prisma's
 * generated `Correction` type so the pure functions in `corrections.calculation.ts` never depend
 * on `@prisma/client` at all (Principle 5: pure, testable with plain object literals). */
export interface CorrectionHistoryRecord {
  id: string;
  payrollEntryId: string;
  field: CorrectionField;
  newValue: string;
  approvedAt: Date;
}

/** The caller-supplied request this engine calculates a preview for — the pure-function input
 * counterpart to the eventual `CorrectionRequest`/direct-correction API payload (Checkpoint 4). */
export interface CorrectionCalculationInput {
  field: CorrectionField;
  proposedNewValue: string;
  adjustmentTypeId: string;
  reversesCorrectionId?: string | null;
}
