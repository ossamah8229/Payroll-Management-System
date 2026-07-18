import { describe, expect, it } from 'vitest';
import {
  availableForStandaloneSettlement,
  balanceAdjustmentStatusTone,
  balanceAdjustmentTypeLabel,
  balanceAdjustmentTypeTone,
  correctionFieldLabel,
  correctionRequestStatusTone,
  cyclePeriodLabel,
  isBooleanCorrectionField,
  materializationStatusTone,
} from './correction-labels';

describe('correctionFieldLabel', () => {
  it('maps every known CorrectionField to a human label', () => {
    expect(correctionFieldLabel('GROSS_PAY')).toBe('Gross Pay');
    expect(correctionFieldLabel('EID_ADVANCE_DEDUCTION')).toBe('Eid Advance Deduction');
  });

  it('falls back to the raw string for an unmapped value', () => {
    expect(correctionFieldLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('isBooleanCorrectionField', () => {
  it('is true only for EOBI_APPLICABLE', () => {
    expect(isBooleanCorrectionField('EOBI_APPLICABLE')).toBe(true);
    expect(isBooleanCorrectionField('GROSS_PAY')).toBe(false);
  });
});

describe('status/type tones', () => {
  it('correctionRequestStatusTone', () => {
    expect(correctionRequestStatusTone('PENDING')).toBe('amber');
    expect(correctionRequestStatusTone('APPROVED')).toBe('green');
    expect(correctionRequestStatusTone('REJECTED')).toBe('red');
  });

  it('balanceAdjustmentStatusTone', () => {
    expect(balanceAdjustmentStatusTone('PENDING')).toBe('amber');
    expect(balanceAdjustmentStatusTone('SETTLED')).toBe('green');
  });

  it('balanceAdjustmentTypeTone and label', () => {
    expect(balanceAdjustmentTypeTone('PAYABLE')).toBe('blue');
    expect(balanceAdjustmentTypeLabel('PAYABLE')).toBe('Payable');
    expect(balanceAdjustmentTypeTone('RECOVERY')).toBe('purple');
    expect(balanceAdjustmentTypeLabel('RECOVERY')).toBe('Recovery');
    expect(balanceAdjustmentTypeTone('NONE')).toBe('gray');
  });

  it('materializationStatusTone', () => {
    expect(materializationStatusTone('ACTIVE')).toBe('amber');
    expect(materializationStatusTone('CONSUMED')).toBe('green');
    expect(materializationStatusTone('CANCELLED')).toBe('gray');
  });
});

describe('cyclePeriodLabel', () => {
  it('formats a year/month cycle', () => {
    expect(cyclePeriodLabel({ year: 2026, month: 7 })).toBe('July 2026');
  });

  it('returns an em dash for null/undefined', () => {
    expect(cyclePeriodLabel(null)).toBe('—');
    expect(cyclePeriodLabel(undefined)).toBe('—');
  });
});

describe('availableForStandaloneSettlement', () => {
  it('subtracts active reservations from the remaining amount', () => {
    expect(availableForStandaloneSettlement('5000.00', '2000.00')).toBe('3000.00');
  });

  it('returns zero, not negative-looking noise, when fully reserved', () => {
    expect(availableForStandaloneSettlement('5000.00', '5000.00')).toBe('0.00');
  });

  it('handles no reservation at all', () => {
    expect(availableForStandaloneSettlement('1234.56', '0')).toBe('1234.56');
  });
});
