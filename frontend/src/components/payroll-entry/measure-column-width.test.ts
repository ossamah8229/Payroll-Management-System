import { describe, expect, it } from 'vitest';
import { measureColumnWidth } from './measure-column-width';

describe('measureColumnWidth', () => {
  it('never shrinks below the header text width, even with no loaded values', () => {
    const widthEmpty = measureColumnWidth({ header: 'IBAN', values: [] });
    const widthNulls = measureColumnWidth({ header: 'IBAN', values: [null, undefined, ''] });
    expect(widthEmpty).toBeGreaterThan(0);
    expect(widthEmpty).toBe(widthNulls);
  });

  it('grows with the longest loaded value, not the average or the header', () => {
    const short = measureColumnWidth({ header: 'Account No.', values: ['123'] });
    const long = measureColumnWidth({ header: 'Account No.', values: ['123', '00330011002233445566'] });
    expect(long).toBeGreaterThan(short);
  });

  it('a 24-character IBAN test value produces a narrower column than a 34-character one', () => {
    const iban24 = measureColumnWidth({ header: 'IBAN', values: ['PK36SCBL0000001123456702'] });
    const iban34 = measureColumnWidth({ header: 'IBAN', values: ['PK36ABCD1234567890123456789012345'] });
    expect(iban24).toBeLessThan(iban34);
    // Both must comfortably exceed the raw character count in pixels — this is not a bare fit.
    expect(iban24).toBeGreaterThan(25 * 4); // sanity floor: more than ~4px/char even at its narrowest
  });

  it('the longer of two loaded IBANs determines the column — the sizing calculation inspects every value, not just one', () => {
    const width = measureColumnWidth({
      header: 'IBAN',
      values: ['PK36SCBL0000001123456702', 'PK36ABCD1234567890123456789012345', null],
    });
    const widthFromLongestAlone = measureColumnWidth({
      header: 'IBAN',
      values: ['PK36ABCD1234567890123456789012345'],
    });
    expect(width).toBe(widthFromLongestAlone);
  });

  it('respects an explicit minimum floor even when content is shorter than it', () => {
    const width = measureColumnWidth({ header: 'X', values: ['1'], minimumPx: 500 });
    expect(width).toBe(500);
  });

  it('a longer header than any loaded value still governs the width (header-versus-content)', () => {
    const width = measureColumnWidth({ header: 'Eid Advance Ded.', values: ['0.00'] });
    const headerOnly = measureColumnWidth({ header: 'Eid Advance Ded.', values: [] });
    expect(width).toBe(headerOnly);
  });

  it('is a pure, deterministic function — the same input always produces the same output', () => {
    const options = { header: 'Account No.', values: ['00330011002233445566', '9999'] };
    expect(measureColumnWidth(options)).toBe(measureColumnWidth(options));
  });
});
