import { z } from 'zod';

/**
 * Phase 6 Checkpoint 1 (Corrections & Balance Adjustments — domain and schema foundation only).
 * Mirrors Prisma's `CorrectionField`/`CorrectionRequestStatus`/`BalanceAdjustmentType`/
 * `BalanceAdjustmentStatus`/`BalanceAdjustmentPaymentTiming` enums exactly (`backend/prisma/
 * schema.prisma`, `docs/architecture/database/corrections.md` §13/§13a, `docs/architecture/
 * database/balance-adjustments.md` §14) — closed, code-coupled sets (`docs/architecture/database/
 * conventions-and-enums.md` §1), the same convention every other Prisma enum in this codebase
 * already follows (e.g. `advanceTypeSchema` in `./advance.ts`).
 *
 * Deliberately just the enum mirrors — no request/response DTOs, no mutation input schemas. Those
 * belong to whichever later checkpoint introduces the route that needs them (Checkpoint 4); this
 * checkpoint has no HTTP surface yet.
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
