import { Decimal } from 'decimal.js';
import type { CorrectionField, PayrollEntryCalcInput, PayrollWorkLineCalcInput } from '@payroll/shared';
import { calcNet, correctionFieldSchema, WORK_LINE_CORRECTION_FIELDS } from '@payroll/shared';
import type { EntryWithWorkLines } from '../payroll-entry/payroll-entry.service';
import {
  CorrectionValidationError,
  type CorrectionCalculationInput,
  type CorrectionHistoryRecord,
  type CorrectionPreview,
  type DeltaPreview,
  type EffectiveFieldValue,
  type ReconstructedBaseline,
} from './corrections.types';

/**
 * Phase 6 Checkpoint 2 (Baseline Reconstruction & Delta Calculation Engine). Every function in
 * this file is pure — no Prisma import, no I/O, no `Date.now()`/`Math.random()` — so a caller can
 * unit-test it with plain object literals and get the exact same answer every time
 * (Principle 5: deterministic and reproducible). The only I/O this checkpoint performs at all
 * lives in `corrections.repository.ts`, which loads the inputs these functions need and then
 * calls straight through to them.
 *
 * **Deliberate divergence from `BalanceAdjustmentType.NONE`:** `docs/architecture/workflows/
 * corrections-and-balance-adjustments.md`'s settlement layer (Checkpoint 3) allows a correction
 * that nets to zero salary difference, creating an already-`SETTLED`, zero-amount `BalanceAdjustment`
 * for traceability. This checkpoint's own brief is explicit and more specific: "No correction
 * should be created when delta == 0. Return a typed domain error." — so `calculateCorrection`
 * below rejects a zero-delta request outright (`ZERO_DELTA`) rather than returning a `NONE`-style
 * preview. This engine therefore cannot itself produce the `NONE` case; if Checkpoint 3 still
 * needs a path to a zero-amount, already-`SETTLED` `BalanceAdjustment` (e.g. a field value that
 * happens not to move net salary — `EOBI_APPLICABLE` toggling when `eobiAmount` is already zero),
 * that is a scope question for whoever builds Checkpoint 3, not resolved here.
 */

type FieldValueType = 'DECIMAL' | 'INTEGER' | 'BOOLEAN';
type FieldScope = 'ENTRY' | 'WORK_LINE';

interface FieldMetadata {
  scope: FieldScope;
  valueType: FieldValueType;
  /** Inclusive lower bound, decimal fields only. */
  min?: number;
  /** Inclusive upper bound, decimal fields only. */
  max?: number;
}

const WORK_LINE_FIELD_SET = new Set<CorrectionField>(WORK_LINE_CORRECTION_FIELDS);

/** Numeric bounds mirror the hand-added CHECK constraints already enforced on `PayrollEntry`/
 * `PayrollEntryWorkLine` (`backend/prisma/migrations/20260707120000_payroll_cycle_and_entry/
 * migration.sql`) — a corrected value must be at least as valid as an originally-entered one. */
const FIELD_METADATA: Record<CorrectionField, FieldMetadata> = {
  GROSS_PAY: { scope: 'ENTRY', valueType: 'DECIMAL', min: 0 },
  ALLOWANCE: { scope: 'ENTRY', valueType: 'DECIMAL', min: 0 },
  LEAVE_DAYS: { scope: 'ENTRY', valueType: 'DECIMAL', min: 0 },
  LEAVE_RATE: { scope: 'ENTRY', valueType: 'DECIMAL', min: 0 },
  EOBI_AMOUNT: { scope: 'ENTRY', valueType: 'DECIMAL', min: 0 },
  EOBI_APPLICABLE: { scope: 'ENTRY', valueType: 'BOOLEAN' },
  ADVANCE_DEDUCTION: { scope: 'ENTRY', valueType: 'DECIMAL', min: 0 },
  EID_ADVANCE_DEDUCTION: { scope: 'ENTRY', valueType: 'DECIMAL', min: 0 },
  FINE: { scope: 'ENTRY', valueType: 'DECIMAL', min: 0 },
  DAYS: { scope: 'WORK_LINE', valueType: 'DECIMAL', min: 0 },
  OT_HOURS: { scope: 'WORK_LINE', valueType: 'DECIMAL', min: 0 },
  OT_RATE: { scope: 'WORK_LINE', valueType: 'DECIMAL', min: 0 },
  CYCLE_DAYS: { scope: 'WORK_LINE', valueType: 'INTEGER', min: 1, max: 31 },
};

