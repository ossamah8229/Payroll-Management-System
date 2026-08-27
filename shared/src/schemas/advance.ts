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

/** Mirrors Prisma's `AdvanceStatus` enum. `RESERVED` (Presentation & Workflow Stabilization
 * Checkpoint, 2026-07-25) is reached the instant a deduction fully covering `outstandingBalance`
 * materializes into a Draft (unreleased) `PayrollEntry` — the amount is committed/reserved against
 * that entry, but nothing has actually been paid yet, so the Advance is deliberately *not* yet
 * `PAID_OFF`. `PAID_OFF` is reached only once the `PayrollEntry` carrying that reservation is
 * actually Released (`docs/architecture/database/advances.md §15`'s lifecycle section) — never set
 * directly by a user action, and never set merely because a Draft deduction reached zero. If that
 * Draft deduction is instead reversed (edited, deferred, or the Advance cancelled) before release,
 * `RESERVED` reverts back to `ACTIVE`. `CANCELLED` (Operational Stabilization Checkpoint,
 * 2026-07-24) is the non-destructive correction for a mistakenly-recorded Advance — see
 * `cancelAdvanceSchema` below and `database/advances.md §15`'s "no hard delete" convention. None of
 * `RESERVED`, `PAID_OFF`, or `CANCELLED` is ever set directly by a plain field edit
 * (`updateAdvanceSchema`). */
export const advanceStatusSchema = z.enum(['ACTIVE', 'RESERVED', 'PAID_OFF', 'CANCELLED']);
export type AdvanceStatus = z.infer<typeof advanceStatusSchema>;

/**
 * v1.0.4 Advances Scalability/Deputation/Cancel-Semantics checkpoint — the single business-rule gate
 * every surface that presents an Advance's "Outstanding"/"recoverable" figure to a user must apply.
 *
 * **Why this exists (Part C/D audit finding):** Cancelling an Advance means the company has
 * waived/written off whatever remained unrecovered — nothing further is owed. `Advance.outstandingBalance`
 * itself is deliberately left UNCHANGED by `cancelAdvance` (`advances.service.ts`) beyond reversing any
 * still-Draft, unreleased deduction — it is NOT zeroed at cancellation. That is what makes this a
 * presentation-layer gate rather than a schema change: the stored `outstandingBalance` remains the
 * exact "amount that was never recovered," which is also exactly what `recoveredToDate`
 * (`totalAmount - outstandingBalance`) needs to keep reading, unmasked, to stay correct — masking the
 * stored value itself would make a cancelled Advance's full `totalAmount` misreport as "recovered."
 *
 * Apply this ONLY to whatever a UI/report labels "Outstanding"/"Recoverable" — never to `totalAmount`
 * (always the original, unaffected) and never to `recoveredToDate`/"Amount Recovered" (always
 * `totalAmount - outstandingBalance`, computed from the real, unmasked `outstandingBalance`).
 */
export function isOutstandingWaived(status: AdvanceStatus): boolean {
  return status === 'CANCELLED';
}

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

