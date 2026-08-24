import { describe, expect, it } from 'vitest';
import type { PayrollEntry, PayrollEntryWorkLine } from '@/hooks/use-payroll-entries';
import { computeServerSnapshot } from './calc-input';
import { LiveTotalsStore } from './live-totals-store';

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
      totalWorkingDays: '30',
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

/**
 * v1.0.0 release blocker — Payroll Entry Working-Days Aggregation and Export Correctness. Reported
 * defect: a split-unit employee (e.g. 10 days at Unit A + 10 days at Unit B) showed only 10 Working
 * Days in the Payroll Entry grid's parent row, and the sticky totals row footer undercounted the
 * same way — both derived from the primary work line only, ignoring every other line.
 * `computeServerSnapshot` is what seeds `LiveTotalsStore` for every row, including rows the
 * virtualizer has never mounted (`live-totals-store.ts`'s own doc comment), so its `days` field is
 * exactly the footer's per-row contribution.
 */
function makeWorkLine(overrides: Partial<PayrollEntryWorkLine> & { id: string }): PayrollEntryWorkLine {
  return {
    payrollEntryId: 'entry-multi',
    siteId: 'site-1',
    unitId: 'unit-1',
    unit: { id: 'unit-1', siteId: 'site-1', name: 'Main Branch', code: 'BR-01', isActive: true, createdAt: '', updatedAt: '' },
    days: '0',
    otHours: '0',
    otRate: null,
    cycleDays: 30,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('computeServerSnapshot — employee aggregate Working Days (v1.0.0 Working-Days Aggregation)', () => {
  it('a single-unit employee is unchanged: days is that one line\'s own value', () => {
    const entry = makeEntry();
    expect(computeServerSnapshot(entry).days).toBe(30);
  });

  it('a two-unit split employee reports the sum, 10 + 10 = 20, not the primary line\'s own 10', () => {
    const entry = makeEntry({
      id: 'entry-multi',
      workLines: [
        makeWorkLine({ id: 'line-a', unitId: 'unit-a', unit: { id: 'unit-a', siteId: 'site-1', name: 'Unit A', code: 'UA', isActive: true, createdAt: '', updatedAt: '' }, days: '10', sortOrder: 0 }),
        makeWorkLine({ id: 'line-b', unitId: 'unit-b', unit: { id: 'unit-b', siteId: 'site-1', name: 'Unit B', code: 'UB', isActive: true, createdAt: '', updatedAt: '' }, days: '10', sortOrder: 1 }),
      ],
    });
    expect(computeServerSnapshot(entry).days).toBe(20);
  });

  it('an unequal split preserves the true total: 7 + 13 = 20', () => {
    const entry = makeEntry({
      id: 'entry-multi',
      workLines: [
        makeWorkLine({ id: 'line-a', unitId: 'unit-a', days: '7', sortOrder: 0 }),
        makeWorkLine({ id: 'line-b', unitId: 'unit-b', days: '13', sortOrder: 1 }),
      ],
    });
    expect(computeServerSnapshot(entry).days).toBe(20);
  });

  it('a mixed roster footer total is the mathematical sum of every work line\'s own days, across single- and multi-unit employees alike', () => {
    const store = new LiveTotalsStore();
    const singleUnit = makeEntry({ id: 'entry-1' }); // 30 days, one line
    const splitTwo = makeEntry({
      id: 'entry-2',
      workLines: [
        makeWorkLine({ id: 'line-2a', unitId: 'unit-a', days: '10', sortOrder: 0 }),
        makeWorkLine({ id: 'line-2b', unitId: 'unit-b', days: '10', sortOrder: 1 }),
      ],
    });
    const splitThree = makeEntry({
      id: 'entry-3',
      workLines: [
        makeWorkLine({ id: 'line-3a', unitId: 'unit-a', days: '5', sortOrder: 0 }),
        makeWorkLine({ id: 'line-3b', unitId: 'unit-b', days: '8', sortOrder: 1 }),
        makeWorkLine({ id: 'line-3c', unitId: 'unit-c', days: '9.5', sortOrder: 2 }),
      ],
    });
    store.setBase(
      [singleUnit, splitTwo, splitThree].map((entry) => ({ id: entry.id, snapshot: computeServerSnapshot(entry) })),
    );
    // 30 (single) + 20 (10+10) + 22.5 (5+8+9.5) = 72.5 — never 30+10+5=45, the old primary-line-only sum.
    expect(store.getTotals().days).toBe(72.5);
    expect(store.rowCount).toBe(3);
  });
});