/** PayrollEntry/PayrollEntryWorkLine columns that are never correctable, by design — workflow
 * state (`hold`/`released`), identity/FK columns, and free-text metadata. Distinguishes a
 * deliberately-excluded field (`IMMUTABLE_FIELD`) from one this schema has simply never heard of
 * (`UNSUPPORTED_FIELD`) — see `backend/prisma/schema.prisma`'s own `CorrectionField` comment
 * ("`hold`/`released` are deliberately excluded — workflow state, not correctable payroll data"). */
const KNOWN_IMMUTABLE_FIELDS = new Set([
  'id',
  'cycleId',
  'employeeId',
  'siteId',
  'bankId',
  'branchCode',
  'accountNumber',
  'iban',
  'designation',
  'advanceId',
  'eidAdvanceId',
  'hold',
  'released',
  'releasedAt',
  'releasedBy',
  'lateReason',
  'remarks',
  'sortOrder',
  'version',
  'unitId',
]);

/** Validates that `field` is one of the 13 correctable `CorrectionField` values — deliberately
 * accepts a plain `string`, not `CorrectionField`, so it remains a meaningful defensive check for
 * a future caller (e.g. Checkpoint 4's API layer) that hasn't already narrowed the type via Zod. */
export function assertFieldIsCorrectable(field: string): asserts field is CorrectionField {
  if (correctionFieldSchema.safeParse(field).success) {
    return;
  }
  if (KNOWN_IMMUTABLE_FIELDS.has(field)) {
    throw new CorrectionValidationError({
      code: 'IMMUTABLE_FIELD',
      message: `"${field}" is a PayrollEntry/PayrollEntryWorkLine column, but is never correctable via the Correction workflow (workflow state, identity, or free-text metadata).`,
    });
  }
  throw new CorrectionValidationError({
    code: 'UNSUPPORTED_FIELD',
    message: `"${field}" is not a recognized correction field.`,
  });
}

/** Rejects a `DAYS`/`OT_HOURS`/`OT_RATE`/`CYCLE_DAYS` correction against an entry with more than
 * one `PayrollEntryWorkLine` — Product Decision Resolution Q1: "must reject
 * PayrollEntry.workLines.length > 1 with a typed validation error. Do not guess. Do not
 * redistribute." A no-op for every other field, regardless of work-line count. */
export function assertSingleWorkLineForField(field: CorrectionField, workLineCount: number): void {
  if (WORK_LINE_FIELD_SET.has(field) && workLineCount !== 1) {
    throw new CorrectionValidationError({
      code: 'SPLIT_WORK_LINE_RESTRICTED',
      field,
      message: `"${field}" corrects a single PayrollEntryWorkLine, but this entry has ${workLineCount} work lines. Split (multi-Unit) entries cannot be corrected on this field — there is no unambiguous line to apply it to.`,
    });
  }
}

export function assertEntryIsReleased(entry: { released: boolean }): void {
  if (!entry.released) {
    throw new CorrectionValidationError({
      code: 'ENTRY_NOT_RELEASED',
      message:
        'This PayrollEntry has not released yet — it is still ordinarily Draft-editable. Edit it directly instead of using the Correction workflow, which only applies once PayrollEntry.released = true.',
    });
  }
}

/** Parses and bounds-checks a raw correction value string against `field`'s own type/range,
 * returning a canonical string representation (never the raw input verbatim) for storage as
 * `Correction.newValue`. Throws `INVALID_NUMERIC_VALUE`/`MALFORMED_ENUM_COMBINATION`, never
 * silently coerces. */
