// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PRINT_SELECTION,
  FULL_SELECTION,
  LOCKED_COLUMN_FIELD_ID,
  SUMMARY_CARD_FIELDS,
  TABLE_COLUMN_FIELDS,
  getReadabilityLevel,
  hasNoMeaningfulColumns,
  isFullSelection,
  loadStoredPrintSelection,
  saveStoredPrintSelection,
} from './employee-payroll-history-print-fields';

describe('DEFAULT_PRINT_SELECTION', () => {
  it('defaults to the complete report — every card and every column (never a pre-narrowed default)', () => {
    expect(DEFAULT_PRINT_SELECTION.cards).toHaveLength(SUMMARY_CARD_FIELDS.length);
    expect(DEFAULT_PRINT_SELECTION.columns).toHaveLength(TABLE_COLUMN_FIELDS.length);
    expect(isFullSelection(DEFAULT_PRINT_SELECTION)).toBe(true);
  });

  it('always includes the locked Employee Name column', () => {
    expect(DEFAULT_PRINT_SELECTION.columns).toContain(LOCKED_COLUMN_FIELD_ID);
  });
});

describe('getReadabilityLevel', () => {
  it('returns excellent for a small column count', () => {
    expect(getReadabilityLevel(2).status).toBe('excellent');
  });

  it('returns very-wide once every column is selected', () => {
    expect(getReadabilityLevel(TABLE_COLUMN_FIELDS.length).status).toBe('very-wide');
  });
});

describe('hasNoMeaningfulColumns', () => {
  it('is true when only the locked Employee Name column is selected', () => {
    expect(hasNoMeaningfulColumns({ cards: [], columns: [LOCKED_COLUMN_FIELD_ID] })).toBe(true);
  });

  it('is false once any other column is added', () => {
    expect(hasNoMeaningfulColumns({ cards: [], columns: [LOCKED_COLUMN_FIELD_ID, 'netSalary'] })).toBe(false);
  });

  it('the Full Report selection is never blocked', () => {
    expect(hasNoMeaningfulColumns(FULL_SELECTION)).toBe(false);
  });
});

describe('localStorage persistence', () => {
  afterEach(() => window.localStorage.clear());

  it('round-trips a saved selection', () => {
    const selection = { cards: ['matchingCount' as const], columns: [LOCKED_COLUMN_FIELD_ID, 'netSalary' as const] };
    saveStoredPrintSelection(selection);
    expect(loadStoredPrintSelection()).toEqual(selection);
  });

  it('returns null when nothing has been saved', () => {
    expect(loadStoredPrintSelection()).toBeNull();
  });

  it('silently drops unrecognized ids rather than crashing', () => {
    window.localStorage.setItem(
      'employee-payroll-history-print-fields:v1',
      JSON.stringify({ cards: ['notARealCard'], columns: ['employeeName', 'notARealColumn'] }),
    );
    expect(loadStoredPrintSelection()).toEqual({ cards: [], columns: ['employeeName'] });
  });

  it('re-adds the locked column if a stored selection somehow lost it', () => {
    window.localStorage.setItem(
      'employee-payroll-history-print-fields:v1',
      JSON.stringify({ cards: [], columns: ['netSalary'] }),
    );
    expect(loadStoredPrintSelection()?.columns).toContain(LOCKED_COLUMN_FIELD_ID);
  });

  it('returns null for corrupt JSON rather than throwing', () => {
    window.localStorage.setItem('employee-payroll-history-print-fields:v1', '{not json');
    expect(loadStoredPrintSelection()).toBeNull();
  });
});
