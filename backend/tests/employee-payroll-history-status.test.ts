import { EMPLOYEE_PAYROLL_HISTORY_ROW_STATUS_VALUES, type EmployeePayrollHistoryRowStatus } from '@payroll/shared';
import {
  deriveEmployeePayrollHistoryRowStatus,
  employeePayrollHistoryRowStatusWhereClause,
} from '../src/modules/reports/employee-payroll-history-status';

describe('deriveEmployeePayrollHistoryRowStatus', () => {
  it('derives RELEASED for a released entry', () => {
    expect(deriveEmployeePayrollHistoryRowStatus({ released: true, hold: false, payoutOutcome: null })).toBe('RELEASED');
  });

  it('derives HELD for a held, unreleased entry', () => {
    expect(deriveEmployeePayrollHistoryRowStatus({ released: false, hold: true, payoutOutcome: null })).toBe('HELD');
  });

  it('derives NO_PAY_DUE for a resolved-zero-net entry', () => {
    expect(deriveEmployeePayrollHistoryRowStatus({ released: false, hold: false, payoutOutcome: 'NO_PAY_DUE' })).toBe(
      'NO_PAY_DUE',
    );
  });

  it('derives RECOVERY_DUE for a resolved-negative-net entry', () => {
    expect(
      deriveEmployeePayrollHistoryRowStatus({ released: false, hold: false, payoutOutcome: 'RECOVERY_DUE' }),
    ).toBe('RECOVERY_DUE');
  });

  it('derives PENDING for an ordinary, unresolved Draft entry', () => {
    expect(deriveEmployeePayrollHistoryRowStatus({ released: false, hold: false, payoutOutcome: null })).toBe('PENDING');
  });

  describe('impossible/conflicting combinations (should never occur in valid data, per the schema/service invariants — defensive determinism only)', () => {
    it('released takes precedence over a simultaneously-held flag', () => {
      expect(deriveEmployeePayrollHistoryRowStatus({ released: true, hold: true, payoutOutcome: null })).toBe(
        'RELEASED',
      );
    });

    it('released takes precedence over a simultaneously-set payoutOutcome', () => {
      expect(
        deriveEmployeePayrollHistoryRowStatus({ released: true, hold: false, payoutOutcome: 'NO_PAY_DUE' }),
      ).toBe('RELEASED');
      expect(
        deriveEmployeePayrollHistoryRowStatus({ released: true, hold: false, payoutOutcome: 'RECOVERY_DUE' }),
      ).toBe('RELEASED');
    });

    it('released takes precedence even when every other flag is also set', () => {
      expect(
        deriveEmployeePayrollHistoryRowStatus({ released: true, hold: true, payoutOutcome: 'RECOVERY_DUE' }),
      ).toBe('RELEASED');
    });

    it('held takes precedence over a simultaneously-set payoutOutcome, when not released', () => {
      expect(
        deriveEmployeePayrollHistoryRowStatus({ released: false, hold: true, payoutOutcome: 'NO_PAY_DUE' }),
      ).toBe('HELD');
      expect(
        deriveEmployeePayrollHistoryRowStatus({ released: false, hold: true, payoutOutcome: 'RECOVERY_DUE' }),
      ).toBe('HELD');
    });
  });

  it('every EmployeePayrollHistoryRowStatus value is reachable', () => {
    const reachable = new Set<EmployeePayrollHistoryRowStatus>([
      deriveEmployeePayrollHistoryRowStatus({ released: true, hold: false, payoutOutcome: null }),
      deriveEmployeePayrollHistoryRowStatus({ released: false, hold: true, payoutOutcome: null }),
      deriveEmployeePayrollHistoryRowStatus({ released: false, hold: false, payoutOutcome: 'NO_PAY_DUE' }),
      deriveEmployeePayrollHistoryRowStatus({ released: false, hold: false, payoutOutcome: 'RECOVERY_DUE' }),
      deriveEmployeePayrollHistoryRowStatus({ released: false, hold: false, payoutOutcome: null }),
    ]);
    expect([...reachable].sort()).toEqual([...EMPLOYEE_PAYROLL_HISTORY_ROW_STATUS_VALUES].sort());
  });
});

describe('employeePayrollHistoryRowStatusWhereClause — consistency with the derivation function', () => {
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
    const derived = deriveEmployeePayrollHistoryRowStatus(entry);
    const matchingStatuses = EMPLOYEE_PAYROLL_HISTORY_ROW_STATUS_VALUES.filter((status) =>
      matchesWhere(entry, employeePayrollHistoryRowStatusWhereClause(status) as { released?: boolean; hold?: boolean; payoutOutcome?: string | null }),
    );
    expect(matchingStatuses).toEqual([derived]);
  });
});