export function parseAndValidateFieldValue(field: CorrectionField, raw: string): string {
  const meta = FIELD_METADATA[field];

  if (meta.valueType === 'BOOLEAN') {
    if (raw !== 'true' && raw !== 'false') {
      throw new CorrectionValidationError({
        code: 'MALFORMED_ENUM_COMBINATION',
        field,
        message: `"${field}" must be the literal string "true" or "false", got ${JSON.stringify(raw)}.`,
      });
    }
    return raw;
  }

  let value: Decimal;
  try {
    value = new Decimal(raw);
  } catch {
    throw new CorrectionValidationError({
      code: 'INVALID_NUMERIC_VALUE',
      field,
      message: `"${field}" must be a valid number, got ${JSON.stringify(raw)}.`,
    });
  }
  if (!value.isFinite()) {
    throw new CorrectionValidationError({
      code: 'INVALID_NUMERIC_VALUE',
      field,
      message: `"${field}" must be a finite number, got ${JSON.stringify(raw)}.`,
    });
  }
  if (meta.valueType === 'INTEGER' && !value.isInteger()) {
    throw new CorrectionValidationError({
      code: 'INVALID_NUMERIC_VALUE',
      field,
      message: `"${field}" must be a whole number, got ${JSON.stringify(raw)}.`,
    });
  }
  if (meta.min !== undefined && value.lessThan(meta.min)) {
    throw new CorrectionValidationError({
      code: 'INVALID_NUMERIC_VALUE',
      field,
      message: `"${field}" must be >= ${meta.min}, got ${value.toString()}.`,
    });
  }
  if (meta.max !== undefined && value.greaterThan(meta.max)) {
    throw new CorrectionValidationError({
      code: 'INVALID_NUMERIC_VALUE',
      field,
      message: `"${field}" must be <= ${meta.max}, got ${value.toString()}.`,
    });
  }
  return value.toString();
}

/**
 * Deterministic "most recent first" ordering for a set of approved corrections. Primary key is
 * `approvedAt` (matching the live index `(payrollEntryId, field, approvedAt DESC)` baseline
 * reconstruction already depends on, `database/corrections.md §13`). Ties are broken by `id`
 * (`localeCompare`, descending) purely as a **stable, reproducible tiebreak** — never as a proxy
 * for creation order. `gen_random_uuid()` carries no temporal meaning, so this is not "relying on
 * UUID ordering" in the sense this checkpoint's brief warns against; it exists only so that two
 * calls to this function against the exact same input array always agree, which a pure, "always
 * independently verifiable" replay (Principle 5) requires even in the pathological case where two
 * rows share a `timestamptz` value. In practice this tiebreak is unreachable through the normal
 * approval path — `corrections.lock.ts`'s advisory lock serializes real approvals for the same
 * entry, so two genuine `Correction` rows for it can never commit inside the same microsecond.
 */
export function orderCorrectionsMostRecentFirst<T extends CorrectionHistoryRecord>(corrections: T[]): T[] {
  return [...corrections].sort((a, b) => {
    const byTime = b.approvedAt.getTime() - a.approvedAt.getTime();
    if (byTime !== 0) {
      return byTime;
    }
    return b.id.localeCompare(a.id);
  });
}

/** For each `CorrectionField` that appears at least once in `orderedCorrections` (already sorted
 * most-recent-first), keeps only the first (i.e. most recent) one — the "current effective
 * source" for that field. A `CorrectionRequest` in any status (`PENDING`/`APPROVED`/`REJECTED`)
 * never appears here: only rows from the `Correction` table are ever passed in, since a request is
 * never itself an applied change (`APPROVED` requests are represented by the `Correction` row
 * their approval produced, not by the request row itself). A reversal (`reversesCorrectionId` set)
 * requires no special case here — it is an ordinary `Correction` row like any other, so if it is
 * the most recent for its field it naturally becomes the effective source, which is exactly what
 * correctly nets out a right/wrong/reversed-back-to-right sequence with zero extra mechanism
 * (`docs/architecture/workflows/corrections-and-balance-adjustments.md`). */
