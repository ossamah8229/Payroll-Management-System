import { describe, expect, it } from 'vitest';
import {
  advanceStatusLabel,
  advanceStatusTone,
  advanceTypeLabel,
  repaymentTypeLabel,
  rowStatusLabel,
  rowStatusTone,
} from './advance-recovery-report-labels';

describe('advanceTypeLabel', () => {
  it('labels LOAN as "Advance" and EID_ADVANCE as "Eid Advance", mirroring the Advances page', () => {
    expect(advanceTypeLabel('LOAN')).toBe('Advance');
    expect(advanceTypeLabel('EID_ADVANCE')).toBe('Eid Advance');
  });
});

describe('advanceStatusLabel / advanceStatusTone', () => {
  it('maps every one of the four statuses to a distinct label', () => {
    expect(advanceStatusLabel('ACTIVE')).toBe('Active');
    expect(advanceStatusLabel('CANCELLED')).toBe('Cancelled');
    expect(advanceStatusLabel('RESERVED')).toBe('Reserved (pending release)');
    expect(advanceStatusLabel('PAID_OFF')).toBe('Paid Off');
  });

  it('maps every one of the four statuses to a distinct badge tone', () => {
    const tones = new Set((['ACTIVE', 'CANCELLED', 'RESERVED', 'PAID_OFF'] as const).map((status) => advanceStatusTone(status)));
    expect(tones.size).toBe(4);
  });
});

describe('repaymentTypeLabel', () => {
  it('labels FULL_DEDUCTION and INSTALLMENT', () => {
    expect(repaymentTypeLabel('FULL_DEDUCTION')).toBe('Full Deduction');
    expect(repaymentTypeLabel('INSTALLMENT')).toBe('Installment');
  });
});

describe('rowStatusLabel / rowStatusTone', () => {
  it('maps every one of the five row statuses to a distinct label', () => {
    expect(rowStatusLabel('RELEASED')).toBe('Released');
    expect(rowStatusLabel('HELD')).toBe('Held');
    expect(rowStatusLabel('NO_PAY_DUE')).toBe('No Pay Due');
    expect(rowStatusLabel('RECOVERY_DUE')).toBe('Recovery Due');
    expect(rowStatusLabel('PENDING')).toBe('Pending');
  });

  it('maps every one of the five row statuses to a distinct badge tone', () => {
    const tones = new Set(
      (['RELEASED', 'HELD', 'NO_PAY_DUE', 'RECOVERY_DUE', 'PENDING'] as const).map((status) => rowStatusTone(status)),
    );
    expect(tones.size).toBe(5);
  });
});
