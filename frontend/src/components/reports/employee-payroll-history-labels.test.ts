import { describe, expect, it } from 'vitest';
import { primaryUnitLabel, rosterStatusLabel, rowStatusLabel, rowStatusTone } from './employee-payroll-history-labels';

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

describe('rosterStatusLabel', () => {
  it('labels ACTIVE and DEPARTED distinctly', () => {
    expect(rosterStatusLabel('ACTIVE')).toBe('Active');
    expect(rosterStatusLabel('DEPARTED')).toBe('Departed');
  });
});

describe('primaryUnitLabel', () => {
  it('shows the primary unit name alone when there are no additional units', () => {
    expect(primaryUnitLabel({ primaryUnit: { id: 'u1', name: 'HQ', code: null }, additionalUnitCount: 0 })).toBe('HQ');
  });

  it('appends a "+N more" suffix when additional units exist', () => {
    expect(primaryUnitLabel({ primaryUnit: { id: 'u1', name: 'HQ', code: null }, additionalUnitCount: 2 })).toBe(
      'HQ (+2 more)',
    );
  });

  it('falls back to an em dash when there is no primary unit', () => {
    expect(primaryUnitLabel({ primaryUnit: null, additionalUnitCount: 0 })).toBe('—');
  });
});