export function buildEffectiveFieldMap(
  orderedCorrections: CorrectionHistoryRecord[],
): Map<CorrectionField, CorrectionHistoryRecord> {
  const map = new Map<CorrectionField, CorrectionHistoryRecord>();
  for (const correction of orderedCorrections) {
    if (!map.has(correction.field)) {
      map.set(correction.field, correction);
    }
  }
  return map;
}

function storedFieldValue(entry: EntryWithWorkLines, field: CorrectionField): string | null {
  const singleLine = entry.workLines.length === 1 ? entry.workLines[0]! : null;
  switch (field) {
    case 'GROSS_PAY':
      return entry.grossPay.toString();
    case 'ALLOWANCE':
      return entry.allowance.toString();
    case 'LEAVE_DAYS':
      return entry.leaveDays.toString();
    case 'LEAVE_RATE':
      return entry.leaveRate?.toString() ?? null;
    case 'EOBI_AMOUNT':
      return entry.eobiAmount.toString();
    case 'EOBI_APPLICABLE':
      return String(entry.eobiApplicable);
    case 'ADVANCE_DEDUCTION':
      return entry.advanceDeduction.toString();
    case 'EID_ADVANCE_DEDUCTION':
      return entry.eidAdvanceDeduction.toString();
    case 'FINE':
      return entry.fine.toString();
    case 'DAYS':
      return singleLine ? singleLine.days.toString() : null;
    case 'OT_HOURS':
      return singleLine ? singleLine.otHours.toString() : null;
    case 'OT_RATE':
      return singleLine ? (singleLine.otRate?.toString() ?? null) : null;
    case 'CYCLE_DAYS':
      return singleLine ? String(singleLine.cycleDays) : null;
  }
}

/** Builds the `calcNet` input for `entry` with every field in `effectiveMap` overridden by its
 * most-recent-correction value, and every other field left at its raw stored value. Work-line
 * fields are only ever overridden when `entry` has exactly one line — `assertSingleWorkLineForField`
 * is what actually prevents `effectiveMap` from ever containing one of those fields for a
 * multi-line entry (nothing could have created such a `Correction` in the first place), so this
 * function does not need to re-check that itself. */
function buildCalcInput(
  entry: EntryWithWorkLines,
  effectiveMap: Map<CorrectionField, CorrectionHistoryRecord>,
): PayrollEntryCalcInput {
  const override = (field: CorrectionField): string | undefined => effectiveMap.get(field)?.newValue;
  const isSingleLine = entry.workLines.length === 1;

  const workLines: PayrollWorkLineCalcInput[] = entry.workLines.map((line) => {
    if (!isSingleLine) {
      return {
        sortOrder: line.sortOrder,
        days: line.days.toString(),
        otHours: line.otHours.toString(),
        otRate: line.otRate?.toString() ?? null,
        cycleDays: line.cycleDays,
      };
    }
    const cycleDaysOverride = override('CYCLE_DAYS');
    return {
      sortOrder: line.sortOrder,
      days: override('DAYS') ?? line.days.toString(),
      otHours: override('OT_HOURS') ?? line.otHours.toString(),
      otRate: override('OT_RATE') ?? line.otRate?.toString() ?? null,
      cycleDays: cycleDaysOverride !== undefined ? Number(cycleDaysOverride) : line.cycleDays,
    };
  });

  const eobiOverride = override('EOBI_APPLICABLE');

  return {
    grossPay: override('GROSS_PAY') ?? entry.grossPay.toString(),
    allowance: override('ALLOWANCE') ?? entry.allowance.toString(),
    leaveDays: override('LEAVE_DAYS') ?? entry.leaveDays.toString(),
    leaveRate: override('LEAVE_RATE') ?? entry.leaveRate?.toString() ?? null,
    eobiAmount: override('EOBI_AMOUNT') ?? entry.eobiAmount.toString(),
    eobiApplicable: eobiOverride !== undefined ? eobiOverride === 'true' : entry.eobiApplicable,
    advanceDeduction: override('ADVANCE_DEDUCTION') ?? entry.advanceDeduction.toString(),
    eidAdvanceDeduction: override('EID_ADVANCE_DEDUCTION') ?? entry.eidAdvanceDeduction.toString(),
    fine: override('FINE') ?? entry.fine.toString(),
    workLines,
  };
}

