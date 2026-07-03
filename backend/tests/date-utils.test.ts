import { formatDate, parseDateInput, toIsoDateOnly } from '@payroll/shared';

/**
 * Pure unit tests, no database involved — the shared date utilities are the single source of
 * truth for the `DD-MM-YYYY` display convention (docs/design-system.md §4) and must be exercised
 * directly, the same way the Numbers convention calls for (docs/design-system.md §4).
 */
describe('formatDate', () => {
  it('formats an ISO date string as DD-MM-YYYY', () => {
    expect(formatDate('2026-03-05')).toBe('05-03-2026');
  });

  it('formats an ISO datetime string using only its date portion', () => {
    expect(formatDate('2026-03-05T00:00:00.000Z')).toBe('05-03-2026');
  });

  it('formats a Date object as DD-MM-YYYY using UTC', () => {
    expect(formatDate(new Date('2026-12-31T00:00:00.000Z'))).toBe('31-12-2026');
  });

  it('returns an empty string for null/undefined/empty input', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
  });
});

describe('toIsoDateOnly', () => {
  it('normalizes an ISO datetime string to a pure date', () => {
    expect(toIsoDateOnly('2026-03-05T00:00:00.000Z')).toBe('2026-03-05');
  });

  it('leaves an already-pure ISO date string unchanged', () => {
    expect(toIsoDateOnly('2026-03-05')).toBe('2026-03-05');
  });

  it('normalizes a Date object', () => {
    expect(toIsoDateOnly(new Date('2026-07-01T00:00:00.000Z'))).toBe('2026-07-01');
  });

  it('returns an empty string for null/undefined/empty input', () => {
    expect(toIsoDateOnly(null)).toBe('');
    expect(toIsoDateOnly(undefined)).toBe('');
    expect(toIsoDateOnly('')).toBe('');
  });
});

describe('parseDateInput', () => {
  it('parses a complete, valid DD-MM-YYYY string to ISO', () => {
    expect(parseDateInput('05-03-2026')).toBe('2026-03-05');
  });

  it('rejects an out-of-range month', () => {
    expect(parseDateInput('05-13-2026')).toBeNull();
  });

  it('rejects a day that does not exist in the given month', () => {
    expect(parseDateInput('31-02-2026')).toBeNull();
  });

  it('accepts the last valid day of February in a leap year', () => {
    expect(parseDateInput('29-02-2028')).toBe('2028-02-29');
  });

  it('rejects Feb 29 in a non-leap year', () => {
    expect(parseDateInput('29-02-2026')).toBeNull();
  });

  it('rejects malformed or partial input', () => {
    expect(parseDateInput('2026-03-05')).toBeNull();
    expect(parseDateInput('5-3-2026')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });

  it('round-trips with formatDate', () => {
    const iso = '2026-03-05';
    expect(parseDateInput(formatDate(iso))).toBe(iso);
  });
});
