import { z } from 'zod';
import { decimalString, emptyToNull, optionalTrimmedString } from './common';

/** Mirrors Prisma's `AdvanceType` enum exactly (Phase 4 Checkpoint 5, docs/architecture/database/
 * advances.md §15) — a closed, code-coupled set (docs/architecture/database/conventions-and-enums.md §1). */
export const advanceTypeSchema = z.enum(['LOAN', 'EID_ADVANCE']);
export type AdvanceType = z.infer<typeof advanceTypeSchema>;

/** Mirrors Prisma's `AdvanceRepaymentType` enum — informational only per the original spec ("no
 * auto-calculation of installment size"); does not drive any system-computed behavior on its own. */
export const advanceRepaymentTypeSchema = z.enum(['FULL_DEDUCTION', 'INSTALLMENT']);
export type AdvanceRepaymentType = z.infer<typeof advanceRepaymentTypeSchema>;

/** Mirrors Prisma's `AdvanceStatus` enum — `PAID_OFF` is reached only when `outstandingBalance`
 * decrements to zero; never set directly by a user action. `CANCELLED` (Operational Stabilization
 * Checkpoint, 2026-07-24) is the non-destructive correction for a mistakenly-recorded Advance — see
 * `cancelAdvanceSchema` below and `database/advances.md §15`'s "no hard delete" convention. Neither
 * `PAID_OFF` nor `CANCELLED` is ever set directly by a plain field edit (`updateAdvanceSchema`). */
export const advanceStatusSchema = z.enum(['ACTIVE', 'PAID_OFF', 'CANCELLED']);
export type AdvanceStatus = z.infer<typeof advanceStatusSchema>;

/**
 * Records a new Advance (Phase 4 Checkpoint 5). `originalPeriod` is the calendar month the first
 * deduction should be scheduled against — resolved server-side into a `ScheduledPayrollPeriod` via
 * Payroll Processing's own find-or-create function, never written to directly by this module.
 * `scheduledInstallmentAmount` is required when `repaymentType` is `INSTALLMENT` and the advance
 * should auto-materialize a deduction each cycle — omitted (null), it means "no standing schedule
 * yet," and the deduction must be entered manually in Payroll Entry instead (no value is ever
 * computed by the system, only repeated forward once staff sets it).
 */
export const createAdvanceSchema = z.object({
  employeeId: z.string().uuid('An employee is required'),
  type: advanceTypeSchema,
  totalAmount: decimalString,
  dateGiven: z.string().date(),
  repaymentType: advanceRepaymentTypeSchema,
  // Intentionally optional even for INSTALLMENT — a standing schedule can be set later via
  // updateAdvanceSchema, matching "no value is ever computed by the system, only repeated forward
  // until staff changes it."
  scheduledInstallmentAmount: z.preprocess(emptyToNull, decimalString.nullable().optional()),
  notes: optionalTrimmedString(2000),
  originalPeriod: z.object({
    year: z.number().int().min(2000).max(2999),
    month: z.number().int().min(1).max(12),
  }),
});

export type CreateAdvanceInput = z.infer<typeof createAdvanceSchema>;

/** Ordinary field edits to an already-created Advance (Operational Stabilization Checkpoint,
 * 2026-07-24 — widened from the original Phase 4 Checkpoint 5 shape to add `totalAmount`, per the
 * lifecycle-aware editability review). `outstandingBalance`, `type`, `status`, and every
 * scheduled-period field are still never directly editable here — they only ever change through the
 * system actions that own them (materialization, deferral, cancellation): editing them as plain
 * fields would let history be silently rewritten. `totalAmount` IS editable here, but the service
 * layer enforces it can never drop below what has already been repaid (`totalAmount -
 * outstandingBalance`) and rejects the edit entirely once `status` is `PAID_OFF`/`CANCELLED` — see
 * `advances.service.ts`'s `updateAdvance` for the full lifecycle-aware editability matrix. The
 * Advance's own "deduction start cycle" is deliberately still not editable through this endpoint at
 * any lifecycle stage — correct it via Cancel (pre-materialization) or Defer (post-materialization)
 * instead, never a silent field edit (see `cancelAdvanceSchema` and `deferAdvanceScheduleSchema`). */
export const updateAdvanceSchema = z.object({
  totalAmount: decimalString.optional(),
  repaymentType: advanceRepaymentTypeSchema.optional(),
  scheduledInstallmentAmount: z.preprocess(emptyToNull, decimalString.nullable().optional()),
  notes: optionalTrimmedString(2000),
});

export type UpdateAdvanceInput = z.infer<typeof updateAdvanceSchema>;

/**
 * Cancels (voids) an Advance — the non-destructive correction for one entered by mistake
 * (Operational Stabilization Checkpoint, 2026-07-24, `database/advances.md §15`). Only ever
 * transitions an `ACTIVE` Advance; a `PAID_OFF` or already-`CANCELLED` one has nothing to cancel.
 * `reason` is mandatory, matching this schema's existing convention for every other
 * financial-history-affecting action (`deferAdvanceScheduleSchema`, `BalanceAdjustment`).
 */
export const cancelAdvanceSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required'),
});

export type CancelAdvanceInput = z.infer<typeof cancelAdvanceSchema>;

/**
 * Defers an Advance's currently-materialized deduction to a future Draft-eligible payroll period
 * (BR-ADV-002–006, docs/architecture/database/advances.md §15/§15a). `payrollEntryId` identifies the
 * specific, still-Draft `PayrollEntry` this deduction is currently materialized on — deferral only
 * ever operates on a deduction that has already landed in a real entry, never on a not-yet-arrived
 * schedule. `reason` is mandatory (BR-ADV-004).
 */
export const deferAdvanceScheduleSchema = z.object({
  payrollEntryId: z.string().uuid(),
  toPeriod: z.object({
    year: z.number().int().min(2000).max(2999),
    month: z.number().int().min(1).max(12),
  }),
  reason: z.string().trim().min(1, 'A reason is required'),
});

export type DeferAdvanceScheduleInput = z.infer<typeof deferAdvanceScheduleSchema>;

export const listAdvancesQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  type: advanceTypeSchema.optional(),
  status: advanceStatusSchema.optional(),
});

export type ListAdvancesQuery = z.infer<typeof listAdvancesQuerySchema>;