/**
 * Reconstructs `entry`'s current effective state by replaying every approved correction against
 * it — never read from a cache, always recomputed from the full history
 * (`docs/architecture/workflows/corrections-and-balance-adjustments.md`, "Baseline Reconstruction
 * for Sequential Corrections"). `approvedCorrections` may contain rows for other fields, other
 * entries, or be in any order — this function re-derives everything it needs rather than trusting
 * the caller's ordering (Principle 5).
 */
export function reconstructBaseline(
  entry: EntryWithWorkLines,
  approvedCorrections: CorrectionHistoryRecord[],
): ReconstructedBaseline {
  const forThisEntry = approvedCorrections.filter((c) => c.payrollEntryId === entry.id);
  const ordered = orderCorrectionsMostRecentFirst(forThisEntry);
  const effectiveMap = buildEffectiveFieldMap(ordered);
  const isSingleLine = entry.workLines.length === 1;

  const calcInput = buildCalcInput(entry, effectiveMap);
  const calc = calcNet(calcInput);

  const fields: EffectiveFieldValue[] = correctionFieldSchema.options.map((field) => {
    const applied = effectiveMap.get(field);
    if (applied) {
      return { field, value: applied.newValue, sourceCorrectionId: applied.id };
    }
    if (WORK_LINE_FIELD_SET.has(field) && !isSingleLine) {
      return { field, value: null, sourceCorrectionId: null };
    }
    // LEAVE_RATE/OT_RATE fall back to calcNet's own derived rate (never re-derived here) when the
    // stored column is null — "Payroll calculation reuse," this file's own module comment.
    if (field === 'LEAVE_RATE' && entry.leaveRate === null) {
      return { field, value: calc.effectiveLeaveRate, sourceCorrectionId: null };
    }
    if (field === 'OT_RATE' && isSingleLine && entry.workLines[0]!.otRate === null) {
      const lineResult = calc.workLines.find((w) => w.sortOrder === entry.workLines[0]!.sortOrder)!;
      return { field, value: lineResult.effectiveOtRate, sourceCorrectionId: null };
    }
    return { field, value: storedFieldValue(entry, field), sourceCorrectionId: null };
  });

  return { payrollEntryId: entry.id, fields, netSalary: calc.netSalary };
}

function classifyDelta(oldNet: string, newNet: string): DeltaPreview {
  const delta = new Decimal(newNet).minus(new Decimal(oldNet));
  if (delta.isZero()) {
    throw new CorrectionValidationError({
      code: 'ZERO_DELTA',
      message: `The requested correction produces no change in net salary (old: ${oldNet}, new: ${newNet}). A correction must change the resulting net salary.`,
    });
  }
  return {
    amount: delta.toFixed(2),
    classification: delta.greaterThan(0) ? 'PAYABLE' : 'RECOVERY',
  };
}

/**
 * The full pure calculation pipeline for one proposed correction: validate the field is
 * correctable and applicable to `entry`'s current work-line shape, parse/bounds-check the
 * proposed value, reconstruct the baseline, apply the change on top of it, and compute the
 * resulting delta. Throws `CorrectionValidationError` on any failure; returns a complete
 * `CorrectionPreview` on success. Does not touch the database, does not know about
 * `adjustmentTypeId` validity (a DB-backed check — see `corrections.repository.ts`), and does not
 * persist anything.
 *
 * `reversalTarget`, when `input.reversesCorrectionId` is set, must already be resolved by the
 * caller (a DB read) and is validated here only against `entry`/`field` — see
 * `validateReversalTarget` below for exactly what is checked.
 */
