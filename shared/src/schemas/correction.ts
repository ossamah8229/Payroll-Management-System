import { z } from 'zod';
import { decimalString, emptyToNull, optionalTrimmedString, optionalUppercaseString } from './common';

/**
 * Phase 6 Checkpoint 1 (Corrections & Balance Adjustments — domain and schema foundation only).
 * Mirrors Prisma's `CorrectionField`/`CorrectionRequestStatus`/`BalanceAdjustmentType`/
 * `BalanceAdjustmentStatus`/`BalanceAdjustmentPaymentTiming` enums exactly (`backend/prisma/
 * schema.prisma`, `docs/architecture/database/corrections.md` §13/§13a, `docs/architecture/
 * database/balance-adjustments.md` §14) — closed, code-coupled sets (`docs/architecture/database/
 * conventions-and-enums.md` §1), the same convention every other Prisma enum in this codebase
 * already follows (e.g. `advanceTypeSchema` in `./advance.ts`).
 *
 * The enum mirrors below are Checkpoint 1's own. Checkpoint 3 (transactional request/approval)
 * adds the mutation/query input schemas further down this file.
 */

export const correctionFieldSchema = z.enum([
  'GROSS_PAY',
  'DAYS',
  'OT_HOURS',
  'OT_RATE',
  'ALLOWANCE',
  'LEAVE_DAYS',
  'LEAVE_RATE',
  'CYCLE_DAYS',
  'EOBI_AMOUNT',
  'EOBI_APPLICABLE',
  'ADVANCE_DEDUCTION',
  'EID_ADVANCE_DEDUCTION',
  'FINE',
]);
export type CorrectionField = z.infer<typeof correctionFieldSchema>;

/** The four fields that live on `PayrollEntryWorkLine`, not `PayrollEntry` — restricted to
 * single-work-line entries only (Phase 6 Architecture Review Decision 1 / Product Decision
 * Resolution Q1, 2026-07-18). Exported so the one future validation call site (Checkpoint 2's
 * baseline-reconstruction/request-validation logic) has a single authoritative list to check
 * against, rather than re-deriving it. */
export const WORK_LINE_CORRECTION_FIELDS: readonly CorrectionField[] = [
  'DAYS',
  'OT_HOURS',
  'OT_RATE',
  'CYCLE_DAYS',
];

export const correctionRequestStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type CorrectionRequestStatus = z.infer<typeof correctionRequestStatusSchema>;

export const balanceAdjustmentTypeSchema = z.enum(['PAYABLE', 'RECOVERY', 'NONE']);
export type BalanceAdjustmentType = z.infer<typeof balanceAdjustmentTypeSchema>;

export const balanceAdjustmentStatusSchema = z.enum(['PENDING', 'SETTLED']);
export type BalanceAdjustmentStatus = z.infer<typeof balanceAdjustmentStatusSchema>;

export const balanceAdjustmentPaymentTimingSchema = z.enum(['IMMEDIATE', 'DEFERRED']);
export type BalanceAdjustmentPaymentTiming = z.infer<typeof balanceAdjustmentPaymentTimingSchema>;

/**
 * Phase 6 Checkpoint 3 (Transactional Correction Approval & Balance Adjustment Creation).
 *
 * `proposedNewValue`/`amount` fields below are transported as a plain, non-empty, <=80-char
 * string — the same `varchar(80)` wire convention `Correction.newValue`/
 * `CorrectionRequest.proposedNewValue` already use — never a typed `decimalString` regex, since a
 * `CorrectionField` value may be a decimal (most fields), an integer (`CYCLE_DAYS`), or the
 * literal string `"true"`/`"false"` (`EOBI_APPLICABLE`). Per-field shape/bounds validation is the
 * calculation engine's job (`backend/src/modules/corrections/corrections.calculation.ts`'s
 * `parseAndValidateFieldValue`), not this schema's — the same division of labor Checkpoint 2
 * already established between Zod (transport shape) and the domain engine (semantic validity).
 */
const correctionFieldValueString = z.string().trim().min(1, 'A value is required').max(80);

