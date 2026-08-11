import { describe, expect, it } from 'vitest';
import { primaryUnitLabel, rowStatusLabel, rowStatusTone } from './salary-release-report-labels';

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

  it('never introduces a release-status vocabulary beyond the canonical five states', () => {
    const labels = Object.values({
      RELEASED: rowStatusLabel('RELEASED'),
      HELD: rowStatusLabel('HELD'),
      NO_PAY_DUE: rowStatusLabel('NO_PAY_DUE'),
      RECOVERY_DUE: rowStatusLabel('RECOVERY_DUE'),
      PENDING: rowStatusLabel('PENDING'),
    });
    expect(labels).toHaveLength(5);
    expect(new Set(labels).size).toBe(5);
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
