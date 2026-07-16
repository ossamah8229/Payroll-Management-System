import { sanitizeCsvCell, stringifyCsvSafe } from '../src/common/import-export';

/**
 * Regression coverage for the CSV/spreadsheet-formula-injection security correction
 * (docs/PROJECT_PROGRESS.md, Post-Phase-5 Stabilization Checkpoint 1) — `sanitizeCsvCell` is the
 * single implementation every CSV export in this codebase (Employee Registry, Payroll Entry, Bank
 * Sheet, Cash Receiving) now routes through via `stringifyCsvSafe`, so this file exercises it
 * directly rather than duplicating the same assertions once per export module.
 */
describe('CSV formula-injection sanitization', () => {
  describe('sanitizeCsvCell', () => {
    it.each([
      ['=cmd|\'/C calc\'!A1', "'=cmd|'/C calc'!A1"],
      ['=HYPERLINK("http://evil.example", "click me")', '\'=HYPERLINK("http://evil.example", "click me")'],
      ['+1+1', "'+1+1"],
      ['@SUM(1+1)', "'@SUM(1+1)"],
      ['\tmalicious', "'\tmalicious"],
      ['\rmalicious', "'\rmalicious"],
    ])('neutralizes a formula-triggering payload %p', (input, expected) => {
      expect(sanitizeCsvCell(input)).toBe(expected);
    });

    it('leaves ordinary text untouched', () => {
      expect(sanitizeCsvCell('Muhammad Aslam')).toBe('Muhammad Aslam');
      expect(sanitizeCsvCell('Karachi Head Office')).toBe('Karachi Head Office');
      expect(sanitizeCsvCell('')).toBe('');
    });

    it('leaves a genuine negative number untouched (does not corrupt monetary formatting)', () => {
      expect(sanitizeCsvCell('-500')).toBe('-500');
      expect(sanitizeCsvCell('-500.25')).toBe('-500.25');
    });

    it('still neutralizes a non-numeric string that merely starts with a trigger character', () => {
      // "-" followed by non-numeric content is not a legitimate negative number.
      expect(sanitizeCsvCell('-not-a-number')).toBe("'-not-a-number");
    });

    it('passes through non-string values unchanged (numbers, null, undefined)', () => {
      expect(sanitizeCsvCell(42)).toBe(42);
      expect(sanitizeCsvCell(null)).toBe(null);
      expect(sanitizeCsvCell(undefined)).toBe(undefined);
    });
  });

  describe('stringifyCsvSafe', () => {
    it('neutralizes a malicious cell anywhere in a row, including headers and metadata rows', () => {
      const csv = stringifyCsvSafe([
        ['Company Name'],
        ['=cmd|\'/C calc\'!A1', 'Designation', 'Net Salary'],
        ['Normal Employee', 'Guard', '30000'],
      ]);
      const lines = csv.trim().split('\n');
      expect(lines[1]).toMatch(/^'=cmd\|/);
      expect(lines[2]).toBe('Normal Employee,Guard,30000');
    });

    it('produces normal, unquoted-where-possible CSV for entirely legitimate rows', () => {
      const csv = stringifyCsvSafe([
        ['Employee Code', 'Employee Name', 'Net Salary'],
        ['EMP-001', 'Muhammad Aslam', '32000'],
      ]);
      expect(csv.trim()).toBe('Employee Code,Employee Name,Net Salary\nEMP-001,Muhammad Aslam,32000');
    });

    it('round-trips an empty separator row without error', () => {
      expect(() => stringifyCsvSafe([['A'], [], ['B']])).not.toThrow();
    });
  });
});
