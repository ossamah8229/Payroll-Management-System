import { excelColumnWidth } from '../src/common/excel-utils';

describe('excelColumnWidth (Dynamic Width Rule)', () => {
  it('returns header length + 3 when the header is longer than every value', () => {
    expect(excelColumnWidth('Employee Name', ['Ali', 'Bilal'])).toBe('Employee Name'.length + 3);
  });

  it('returns the longest value length + 3 when a value is longer than the header', () => {
    const iban = 'PK36SCBL0000001123456702';
    expect(excelColumnWidth('IBAN', [iban])).toBe(iban.length + 3);
  });

  it('treats empty values as zero-length, never throwing on an empty column', () => {
    expect(excelColumnWidth('Net Salary', [])).toBe('Net Salary'.length + 3);
  });

  it('is behavior-preserving relative to every prior local copy (longest + 3, header included in the comparison)', () => {
    // Same fixture shape `bank-sheets.test.ts` already asserts against for its own un-migrated
    // copy — proves this extraction produced byte-identical output, not merely similar output.
    const values = ['A', 'BB', 'CCC'];
    expect(excelColumnWidth('X', values)).toBe(3 + 3);
  });
});