/**
 * Ordinary field edits to an already-created Advance — narrowed to exactly three user-editable
 * fields by explicit business decision (v1.0.2 Advance Edit/Cancel Final Product Semantics
 * checkpoint, 2026-08-25): `totalAmount`, `dateGiven`, `notes`. Nothing more. The frozen rule this
 * enforces: **Edit is for correcting an existing Advance's own recorded figures; Cancel is for
 * invalidating one.** A user should never have to Cancel-and-recreate an otherwise-valid Advance
 * merely because its Amount or Date was mistyped.
 *
 * `outstandingBalance`, `type`, `status`, and every scheduled-period field are still never directly
 * editable here — they only ever change through the system actions that own them (materialization,
 * deferral, cancellation): editing them as plain fields would let history be silently rewritten.
 *
 * `repaymentType`/`scheduledInstallmentAmount` were editable here in the prior (Operational
 * Stabilization Checkpoint, 2026-07-24) shape but are deliberately retired from this endpoint by
 * this checkpoint's business decision — they are now fixed at creation (`createAdvanceSchema`) for
 * the life of the Advance. This is not a technical limitation; it's the explicit "exactly three
 * fields, nothing more" scope this checkpoint's brief mandated for Edit.
 *
 * `totalAmount` IS editable here, but the service layer enforces it can never drop below what has
 * already been repaid (`totalAmount - outstandingBalance`, RELEASED-only) and rejects the edit
 * entirely once `status` is `PAID_OFF`/`CANCELLED` — see `advances.service.ts`'s `updateAdvance` for
 * the full lifecycle-aware editability matrix.
 *
 * `dateGiven` — traced (this checkpoint) to have zero coupling with payroll-cycle placement or
 * released-history immutability: which cycle an Advance's deduction lands in is governed
 * exclusively by `originalScheduledPeriodId`/`currentScheduledPeriodId` (set at creation via
 * `originalPeriod`, moved only by `deferAdvanceSchedule`), never by `dateGiven` — a purely
 * descriptive/reporting field (statements, the Advance Recovery Report, Employee Payroll History).
 * Editing it therefore never touches materialization, reservation, or release state, and — like
 * `notes` — is deliberately editable at every lifecycle stage, including `PAID_OFF`/`CANCELLED`:
 * blocking it there would recreate exactly the "must Cancel-and-recreate to fix a typo" friction
 * this checkpoint exists to remove, and worse, `cancelAdvance` itself already refuses a non-ACTIVE/
 * RESERVED Advance, so Edit would be the only possible avenue to ever fix it.
 *
 * The Advance's own "deduction start cycle" is deliberately still not editable through this
 * endpoint at any lifecycle stage — correct it via Cancel (pre-materialization) or Defer
 * (post-materialization) instead, never a silent field edit (see `cancelAdvanceSchema` and
 * `deferAdvanceScheduleSchema`). Employee and Advance/Eid Advance `type` are likewise immutable —
 * never part of this schema at all.
 */
export const updateAdvanceSchema = z.object({
  totalAmount: decimalString.optional(),
  dateGiven: z.string().date().optional(),
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

/** Mirrors `advance-recovery-report.ts`'s own `pageQueryParam`/`pageSizeQueryParam` shape verbatim
 * (v1.0.4 checkpoint) — the same numeric-string-from-query-params parsing every other paginated
 * endpoint in this codebase already uses. */
const advancesPageQueryParam = z.preprocess(
  (raw) => (raw === undefined || raw === '' ? undefined : Number(raw)),
  z.number().int().min(1).optional().default(1),
);

export const ADVANCES_DEFAULT_PAGE_SIZE = 25;
export const ADVANCES_MAX_PAGE_SIZE = 100;

const advancesPageSizeQueryParam = z.preprocess(
  (raw) => (raw === undefined || raw === '' ? undefined : Number(raw)),
  z.number().int().min(1).max(ADVANCES_MAX_PAGE_SIZE).optional().default(ADVANCES_DEFAULT_PAGE_SIZE),
);

/** Accepts either one `siteId=` query value or several repeated `siteId=` values (Express parses a
 * repeated key into an array) — v1.0.4 checkpoint, closing the gap where the Advances page's own
 * multi-site filter previously had to be applied client-side over an unbounded fetch. `undefined`
 * (no `siteId` at all) means "no explicit site filter" — the service layer then falls back to the
 * caller's own accessible-site scope, exactly as before. */
const advancesSiteIdsQueryParam = z.preprocess((raw) => {
  if (raw === undefined) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  const flattened = values.filter((value): value is string => typeof value === 'string' && value.length > 0);
  return flattened.length === 0 ? undefined : flattened;
}, z.array(z.string().uuid()).optional());

export const listAdvancesQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  siteIds: advancesSiteIdsQueryParam,
  type: advanceTypeSchema.optional(),
  status: advanceStatusSchema.optional(),
  page: advancesPageQueryParam,
  pageSize: advancesPageSizeQueryParam,
});

export type ListAdvancesQuery = z.infer<typeof listAdvancesQuerySchema>;