/** Submits a `CorrectionRequest` against one field of a released `PayrollEntry`
 * (`POST /payroll-entries/:entryId/correction-requests`, `payroll:entry`) — "any authorized
 * payroll user may propose a correction" (Product Decision Resolution). The server always
 * recomputes the baseline/delta itself at approval time; nothing here is trusted as a frozen
 * calculation. **No `reversesCorrectionId` here** — `CorrectionRequest` (`backend/prisma/
 * schema.prisma`) has no such column; a reversal is only ever declared at approval time (below),
 * matching the Architecture Review's own wording ("the direct-correction and request-approval
 * endpoints accept an optional reversesCorrectionId") — a requester proposes a value, only the
 * approving Master User declares that value a reversal of a specific prior `Correction`. */
export const createCorrectionRequestSchema = z.object({
  field: correctionFieldSchema,
  proposedNewValue: correctionFieldValueString,
  adjustmentTypeId: z.string().uuid('An Adjustment Type is required'),
  reason: z.string().trim().min(1, 'A reason is required'),
});
export type CreateCorrectionRequestInput = z.infer<typeof createCorrectionRequestSchema>;

/** Dry-run preview of a correction's calculated delta — never persists anything
 * (`POST /payroll-entries/:entryId/corrections/preview`, `payroll:entry` or
 * `corrections:approve`). Unlike request creation, a preview *does* accept `reversesCorrectionId`
 * — it mirrors what either a direct correction or an approval-time calculation would actually
 * compute, and both of those accept it. */
export const previewCorrectionSchema = createCorrectionRequestSchema.omit({ reason: true }).extend({
  reversesCorrectionId: z.string().uuid().nullable().optional(),
});
export type PreviewCorrectionInput = z.infer<typeof previewCorrectionSchema>;

/**
 * Approves a `PENDING` `CorrectionRequest` (`POST /correction-requests/:id/approve`,
 * `corrections:approve`). Every field here is an optional override of the request's own stored
 * proposal — "the Master User may adjust the proposed field/value/Adjustment Type before
 * confirming" (`docs/architecture/workflows/corrections-and-balance-adjustments.md`) — omitted
 * fields fall back to what the requester originally proposed. `reversesCorrectionId` is the one
 * field with no request-side default (the requester never proposed one) — provide it here to
 * declare this approval a reversal of a specific prior `Correction` against the same entry+field.
 * `paymentTiming` is required only when the recalculated delta turns out `PAYABLE` (checked
 * server-side once the sign is known, not here — this schema cannot know the sign in advance);
 * `recoveryInstallmentAmount` is always optional (`NULL` legitimately means "recover the full
 * balance next cycle").
 */
export const approveCorrectionRequestSchema = z.object({
  field: correctionFieldSchema.optional(),
  proposedNewValue: correctionFieldValueString.optional(),
  adjustmentTypeId: z.string().uuid().optional(),
  reversesCorrectionId: z.string().uuid().nullable().optional(),
  paymentTiming: balanceAdjustmentPaymentTimingSchema.optional(),
  recoveryInstallmentAmount: z.preprocess(emptyToNull, z.string().trim().min(1).max(80).nullable().optional()),
});
export type ApproveCorrectionRequestInput = z.infer<typeof approveCorrectionRequestSchema>;

/** Rejects a `PENDING` `CorrectionRequest` (`POST /correction-requests/:id/reject`,
 * `corrections:approve`) — mandatory reason, mirroring `Correction.reason`'s own convention. */
export const rejectCorrectionRequestSchema = z.object({
  rejectionReason: z.string().trim().min(1, 'A rejection reason is required'),
});
export type RejectCorrectionRequestInput = z.infer<typeof rejectCorrectionRequestSchema>;

/** `GET /correction-requests` (`corrections:approve`) — the Master User's review queue, filterable
 * by status and/or the source entry. Both optional; an empty query lists everything. */
export const listCorrectionRequestsQuerySchema = z.object({
  status: correctionRequestStatusSchema.optional(),
  payrollEntryId: z.string().uuid().optional(),
});
export type ListCorrectionRequestsQuery = z.infer<typeof listCorrectionRequestsQuerySchema>;

