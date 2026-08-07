import {
  PAYROLL_ENTRY_ROW_STATUS_VALUES,
  derivePayrollEntryRowStatus,
  payrollEntryRowStatusWhereClause,
  type PayrollEntryRowStatus,
} from '../src/modules/reports/payroll-entry-row-status';

/**
 * Phase 7 Reports, Deduction Report Checkpoint 1A — behavior-preservation suite for the
 * third-consumer extraction of what was `employee-payroll-history-status.ts`'s
 * `deriveEmployeePayrollHistoryRowStatus`/`employeePayrollHistoryRowStatusWhereClause` into this
 * neutral `payroll-entry-row-status.ts` module (renamed, moved verbatim — no semantic change).
 * Every test below is unchanged from the pre-extraction suite except for the rename itself, so a
 * green run here is direct evidence the move altered no behavior. Employee Payroll History and
 * Project Site Payroll Report both now import from this module directly instead of maintaining
 * their own copy; their own test suites passing unweakened is the second half of that same proof.
 */
describe('derivePayrollEntryRowStatus', () => {
  it('derives RELEASED for a released entry', () => {
    expect(derivePayrollEntryRowStatus({ released: true, hold: false, payoutOutcome: null })).toBe('RELEASED');
  });

  it('derives HELD for a held, unreleased entry', () => {
    expect(derivePayrollEntryRowStatus({ released: false, hold: true, payoutOutcome: null })).toBe('HELD');
  });

  it('derives NO_PAY_DUE for a resolved-zero-net entry', () => {
    expect(derivePayrollEntryRowStatus({ released: false, hold: false, payoutOutcome: 'NO_PAY_DUE' })).toBe(
      'NO_PAY_DUE',
    );
  });

  it('derives RECOVERY_DUE for a resolved-negative-net entry', () => {
    expect(
      derivePayrollEntryRowStatus({ released: false, hold: false, payoutOutcome: 'RECOVERY_DUE' }),
    ).toBe('RECOVERY_DUE');
  });

  it('derives PENDING for an ordinary, unresolved Draft entry', () => {
    expect(derivePayrollEntryRowStatus({ released: false, hold: false, payoutOutcome: null })).toBe('PENDING');
  });

  describe('impossible/conflicting combinations (should never occur in valid data, per the schema/service invariants — defensive determinism only)', () => {
    it('released takes precedence over a simultaneously-held flag', () => {
      expect(derivePayrollEntryRowStatus({ released: true, hold: true, payoutOutcome: null })).toBe(
        'RELEASED',
      );
    });

    it('released takes precedence over a simultaneously-set payoutOutcome', () => {
      expect(
        derivePayrollEntryRowStatus({ released: true, hold: false, payoutOutcome: 'NO_PAY_DUE' }),
      ).toBe('RELEASED');
      expect(
        derivePayrollEntryRowStatus({ released: true, hold: false, payoutOutcome: 'RECOVERY_DUE' }),
      ).toBe('RELEASED');
    });

    it('released takes precedence even when every other flag is also set', () => {
      expect(
        derivePayrollEntryRowStatus({ released: true, hold: true, payoutOutcome: 'RECOVERY_DUE' }),
      ).toBe('RELEASED');
    });

    it('held takes precedence over a simultaneously-set payoutOutcome, when not released', () => {
      expect(
        derivePayrollEntryRowStatus({ released: false, hold: true, payoutOutcome: 'NO_PAY_DUE' }),
      ).toBe('HELD');
      expect(
        derivePayrollEntryRowStatus({ released: false, hold: true, payoutOutcome: 'RECOVERY_DUE' }),
      ).toBe('HELD');
    });
  });

  it('every PayrollEntryRowStatus value is reachable', () => {
    const reachable = new Set<PayrollEntryRowStatus>([
      derivePayrollEntryRowStatus({ released: true, hold: false, payoutOutcome: null }),
      derivePayrollEntryRowStatus({ released: false, hold: true, payoutOutcome: null }),
      derivePayrollEntryRowStatus({ released: false, hold: false, payoutOutcome: 'NO_PAY_DUE' }),
      derivePayrollEntryRowStatus({ released: false, hold: false, payoutOutcome: 'RECOVERY_DUE' }),
      derivePayrollEntryRowStatus({ released: false, hold: false, payoutOutcome: null }),
    ]);
    expect([...reachable].sort()).toEqual([...PAYROLL_ENTRY_ROW_STATUS_VALUES].sort());
  });
});

describe('payrollEntryRowStatusWhereClause — consistency with the derivation function', () => {
  // A representative sample of entry shapes, including the "impossible" combinations above —
  // for every shape, the WHERE clause that matches it must have the same status label the
  // derivation function assigns it. This is what keeps the filter and the derivation from
  // silently drifting apart if either is edited later without the other.
  const sampleEntries: Array<{ released: boolean; hold: boolean; payoutOutcome: 'NO_PAY_DUE' | 'RECOVERY_DUE' | null }> = [
    { released: true, hold: false, payoutOutcome: null },
    { released: false, hold: true, payoutOutcome: null },
    { released: false, hold: false, payoutOutcome: 'NO_PAY_DUE' },
    { released: false, hold: false, payoutOutcome: 'RECOVERY_DUE' },
    { released: false, hold: false, payoutOutcome: null },
    { released: true, hold: true, payoutOutcome: null },
    { released: true, hold: false, payoutOutcome: 'RECOVERY_DUE' },
    { released: false, hold: true, payoutOutcome: 'NO_PAY_DUE' },
  ];

  function matchesWhere(
    entry: { released: boolean; hold: boolean; payoutOutcome: 'NO_PAY_DUE' | 'RECOVERY_DUE' | null },
    where: { released?: boolean; hold?: boolean; payoutOutcome?: string | null },
  ): boolean {
    if (where.released !== undefined && where.released !== entry.released) return false;
    if (where.hold !== undefined && where.hold !== entry.hold) return false;
    if (where.payoutOutcome !== undefined && where.payoutOutcome !== entry.payoutOutcome) return false;
    return true;
  }

  it.each(sampleEntries)('the derived status for %o matches exactly one status-filter predicate, and no other', (entry) => {
    const derived = derivePayrollEntryRowStatus(entry);
    const matchingStatuses = PAYROLL_ENTRY_ROW_STATUS_VALUES.filter((status) =>
      matchesWhere(entry, payrollEntryRowStatusWhereClause(status) as { released?: boolean; hold?: boolean; payoutOutcome?: string | null }),
    );
    expect(matchingStatuses).toEqual([derived]);
  });
});
