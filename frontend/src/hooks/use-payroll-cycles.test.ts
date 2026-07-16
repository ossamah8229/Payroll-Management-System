import { describe, expect, it } from 'vitest';
import { formatCycleOptionLabel, formatCyclePeriodSlug, resolveDefaultCycleId, type PayrollCycle } from './use-payroll-cycles';

function cycle(overrides: Partial<PayrollCycle> & Pick<PayrollCycle, 'id' | 'year' | 'month' | 'status'>): PayrollCycle {
  return {
    sourceCycleId: null,
    createdAt: '',
    createdBy: '',
    releasedAt: null,
    releasedBy: null,
    archivedAt: null,
    archivedBy: null,
    isCurrentDraft: overrides.status === 'DRAFT',
    ...overrides,
  };
}

describe('resolveDefaultCycleId (Phase 5 Checkpoint 4 default-selection rule)', () => {
  it('picks the Draft cycle when one exists, regardless of position in the list', () => {
    const cycles = [
      cycle({ id: 'archived', year: 2026, month: 5, status: 'ARCHIVED' }),
      cycle({ id: 'released', year: 2026, month: 6, status: 'RELEASED' }),
      cycle({ id: 'draft', year: 2026, month: 7, status: 'DRAFT' }),
    ];
    expect(resolveDefaultCycleId(cycles)).toBe('draft');
  });

  it('falls back to the newest Released cycle when no Draft exists', () => {
    const cycles = [
      cycle({ id: 'released', year: 2026, month: 6, status: 'RELEASED' }),
      cycle({ id: 'archived', year: 2026, month: 5, status: 'ARCHIVED' }),
    ];
    expect(resolveDefaultCycleId(cycles)).toBe('released');
  });

  it('falls back to the newest Archived cycle when no Draft or Released cycle exists', () => {
    const cycles = [
      cycle({ id: 'archived-newer', year: 2026, month: 5, status: 'ARCHIVED' }),
      cycle({ id: 'archived-older', year: 2026, month: 4, status: 'ARCHIVED' }),
    ];
    // Newest-first is the caller's own contract (the backend's list order) — this function trusts
    // it rather than re-sorting, so the first Archived match in the given order wins.
    expect(resolveDefaultCycleId(cycles)).toBe('archived-newer');
  });

  it('returns undefined for a truly empty list — the fresh-install case', () => {
    expect(resolveDefaultCycleId([])).toBeUndefined();
  });
});

describe('formatCyclePeriodSlug', () => {
  it('zero-pads single-digit months', () => {
    expect(formatCyclePeriodSlug({ year: 2026, month: 7 })).toBe('2026-07');
  });

  it('does not pad two-digit months', () => {
    expect(formatCyclePeriodSlug({ year: 2026, month: 12 })).toBe('2026-12');
  });
});

describe('formatCycleOptionLabel', () => {
  it('combines the month/year label with a human status word', () => {
    expect(formatCycleOptionLabel({ year: 2026, month: 7, status: 'DRAFT' })).toBe('July 2026 · Draft');
    expect(formatCycleOptionLabel({ year: 2026, month: 6, status: 'RELEASED' })).toBe('June 2026 · Released');
    expect(formatCycleOptionLabel({ year: 2026, month: 5, status: 'ARCHIVED' })).toBe('May 2026 · Archived');
  });
});
