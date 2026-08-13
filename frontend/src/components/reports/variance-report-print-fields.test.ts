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
} from './variance-report-print-fields';

/**
 * Print content verification, config/data-model level (preferred over only a button-click test):
 * the print field *vocabulary itself* must never be able to expose a sensitive field, regardless of
 * what a future caller selects — checked directly against the id/label lists rather than inferred
 * from one rendered instance of the dialog. Neither `VarianceReportRow` (frozen Checkpoint 1A
 * contract) nor this vocabulary carries CNIC, banking, Released By, payment method, correction
 * reason, or any audit-actor identity — `hasComparisonCorrection`/`hasCurrentCorrection` are
 * existence-only booleans, deliberately NOT in the forbidden list below (they are this report's own
 * frozen, approved fields, never a sensitive exclusion).
 */
describe('print field vocabulary — sensitive-field exclusion', () => {
  const forbidden = [
    'cnic',
    'accountnumber',
    'iban',
    'bankname',
    'bankid',
    'branchcode',
    'paymentmethod',
    'releasedby',
    'releaseactor',
    'auditactor',
    'correctionreason',
    'reason',
    'calcnet',
  ];

  it('no summary card id or label ever names a sensitive field', () => {
    for (const field of SUMMARY_CARD_FIELDS) {
      const haystack = `${field.id}${field.label}`.toLowerCase().replace(/[^a-z]/g, '');
      for (const term of forbidden) {
        expect(haystack).not.toContain(term);
      }
    }
  });

  it('no table column id or label ever names a sensitive field', () => {
    for (const field of TABLE_COLUMN_FIELDS) {
      const haystack = `${field.id}${field.label}`.toLowerCase().replace(/[^a-z]/g, '');
      for (const term of forbidden) {
        expect(haystack).not.toContain(term);
      }
    }
  });

  it('the vocabulary keeps correction context as existence-only, separately-labeled fields (never a reason/actor)', () => {
    const ids = TABLE_COLUMN_FIELDS.map((f) => f.id);
    expect(ids).toContain('hasComparisonCorrection');
    expect(ids).toContain('hasCurrentCorrection');
  });

  it('the vocabulary carries both cycle-comparison sides as distinct fields (Comparison Site/Current Site, Previous Net/Current Net)', () => {
    const ids = TABLE_COLUMN_FIELDS.map((f) => f.id);
    expect(ids).toContain('comparisonSite');
    expect(ids).toContain('currentSite');
    expect(ids).toContain('comparisonNet');
    expect(ids).toContain('currentNet');
  });
});

describe('population/direction are represented in the print vocabulary', () => {
  it('includes populationStatus and direction as their own independent columns', () => {
    const ids = TABLE_COLUMN_FIELDS.map((f) => f.id);
    expect(ids).toContain('populationStatus');
    expect(ids).toContain('direction');
  });
});

describe('readability — informational only, never blocking', () => {
  it('Very Wide status never makes hasNoMeaningfulColumns true — the readability warning and the hard block are two fully independent checks', () => {
    expect(getReadabilityLevel(TABLE_COLUMN_FIELDS.length).status).toBe('very-wide');
    expect(hasNoMeaningfulColumns(FULL_SELECTION)).toBe(false);
  });

  it('every readability level carries its own explanation text, never a bare status code alone', () => {
    for (let count = 0; count <= TABLE_COLUMN_FIELDS.length; count += 1) {
      const level = getReadabilityLevel(count);
      expect(level.explanation.length).toBeGreaterThan(0);
    }
  });
});

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

  it('returns very-wide once every column is selected (14-column max)', () => {
    expect(TABLE_COLUMN_FIELDS.length).toBe(14);
    expect(getReadabilityLevel(TABLE_COLUMN_FIELDS.length).status).toBe('very-wide');
  });

  it('returns good at 5 columns and wide at 8, matching the documented thresholds', () => {
    expect(getReadabilityLevel(5).status).toBe('good');
    expect(getReadabilityLevel(8).status).toBe('wide');
  });
});

describe('hasNoMeaningfulColumns', () => {
  it('is true when only the locked Employee Name column is selected', () => {
    expect(hasNoMeaningfulColumns({ cards: [], columns: [LOCKED_COLUMN_FIELD_ID] })).toBe(true);
  });

  it('is false once any other column is added', () => {
    expect(hasNoMeaningfulColumns({ cards: [], columns: [LOCKED_COLUMN_FIELD_ID, 'populationStatus'] })).toBe(false);
  });

  it('the Full Report selection is never blocked', () => {
    expect(hasNoMeaningfulColumns(FULL_SELECTION)).toBe(false);
  });
});

describe('localStorage persistence', () => {
  afterEach(() => window.localStorage.clear());

  it('round-trips a saved selection', () => {
    const selection = { cards: ['matchingCount' as const], columns: [LOCKED_COLUMN_FIELD_ID, 'populationStatus' as const] };
    saveStoredPrintSelection(selection);
    expect(loadStoredPrintSelection()).toEqual(selection);
  });

  it('returns null when nothing has been saved', () => {
    expect(loadStoredPrintSelection()).toBeNull();
  });

  it('uses its own versioned key, independent of the sibling reports’ own storage keys', () => {
    saveStoredPrintSelection({ cards: [], columns: [LOCKED_COLUMN_FIELD_ID] });
    expect(window.localStorage.getItem('variance-report-print-fields:v1')).not.toBeNull();
    expect(window.localStorage.getItem('salary-release-report-print-fields:v1')).toBeNull();
    expect(window.localStorage.getItem('deduction-report-print-fields:v1')).toBeNull();
  });

  it('silently drops unrecognized ids rather than crashing', () => {
    window.localStorage.setItem(
      'variance-report-print-fields:v1',
      JSON.stringify({ cards: ['notARealCard'], columns: ['employeeName', 'notARealColumn'] }),
    );
    expect(loadStoredPrintSelection()).toEqual({ cards: [], columns: ['employeeName'] });
  });

  it('re-adds the locked column if a stored selection somehow lost it', () => {
    window.localStorage.setItem('variance-report-print-fields:v1', JSON.stringify({ cards: [], columns: ['populationStatus'] }));
    expect(loadStoredPrintSelection()?.columns).toContain(LOCKED_COLUMN_FIELD_ID);
  });

  it('returns null for corrupt JSON rather than throwing', () => {
    window.localStorage.setItem('variance-report-print-fields:v1', '{not json');
    expect(loadStoredPrintSelection()).toBeNull();
  });
});
