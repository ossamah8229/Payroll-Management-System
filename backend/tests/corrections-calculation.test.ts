import { describe, expect, it } from '@jest/globals';
import { Prisma } from '@prisma/client';
import type { PayrollEntry, PayrollEntryWorkLine } from '@prisma/client';
import type { EntryWithWorkLines } from '../src/modules/payroll-entry/payroll-entry.service';
import {
  assertFieldIsCorrectable,
  assertSingleWorkLineForField,
  buildEffectiveFieldMap,
  calculateCorrection,
  orderCorrectionsMostRecentFirst,
  parseAndValidateFieldValue,
  reconstructBaseline,
  validateReversalTarget,
} from '../src/modules/corrections/corrections.calculation';
import { CorrectionValidationError, type CorrectionHistoryRecord } from '../src/modules/corrections/corrections.types';

/**
 * Phase 6 Checkpoint 2 (Baseline Reconstruction & Delta Calculation Engine). Every function under
 * test here is pure, so every fixture below is a plain object literal — no database, no Prisma
 * client, no `beforeEach`/`afterEach` DB cleanup. DB-backed coverage (repository reads, the
 * advisory lock, AdjustmentType validation, and confirming a `CorrectionRequest` in any status has
 * zero effect on reconstruction) lives in `corrections-repository.test.ts` instead.
 */

