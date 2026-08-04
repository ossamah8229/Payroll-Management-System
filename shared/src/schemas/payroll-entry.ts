import { z } from 'zod';
import { decimalString, emptyToNull, optionalTrimmedString } from './common';

/**
 * The initial work line(s) supplied at `PayrollEntry` creation time (docs/architecture/
 * database/payroll-entry.md §12a). `unitId` is optional here specifically — if omitted, the service
 * seeds it from the employee's own current default unit (`Employee.unitId`), the common case;
 * supplying it explicitly is only needed for the unusual case of seeding a first line at a
 * *different* unit than the employee's default. `days`/`otHours`/`cycleDays` default to the
 * schema's own defaults (0/0/30) when omitted.
 */
export const entryWorkLineSeedSchema = z.object({
  unitId: z.string().uuid().optional(),
  days: decimalString.optional(),
  otHours: decimalString.optional(),
  otRate: z.preprocess(emptyToNull, decimalString.nullable().optional()),
  cycleDays: z.number().int().min(1).max(31).optional(),
});

export type EntryWorkLineSeedInput = z.infer<typeof entryWorkLineSeedSchema>;

/**
 * Creates a `PayrollEntry` for one employee within one (Draft) cycle. Deliberately does NOT accept
 * `grossPay`/`allowance`/etc. overrides at creation time — per §12, these fields are always
 * copied from `Employee` (or carried forward at new-cycle creation) the moment the entry is
 * created, then behave as an ordinary Draft-editable field via the separate update route. This
 * keeps "what did this entry start as" unambiguous: always Employee's current record, never a
 * caller-supplied value sneaked in at creation time.
 */
export const createPayrollEntrySchema = z.object({
  employeeId: z.string().uuid('An employee is required'),
  /** Defaults to a single line seeded entirely from the employee's own defaults if omitted. */
  workLines: z.array(entryWorkLineSeedSchema).min(1).optional(),
});

export type CreatePayrollEntryInput = z.infer<typeof createPayrollEntrySchema>;

/**
 * Ordinary field edits to an already-created `PayrollEntry` (§12) — every field here is
 * Draft-editable while `released = false` and the parent cycle is still `DRAFT` (enforced by the
 * service layer, not this schema). Deliberately excludes `cycleId`/`employeeId` (never
 * reassignable — delete and recreate if the wrong employee was selected); `released`/`releasedAt`/
 * `releasedBy`/`lateReason` (release-mechanism fields with no ordinary-edit path, per §22 —
 * Phase 4's exclusive concern); and **`siteId` — confirmed 2026-07-07 as a permanent, approved
 * decision, not a deferred one**: an entry's site is never directly editable. Changing an entry's
 * site would require re-validating every existing work line's unit against the new site, and the
 * frozen design's own intent is that site changes flow exclusively through the Employee Transfer
 * workflow (which the next cycle's bootstrap then picks up automatically via the Payroll Bootstrap
 * Rule — see `payroll-processing.service.ts`'s `createPayrollCycle`), never a manual Payroll Entry
 * edit.
 *
 * **Phase 7D (2026-07-30) — `designation`/`bankId`/`branchCode`/`accountNumber`/`iban` removed**:
 * these were previously Draft-editable *duplicated* columns on `PayrollEntry` itself, independent
 * of `Employee`'s own record — the exact "stale duplication / independent editing" defect this
 * checkpoint closes. `Employee` (Employee Registry) is now the sole authoritative, editable source
 * for these fields; a Draft entry's own copy is refreshed from the live `Employee` record for
 * display (`payroll-entry.service.ts`) and re-frozen from it at release time
 * (`payroll-release.service.ts`), never accepted from this route again. `eobiAmount`/
 * `eobiApplicable` deliberately stay below, unaffected — EOBI applicability remains a
 * payroll-cycle-specific toggle owned by Payroll Entry, not Employee Registry.
 *
 * **Phase 7F (2026-08-04) — `grossPay` removed, same reasoning extended**: production UAT found
 * that editing Gross Salary in Employee Registry did not update an unreleased Payroll Entry —
 * `grossPay` was a Draft-editable duplicated column exactly like the Phase 7D fields above, just
 * missed by that checkpoint. Employee Registry is now the sole editable source for Gross Salary
 * too; a Draft entry's own copy is refreshed from the live `Employee` record for display and
 * calculation (`payroll-entry.service.ts`'s `withLiveMasterData`) and re-frozen from it at release
 * time (`payroll-release.service.ts`), never accepted from this route again.
 *
 * `version` is mandatory — the optimistic-locking token the caller must echo back from whatever
 * read produced the value being edited (docs/architecture/database/schema-invariants.md §22).
 */
