import { describe, expect, it } from 'vitest';
import { rowStatusLabel, rowStatusTone } from './overtime-report-labels';

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