function makeWorkLine(overrides: Partial<PayrollEntryWorkLine> = {}): PayrollEntryWorkLine {
  return {
    id: 'wl-1',
    payrollEntryId: 'entry-1',
    siteId: 'site-1',
    unitId: 'unit-1',
    days: new Prisma.Decimal('26'),
    otHours: new Prisma.Decimal('10'),
    otRate: null,
    cycleDays: 30,
    sortOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<PayrollEntry> = {},
  workLines: PayrollEntryWorkLine[] = [makeWorkLine()],
): EntryWithWorkLines {
  return {
    id: 'entry-1',
    cycleId: 'cycle-1',
    employeeId: 'employee-1',
    siteId: 'site-1',
    employeeNameSnapshot: 'Test Employee',
    fatherNameSnapshot: 'Test Father',
    designation: 'Laborer',
    bankId: null,
    branchCode: null,
    accountNumber: null,
    iban: null,
    grossPay: new Prisma.Decimal('50000'),
    allowance: new Prisma.Decimal('0'),
    leaveDays: new Prisma.Decimal('0'),
    leaveRate: null,
    eobiAmount: new Prisma.Decimal('400'),
    eobiApplicable: true,
    advanceDeduction: new Prisma.Decimal('0'),
    advanceId: null,
    eidAdvanceDeduction: new Prisma.Decimal('0'),
    eidAdvanceId: null,
    fine: new Prisma.Decimal('0'),
    hold: false,
    released: true,
    releasedAt: new Date('2026-01-05T00:00:00Z'),
    releasedBy: 'user-1',
    lateReason: null,
    remarks: null,
    sortOrder: 0,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    workLines,
    ...overrides,
  };
}

function makeCorrectionHistory(overrides: Partial<CorrectionHistoryRecord> = {}): CorrectionHistoryRecord {
  return {
    id: 'correction-1',
    payrollEntryId: 'entry-1',
    field: 'GROSS_PAY',
    newValue: '52000',
    approvedAt: new Date('2026-02-01T00:00:00Z'),
    ...overrides,
  };
}

function expectDomainError(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error('expected CorrectionValidationError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(CorrectionValidationError);
    expect((error as CorrectionValidationError).code).toBe(code);
  }
}

describe('Baseline reconstruction', () => {
  it('no previous corrections: effective value equals the stored PayrollEntry value', () => {
    const entry = makeEntry();
    const baseline = reconstructBaseline(entry, []);
    const grossPay = baseline.fields.find((f) => f.field === 'GROSS_PAY')!;
    expect(grossPay.value).toBe('50000');
    expect(grossPay.sourceCorrectionId).toBeNull();
    // dailyRate = 50000/30; earnedAmount = dailyRate * 26 days; otEarned = 10h * (dailyRate/8)
    // (otRate derives, per calcNet, since the fixture's default work line leaves it null);
    // eobiDeduction = 400. Cross-checked against calcNet's own output, not hand-derived, since
    // this test's job is "does reconstructBaseline read the entry correctly," not re-deriving
    // calcNet's formula.
    expect(baseline.netSalary).toBe('45016.66');
  });

  it('one correction: effective value equals its newValue', () => {
    const entry = makeEntry();
    const corrections = [makeCorrectionHistory({ field: 'GROSS_PAY', newValue: '55000' })];
    const baseline = reconstructBaseline(entry, corrections);
    const grossPay = baseline.fields.find((f) => f.field === 'GROSS_PAY')!;
    expect(grossPay.value).toBe('55000');
    expect(grossPay.sourceCorrectionId).toBe('correction-1');
  });

  it('multiple corrections to different fields each apply independently', () => {
    const entry = makeEntry();
    const corrections = [
      makeCorrectionHistory({ id: 'c1', field: 'GROSS_PAY', newValue: '55000', approvedAt: new Date('2026-02-01T00:00:00Z') }),
      makeCorrectionHistory({ id: 'c2', field: 'FINE', newValue: '500', approvedAt: new Date('2026-02-02T00:00:00Z') }),
    ];
    const baseline = reconstructBaseline(entry, corrections);
    expect(baseline.fields.find((f) => f.field === 'GROSS_PAY')!.value).toBe('55000');
    expect(baseline.fields.find((f) => f.field === 'FINE')!.value).toBe('500');
  });

  it('chained corrections to the same field: a second correction sees the first as its baseline, not the original', () => {
    const entry = makeEntry();
    // Released at 50,000. Correction A: 50,000 -> 52,000. A second correction is now proposed
    // (52,000 -> 54,000, not modeled here as a Correction row yet, only its baseline matters).
    const corrections = [makeCorrectionHistory({ id: 'A', field: 'GROSS_PAY', newValue: '52000', approvedAt: new Date('2026-02-01T00:00:00Z') })];
    const baseline = reconstructBaseline(entry, corrections);
    expect(baseline.fields.find((f) => f.field === 'GROSS_PAY')!.value).toBe('52000');

    // calculateCorrection proposing 54000 must compute a delta relative to 52000, not 50000.
    const result = calculateCorrection(entry, corrections, {
      field: 'GROSS_PAY',
      proposedNewValue: '54000',
      adjustmentTypeId: 'adj-1',
    });
    expect(result.oldValue).toBe('52000');
    expect(result.newValue).toBe('54000');
  });

  it('reversal: a later Correction reversing an earlier one requires no special-case handling — it just becomes the most recent', () => {
    const entry = makeEntry();
    const corrections = [
      makeCorrectionHistory({ id: 'A', field: 'GROSS_PAY', newValue: '52000', approvedAt: new Date('2026-02-01T00:00:00Z') }),
      makeCorrectionHistory({ id: 'B-reversal', field: 'GROSS_PAY', newValue: '50000', approvedAt: new Date('2026-02-05T00:00:00Z') }),
    ];
    const baseline = reconstructBaseline(entry, corrections);
    const grossPay = baseline.fields.find((f) => f.field === 'GROSS_PAY')!;
    expect(grossPay.value).toBe('50000');
    expect(grossPay.sourceCorrectionId).toBe('B-reversal');
  });

  it('mixed fields: a work-line field and an entry-level field both apply on top of each other', () => {
    const entry = makeEntry();
    const corrections = [
      makeCorrectionHistory({ id: 'c1', field: 'DAYS', newValue: '20', approvedAt: new Date('2026-02-01T00:00:00Z') }),
      makeCorrectionHistory({ id: 'c2', field: 'ALLOWANCE', newValue: '1000', approvedAt: new Date('2026-02-02T00:00:00Z') }),
    ];
    const baseline = reconstructBaseline(entry, corrections);
    expect(baseline.fields.find((f) => f.field === 'DAYS')!.value).toBe('20');
    expect(baseline.fields.find((f) => f.field === 'ALLOWANCE')!.value).toBe('1000');
  });

  it('chronological reconstruction: three corrections to the same field, most recent by approvedAt wins regardless of array order', () => {
    const entry = makeEntry();
    const corrections = [
      makeCorrectionHistory({ id: 'third', field: 'GROSS_PAY', newValue: '58000', approvedAt: new Date('2026-02-03T00:00:00Z') }),
      makeCorrectionHistory({ id: 'first', field: 'GROSS_PAY', newValue: '52000', approvedAt: new Date('2026-02-01T00:00:00Z') }),
      makeCorrectionHistory({ id: 'second', field: 'GROSS_PAY', newValue: '55000', approvedAt: new Date('2026-02-02T00:00:00Z') }),
    ];
    const baseline = reconstructBaseline(entry, corrections);
    const grossPay = baseline.fields.find((f) => f.field === 'GROSS_PAY')!;
    expect(grossPay.value).toBe('58000');
    expect(grossPay.sourceCorrectionId).toBe('third');
  });

  it('timestamp ties: deterministic id-based tiebreak, same result regardless of input array order', () => {
    const tiedAt = new Date('2026-02-01T00:00:00Z');
    const a = makeCorrectionHistory({ id: 'aaaa', field: 'GROSS_PAY', newValue: '51000', approvedAt: tiedAt });
    const b = makeCorrectionHistory({ id: 'bbbb', field: 'GROSS_PAY', newValue: '52000', approvedAt: tiedAt });

    const orderedForward = orderCorrectionsMostRecentFirst([a, b]);
    const orderedBackward = orderCorrectionsMostRecentFirst([b, a]);
    expect(orderedForward[0]!.id).toBe(orderedBackward[0]!.id);
    // "bbbb" > "aaaa" lexicographically, descending tiebreak picks "bbbb" first.
    expect(orderedForward[0]!.id).toBe('bbbb');
  });

  it('a work-line field on a multi-work-line entry has no single effective value (null, not fabricated)', () => {
    const entry = makeEntry({}, [
      makeWorkLine({ id: 'wl-1', sortOrder: 0, unitId: 'unit-1' }),
      makeWorkLine({ id: 'wl-2', sortOrder: 1, unitId: 'unit-2' }),
    ]);
    const baseline = reconstructBaseline(entry, []);
    expect(baseline.fields.find((f) => f.field === 'DAYS')!.value).toBeNull();
    expect(baseline.fields.find((f) => f.field === 'CYCLE_DAYS')!.value).toBeNull();
  });

  it('LEAVE_RATE falls back to calcNet\'s own derived rate (never re-derived here) when the stored column is null', () => {
    const entry = makeEntry({ leaveRate: null, grossPay: new Prisma.Decimal('30000') }, [
      makeWorkLine({ cycleDays: 30 }),
    ]);
    const baseline = reconstructBaseline(entry, []);
    // Derived: grossPay / primary line cycleDays = 30000 / 30 = 1000.
    expect(baseline.fields.find((f) => f.field === 'LEAVE_RATE')!.value).toBe('1000');
  });
});

describe('Delta calculation', () => {
  it('positive delta classifies as PAYABLE', () => {
    const entry = makeEntry();
    const result = calculateCorrection(entry, [], { field: 'GROSS_PAY', proposedNewValue: '55000', adjustmentTypeId: 'adj-1' });
    expect(result.delta.classification).toBe('PAYABLE');
    expect(new Prisma.Decimal(result.delta.amount).greaterThan(0)).toBe(true);
  });

  it('negative delta classifies as RECOVERY', () => {
    const entry = makeEntry();
    const result = calculateCorrection(entry, [], { field: 'GROSS_PAY', proposedNewValue: '45000', adjustmentTypeId: 'adj-1' });
    expect(result.delta.classification).toBe('RECOVERY');
    expect(new Prisma.Decimal(result.delta.amount).lessThan(0)).toBe(true);
  });

  it('zero delta throws ZERO_DELTA and creates no result', () => {
    const entry = makeEntry();
    expectDomainError(
      () => calculateCorrection(entry, [], { field: 'GROSS_PAY', proposedNewValue: '50000', adjustmentTypeId: 'adj-1' }),
      'ZERO_DELTA',
    );
  });

  it('decimal precision: delta rounds to exactly 2dp, half-up', () => {
    const entry = makeEntry({ grossPay: new Prisma.Decimal('40000') }, [makeWorkLine({ days: new Prisma.Decimal('27'), cycleDays: 27 })]);
    // dailyRate = 40000/27 (repeating decimal); correcting grossPay shifts earnedAmount by a
    // repeating-decimal amount that must still round cleanly to 2dp in the final delta.
    const result = calculateCorrection(entry, [], { field: 'GROSS_PAY', proposedNewValue: '41000', adjustmentTypeId: 'adj-1' });
    expect(result.delta.amount).toMatch(/^-?\d+\.\d{2}$/);
    expect(result.newNetSalary).toMatch(/^\d+\.\d{2}$/);
  });

  it('large values: no overflow or precision loss for a large gross pay correction', () => {
    // days === cycleDays and otHours === 0 makes earnedAmount === grossPay exactly (dailyRate *
    // cycleDays cancels out to grossPay with no proration), so the net-salary delta is exactly
    // the grossPay delta — isolating "does a 7-figure Decimal survive calcNet intact" from the
    // day-proration/OT rounding already covered by the "decimal precision" test above.
    const entry = makeEntry({ grossPay: new Prisma.Decimal('9999999.99') }, [
      makeWorkLine({ days: new Prisma.Decimal('30'), cycleDays: 30, otHours: new Prisma.Decimal('0') }),
    ]);
    const result = calculateCorrection(entry, [], { field: 'GROSS_PAY', proposedNewValue: '10999999.99', adjustmentTypeId: 'adj-1' });
    expect(result.delta.classification).toBe('PAYABLE');
    expect(result.delta.amount).toBe('1000000.00');
  });
});

describe('Work-line restriction', () => {
  it('one work line: a work-line field correction is permitted', () => {
    expect(() => assertSingleWorkLineForField('DAYS', 1)).not.toThrow();
  });

  it('two work lines: a work-line field correction is rejected', () => {
    expectDomainError(() => assertSingleWorkLineForField('DAYS', 2), 'SPLIT_WORK_LINE_RESTRICTED');
  });

  it('three work lines: a work-line field correction is rejected', () => {
    expectDomainError(() => assertSingleWorkLineForField('OT_HOURS', 3), 'SPLIT_WORK_LINE_RESTRICTED');
  });

  it('a non-work-line field is unaffected by work-line count', () => {
    expect(() => assertSingleWorkLineForField('GROSS_PAY', 3)).not.toThrow();
  });

  it('calculateCorrection rejects a work-line field against a genuinely multi-line entry end to end', () => {
    const entry = makeEntry({}, [
      makeWorkLine({ id: 'wl-1', sortOrder: 0, unitId: 'unit-1' }),
      makeWorkLine({ id: 'wl-2', sortOrder: 1, unitId: 'unit-2' }),
    ]);
    expectDomainError(
      () => calculateCorrection(entry, [], { field: 'DAYS', proposedNewValue: '20', adjustmentTypeId: 'adj-1' }),
      'SPLIT_WORK_LINE_RESTRICTED',
    );
  });
});

describe('Validation', () => {
  it('UNSUPPORTED_FIELD: a field name outside the 13-value CorrectionField enum', () => {
    expectDomainError(() => assertFieldIsCorrectable('netSalary'), 'UNSUPPORTED_FIELD');
  });

  it('IMMUTABLE_FIELD: a real PayrollEntry column that is deliberately never correctable', () => {
    expectDomainError(() => assertFieldIsCorrectable('hold'), 'IMMUTABLE_FIELD');
    expectDomainError(() => assertFieldIsCorrectable('released'), 'IMMUTABLE_FIELD');
    expectDomainError(() => assertFieldIsCorrectable('employeeId'), 'IMMUTABLE_FIELD');
  });

  it('a genuinely supported field passes', () => {
    expect(() => assertFieldIsCorrectable('GROSS_PAY')).not.toThrow();
  });

  it('INVALID_NUMERIC_VALUE: a non-numeric string for a decimal field', () => {
    expectDomainError(() => parseAndValidateFieldValue('GROSS_PAY', 'not-a-number'), 'INVALID_NUMERIC_VALUE');
  });

  it('INVALID_NUMERIC_VALUE: a negative value for a field with a >= 0 bound', () => {
    expectDomainError(() => parseAndValidateFieldValue('FINE', '-100'), 'INVALID_NUMERIC_VALUE');
  });

  it('INVALID_NUMERIC_VALUE: a non-integer CYCLE_DAYS', () => {
    expectDomainError(() => parseAndValidateFieldValue('CYCLE_DAYS', '30.5'), 'INVALID_NUMERIC_VALUE');
  });

  it('INVALID_NUMERIC_VALUE: CYCLE_DAYS out of the 1-31 range', () => {
    expectDomainError(() => parseAndValidateFieldValue('CYCLE_DAYS', '32'), 'INVALID_NUMERIC_VALUE');
    expectDomainError(() => parseAndValidateFieldValue('CYCLE_DAYS', '0'), 'INVALID_NUMERIC_VALUE');
  });

  it('MALFORMED_ENUM_COMBINATION: EOBI_APPLICABLE with a non-boolean string', () => {
    expectDomainError(() => parseAndValidateFieldValue('EOBI_APPLICABLE', 'yes'), 'MALFORMED_ENUM_COMBINATION');
  });

  it('EOBI_APPLICABLE accepts exactly "true"/"false"', () => {
    expect(parseAndValidateFieldValue('EOBI_APPLICABLE', 'true')).toBe('true');
    expect(parseAndValidateFieldValue('EOBI_APPLICABLE', 'false')).toBe('false');
  });

  it('ENTRY_NOT_RELEASED: a correction against a still-Draft-editable entry is rejected', () => {
    const entry = makeEntry({ released: false, releasedAt: null, releasedBy: null });
    expectDomainError(
      () => calculateCorrection(entry, [], { field: 'GROSS_PAY', proposedNewValue: '55000', adjustmentTypeId: 'adj-1' }),
      'ENTRY_NOT_RELEASED',
    );
  });

  it('REVERSAL_TARGET_NOT_FOUND: reversesCorrectionId does not resolve to any Correction', () => {
    expectDomainError(
      () => validateReversalTarget('entry-1', 'GROSS_PAY', 'missing-id', null),
      'REVERSAL_TARGET_NOT_FOUND',
    );
  });

  it('REVERSAL_TARGET_MISMATCH: the resolved target is against a different field', () => {
    const target = makeCorrectionHistory({ id: 'target-1', field: 'FINE' });
    expectDomainError(
      () => validateReversalTarget('entry-1', 'GROSS_PAY', 'target-1', target),
      'REVERSAL_TARGET_MISMATCH',
    );
  });

  it('REVERSAL_TARGET_MISMATCH: the resolved target is against a different PayrollEntry', () => {
    const target = makeCorrectionHistory({ id: 'target-1', field: 'GROSS_PAY', payrollEntryId: 'other-entry' });
    expectDomainError(
      () => validateReversalTarget('entry-1', 'GROSS_PAY', 'target-1', target),
      'REVERSAL_TARGET_MISMATCH',
    );
  });

  it('a valid reversal target (same entry, same field) passes', () => {
    const target = makeCorrectionHistory({ id: 'target-1', field: 'GROSS_PAY', payrollEntryId: 'entry-1' });
    expect(() => validateReversalTarget('entry-1', 'GROSS_PAY', 'target-1', target)).not.toThrow();
  });

  it('REVERSAL_SELF_REFERENCE: a correction cannot declare itself as its own reversal target', () => {
    const target = makeCorrectionHistory({ id: 'same-id', field: 'GROSS_PAY', payrollEntryId: 'entry-1' });
    expectDomainError(
      () => validateReversalTarget('entry-1', 'GROSS_PAY', 'same-id', target, 'same-id'),
      'REVERSAL_SELF_REFERENCE',
    );
  });

  it('calculateCorrection end to end with a valid reversal target', () => {
    const entry = makeEntry();
    const original = makeCorrectionHistory({ id: 'A', field: 'GROSS_PAY', newValue: '52000', approvedAt: new Date('2026-02-01T00:00:00Z') });
    const result = calculateCorrection(
      entry,
      [original],
      { field: 'GROSS_PAY', proposedNewValue: '50000', adjustmentTypeId: 'adj-1', reversesCorrectionId: 'A' },
      original,
    );
    expect(result.reversesCorrectionId).toBe('A');
    expect(result.oldValue).toBe('52000');
    expect(result.newValue).toBe('50000');
  });
});

describe('Correction ordering / effective-field-map building blocks', () => {
  it('buildEffectiveFieldMap keeps only the first (most recent) row per field', () => {
    const ordered = [
      makeCorrectionHistory({ id: 'newest', field: 'GROSS_PAY', approvedAt: new Date('2026-02-03T00:00:00Z') }),
      makeCorrectionHistory({ id: 'oldest', field: 'GROSS_PAY', approvedAt: new Date('2026-02-01T00:00:00Z') }),
    ];
    const map = buildEffectiveFieldMap(ordered);
    expect(map.get('GROSS_PAY')!.id).toBe('newest');
  });

  it('a PENDING or REJECTED CorrectionRequest is structurally impossible to pass in — this map only ever sees Correction rows', () => {
    // Documented via the repository layer (corrections-repository.test.ts), not re-derivable
    // purely: getApprovedCorrectionsForEntry only ever queries the `Correction` table.
    expect(buildEffectiveFieldMap([]).size).toBe(0);
  });
});