export const updatePayrollEntrySchema = z.object({
  version: z.number().int(),
  allowance: decimalString.optional(),
  leaveDays: decimalString.optional(),
  leaveRate: z.preprocess(emptyToNull, decimalString.nullable().optional()),
  eobiAmount: decimalString.optional(),
  eobiApplicable: z.boolean().optional(),
  advanceDeduction: decimalString.optional(),
  eidAdvanceDeduction: decimalString.optional(),
  fine: decimalString.optional(),
  hold: z.boolean().optional(),
  remarks: optionalTrimmedString(2000),
  sortOrder: z.number().int().optional(),
});

export type UpdatePayrollEntryInput = z.infer<typeof updatePayrollEntrySchema>;

/**
 * Adds a new `PayrollEntryWorkLine` to an already-existing entry (the backend capability behind
 * the "Split by {unitLabel}" action — its UI is a later checkpoint's concern, not this one's).
 * `unitId` is mandatory here (unlike the creation-time seed schema above) since the entire point
 * of adding a line is attributing attendance to a specific, explicitly-chosen unit. `version` locks
 * against the *parent PayrollEntry's* version — work lines have no version of their own; they
 * mutate under the same lock as their parent (§22).
 */
export const addWorkLineSchema = z.object({
  version: z.number().int(),
  unitId: z.string().uuid('A project unit is required'),
  days: decimalString.optional(),
  otHours: decimalString.optional(),
  otRate: z.preprocess(emptyToNull, decimalString.nullable().optional()),
  cycleDays: z.number().int().min(1).max(31).optional(),
});

export type AddWorkLineInput = z.infer<typeof addWorkLineSchema>;

export const updateWorkLineSchema = z.object({
  version: z.number().int(),
  unitId: z.string().uuid().optional(),
  days: decimalString.optional(),
  otHours: decimalString.optional(),
  otRate: z.preprocess(emptyToNull, decimalString.nullable().optional()),
  cycleDays: z.number().int().min(1).max(31).optional(),
  sortOrder: z.number().int().optional(),
});

export type UpdateWorkLineInput = z.infer<typeof updateWorkLineSchema>;

/**
 * "Copy to All" (Phase 3 Checkpoint 4, `docs/architecture/database/schema-invariants.md` §23's
 * "bulk writes over row-by-row loops" rule) — pushes one value to every currently-filtered
 * employee's Payroll Entry in one request, never a loop of individual PATCHes. `siteIds` is
 * mandatory and non-empty by design: even though the grid itself may display "every site" when no
 * filter is applied, a bulk mutation's scope must always be an explicit, deliberate selection —
 * never implicitly "every employee in the cycle."
 *
 * A discriminated union on `field` because the three copyable fields have genuinely different wire
 * types (`leaveRate`/`otRate` are decimal strings; `cycleDays` is a plain 1–31 integer) — the same
 * types `updatePayrollEntrySchema`/`updateWorkLineSchema` already enforce for these exact fields,
 * reused here rather than redefined. `leaveRate` lives on `PayrollEntry` itself; `otRate`/
 * `cycleDays` live on `PayrollEntryWorkLine` and are applied to each entry's *primary* line only
 * (lowest `sortOrder`) — non-primary lines are intentionally reachable only through the Split by
 * {unitLabel} modal (Checkpoint 3), never through a bulk action.
 */
export const bulkUpdatePayrollEntriesSchema = z.discriminatedUnion('field', [
  z.object({
    siteIds: z.array(z.string().uuid()).min(1, 'Select at least one site'),
    field: z.literal('leaveRate'),
    value: decimalString,
  }),
  z.object({
    siteIds: z.array(z.string().uuid()).min(1, 'Select at least one site'),
    field: z.literal('otRate'),
    value: decimalString,
  }),
  z.object({
    siteIds: z.array(z.string().uuid()).min(1, 'Select at least one site'),
    field: z.literal('cycleDays'),
    value: z.number().int().min(1).max(31),
  }),
]);

export type BulkUpdatePayrollEntriesInput = z.infer<typeof bulkUpdatePayrollEntriesSchema>;
