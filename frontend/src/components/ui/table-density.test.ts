import { describe, expect, it } from 'vitest';
import { tableCellPaddingClass, tableHeadPaddingClass } from './table';

/**
 * Deterministic-logic coverage for the shared table-density system (Post-Phase-5 Stabilization
 * Checkpoint 2, Part 3) — the density-to-padding-class mapping `TableHead`/`TableCell` both
 * delegate to, tested directly rather than via component rendering (this project's own
 * established convention, `vitest.config.ts`: "deterministic logic... unit tested", not jsdom/DOM
 * assertions). Real rendered row height is content-driven and verified in a real browser.
 */
describe('table density padding classes', () => {
  it('defaults every unspecified density to standard', () => {
    expect(tableHeadPaddingClass('standard')).toBe('py-2.5');
    expect(tableCellPaddingClass('standard')).toBe('py-3');
  });

  it('gives compact density its own, smaller padding — never the same value as standard', () => {
    expect(tableHeadPaddingClass('compact')).toBe('py-2');
    expect(tableCellPaddingClass('compact')).toBe('py-2');
    expect(tableHeadPaddingClass('compact')).not.toBe(tableHeadPaddingClass('standard'));
    expect(tableCellPaddingClass('compact')).not.toBe(tableCellPaddingClass('standard'));
  });
});