export function calculateCorrection(
  entry: EntryWithWorkLines,
  approvedCorrections: CorrectionHistoryRecord[],
  input: CorrectionCalculationInput,
  reversalTarget?: CorrectionHistoryRecord | null,
): CorrectionPreview {
  assertFieldIsCorrectable(input.field);
  assertEntryIsReleased(entry);
  assertSingleWorkLineForField(input.field, entry.workLines.length);
  const newValue = parseAndValidateFieldValue(input.field, input.proposedNewValue);

  if (input.reversesCorrectionId) {
    validateReversalTarget(entry.id, input.field, input.reversesCorrectionId, reversalTarget ?? null);
  }

  const baseline = reconstructBaseline(entry, approvedCorrections);
  const oldEffective = baseline.fields.find((f) => f.field === input.field)!;
  // Only reachable when input.field is a work-line field and entry has >1 line — already rejected
  // above by assertSingleWorkLineForField, so oldEffective.value is never null here.
  const oldValue = oldEffective.value!;

  const effectiveMapWithChange = buildEffectiveFieldMap(
    orderCorrectionsMostRecentFirst(approvedCorrections.filter((c) => c.payrollEntryId === entry.id)),
  );
  effectiveMapWithChange.set(input.field, {
    id: '__pending__',
    payrollEntryId: entry.id,
    field: input.field,
    newValue,
    approvedAt: new Date(),
  });
  const newCalcInput = buildCalcInput(entry, effectiveMapWithChange);
  const newCalc = calcNet(newCalcInput);

  const delta = classifyDelta(baseline.netSalary, newCalc.netSalary);

  return {
    payrollEntryId: entry.id,
    field: input.field,
    oldValue,
    newValue,
    oldNetSalary: baseline.netSalary,
    newNetSalary: newCalc.netSalary,
    delta,
    reversesCorrectionId: input.reversesCorrectionId ?? null,
  };
}

/**
 * Validates a proposed `reversesCorrectionId` against the correction currently being calculated —
 * matching exactly what the Product Decision Resolution's Conflict Review specified: "validated to
 * reference an existing Correction against the same payrollEntryId + field." Self-reference
 * (`REVERSAL_SELF_REFERENCE`) is defensive/forward-compatible: the new `Correction`'s `id` is
 * DB-generated at insert time (`dbgenerated("gen_random_uuid()")`), so this checkpoint has no id
 * to compare against yet — the hand-added `Correction_reversesCorrectionId_not_self_check` CHECK
 * constraint (Checkpoint 1) is what actually backstops this today. This function exists so a
 * future caller that pre-generates the new correction's id (e.g. for idempotency) has this check
 * ready without redesign.
 */
export function validateReversalTarget(
  payrollEntryId: string,
  field: CorrectionField,
  reversesCorrectionId: string,
  reversalTarget: CorrectionHistoryRecord | null,
  newCorrectionId?: string,
): void {
  if (newCorrectionId !== undefined && reversesCorrectionId === newCorrectionId) {
    throw new CorrectionValidationError({
      code: 'REVERSAL_SELF_REFERENCE',
      field,
      message: 'A correction cannot reverse itself.',
    });
  }
  if (!reversalTarget) {
    throw new CorrectionValidationError({
      code: 'REVERSAL_TARGET_NOT_FOUND',
      field,
      message: `reversesCorrectionId "${reversesCorrectionId}" does not reference an existing Correction.`,
    });
  }
  if (reversalTarget.payrollEntryId !== payrollEntryId || reversalTarget.field !== field) {
    throw new CorrectionValidationError({
      code: 'REVERSAL_TARGET_MISMATCH',
      field,
      message: `reversesCorrectionId "${reversesCorrectionId}" must reference a Correction against the same PayrollEntry and field (found payrollEntryId=${reversalTarget.payrollEntryId}, field=${reversalTarget.field}).`,
    });
  }
}
