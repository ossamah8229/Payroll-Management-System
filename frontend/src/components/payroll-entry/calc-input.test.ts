import { describe, expect, it } from 'vitest';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { computeServerSnapshot } from './calc-input';

/**
 * Post-Checkpoint-1A UAT Stabilization — regression coverage for the reported EOBI totals defect:
 * the Payroll Entry footer summed every row's raw configured `eobiAmount` regardless of
 * `eobiApplicable`, overstating the total for any employee with EOBI disabled. The canonical rule
 * (`shared/src/lib/calc-net.ts`'s `eobiDeduction`) is `eobiApplicable ? eobiAmount : 0` —
 * `computeServerSnapshot` is the single place that rule must also hold for the live-totals store's
 * own `eobiAmount` field (the value the sticky totals row actually sums), since nothing else
 * feeding that store recomputes it independently.
 */
function makeEntry(overrides: Partial<PayrollEntry> = {}): PayrollEntry {
  return {
    id: 'entry-1',
    cycleId: 'cycle-1',
    employeeId: 'employee-1',
    employee: {
      id: 'employee-1',
      employeeCode: 'V001',
      cnic: null,
      name: 'Test Employee',
      fatherName: null,
      religion: null,
      dateOfBirth: null,
      mobileNumber: null,
      designation: 'Guard',
      siteId: 'site-1',
      site: { id: 'site-1', name: 'Test Site', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
      unitId: 'unit-1',
      unit: { id: 'unit-1', siteId: 'site-1', name: 'Main Branch', code: null, isActive: true, createdAt: '', updatedAt: '' },
      dateOfJoining: null,
      dateOfLeaving: null,
      payType: 'DAILY_WAGE',
      grossPay: '30000',
      bankId: null,
      bank: null,
      branchCode: null,
      accountNumber: null,
      iban: null,
      defaultEobiAmount: '400',
      defaultEobiApplicable: true,
      createdAt: '',
      updatedAt: '',
    },
    siteId: 'site-1',
    site: { id: 'site-1', name: 'Test Site', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
    designation: 'Guard',
    bankId: null,
    branchCode: null,
    accountNumber: null,
    iban: null,
    grossPay: '30000',
    allowance: '0',
    leaveDays: '0',
    leaveRate: null,
    eobiAmount: '400',
    eobiApplicable: true,
    advanceDeduction: '0',
    advanceId: null,
    advance: null,
    eidAdvanceDeduction: '0',
    eidAdvanceId: null,
    eidAdvance: null,
    fine: '0',
    hold: false,
    released: false,
    payoutOutcome: null,
    releaseBlockReasons: [],
    releasedAt: null,
    releasedBy: null,
    lateReason: null,
    remarks: null,
    sortOrder: 0,
    version: 1,
    createdAt: '',
    updatedAt: '',
    workLines: [
      {
        id: 'line-1',
        payrollEntryId: 'entry-1',
        siteId: 'site-1',
        unitId: 'unit-1',
        unit: { id: 'unit-1', siteId: 'site-1', name: 'Main Branch', code: 'BR-01', isActive: true, createdAt: '', updatedAt: '' },
        days: '30',
        otHours: '0',
        otRate: null,
        cycleDays: 30,
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      },
    ],
    calc: {
      workLines: [{ sortOrder: 0, dailyRate: '1000', effectiveOtRate: '0', earnedAmount: '30000', otEarned: '0' }],
      effectiveLeaveRate: '0',
      earnedAmount: '30000',
      otEarned: '0',
      leaveEarned: '0',
      correctionBalancePayable: '0',
      totalEarning: '30000',
      eobiDeduction: '400',
      correctionBalanceRecovery: '0',
      totalDeduction: '400',
      netSalary: '29600',
    },
    ...overrides,
  };
}

describe('computeServerSnapshot — EOBI effective-deduction rule (Post-Checkpoint-1A UAT Stabilization)', () => {
  it('reports the configured amount when eobiApplicable is true', () => {
    const entry = makeEntry({ eobiAmount: '400', eobiApplicable: true });
    expect(computeServerSnapshot(entry).eobiAmount).toBe(400);
  });

  it('reports zero — never the raw configured amount — when eobiApplicable is false', () => {
    const entry = makeEntry({ eobiAmount: '400', eobiApplicable: false });
    expect(computeServerSnapshot(entry).eobiAmount).toBe(0);
  });

  it('a disabled row with a non-default amount still reports zero, not the stored amount', () => {
    const entry = makeEntry({ eobiAmount: '550', eobiApplicable: false });
    expect(computeServerSnapshot(entry).eobiAmount).toBe(0);
  });
});