/**
 * Phase 6 Checkpoint 4 (Settlement, Payment Recording & Outstanding Balance Lifecycle).
 *
 * Records a standalone `CorrectionPayment` (`POST /balance-adjustments/:id/payments`,
 * `corrections:approve`) — the one-shot, out-of-cycle, full-settlement path for a `PAYABLE`
 * `BalanceAdjustment` with no open `PayrollEntry` to fold into. No `amount` field — a
 * `CorrectionPayment` always settles the *entire* remaining balance (the schema's own `@unique`
 * constraint on `balanceAdjustmentId`), never a partial one. Every banking field is optional,
 * mirroring `Employee`/`PayrollEntry`'s own "no bankId means cash" convention — this checkpoint
 * does not invent a stricter rule the schema itself doesn't impose.
 */
export const recordCorrectionPaymentSchema = z.object({
  bankId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  branchCode: optionalTrimmedString(20),
  accountNumber: optionalTrimmedString(40),
  iban: optionalUppercaseString(34),
});
export type RecordCorrectionPaymentInput = z.infer<typeof recordCorrectionPaymentSchema>;

/** Records an immutable `BalanceAdjustmentSettlement` — the repeatable, cycle-scoped, partial-or-
 * full ledger entry (`POST /balance-adjustments/:id/settlements`, `corrections:approve`). Used for
 * both `RECOVERY` installments and a `DEFERRED PAYABLE`'s eventual settlement. `cycleId` is
 * mandatory (the schema's own `BalanceAdjustmentSettlement.cycleId` is non-nullable) — Checkpoint
 * 4 does not auto-discover "the next Draft cycle" (that is Draft-cycle materialization, explicitly
 * out of this checkpoint's scope); the caller records which cycle the settlement actually applied
 * against. */
export const recordBalanceAdjustmentSettlementSchema = z.object({
  cycleId: z.string().uuid('A PayrollCycle is required'),
  amount: decimalString,
});
export type RecordBalanceAdjustmentSettlementInput = z.infer<typeof recordBalanceAdjustmentSettlementSchema>;

/** Dry-run preview of either settlement path — never persists anything
 * (`POST /balance-adjustments/:id/settlements/preview`, `payroll:entry` or `corrections:approve`).
 * `amount` is omitted for a standalone-payment preview (always the full remaining balance,
 * mirroring `recordCorrectionPaymentSchema`'s own omission), required otherwise. */
export const previewSettlementSchema = z.object({
  mode: z.enum(['STANDALONE', 'CYCLE_SCOPED']),
  amount: z.preprocess(emptyToNull, decimalString.nullable().optional()),
});
export type PreviewSettlementInput = z.infer<typeof previewSettlementSchema>;

/** `GET /balance-adjustments` (Phase 6 Checkpoint 6) — the Corrections Ledger's own list query,
 * filterable by status/type/employee. Every filter optional; an empty query lists everything the
 * caller's own site access permits. */
export const listBalanceAdjustmentsQuerySchema = z.object({
  status: balanceAdjustmentStatusSchema.optional(),
  type: balanceAdjustmentTypeSchema.optional(),
  employeeId: z.string().uuid().optional(),
});
export type ListBalanceAdjustmentsQuery = z.infer<typeof listBalanceAdjustmentsQuerySchema>;

/**
 * Phase 6 Checkpoint 5 (Draft-Cycle Materialization). `targetCycleId` is always optional —
 * omitted, it resolves to the current Draft cycle server-side (`getCurrentDraftCycle`); provided,
 * it must itself still be `DRAFT` at materialization time (re-checked transactionally, never
 * trusted from this input alone). Used identically by the single-adjustment preview/create routes.
 */
export const materializeBalanceAdjustmentSchema = z.object({
  targetCycleId: z.string().uuid().optional(),
});
export type MaterializeBalanceAdjustmentInput = z.infer<typeof materializeBalanceAdjustmentSchema>;
