import { describe, expect, it } from 'vitest';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { sortPayrollEntries, type SortState } from './sort-entries';

/** Payroll Entry usability checkpoint (2026-07-24) — focused coverage for the grid's new
 * sortable columns. `sortPayrollEntries` is pure, so these are plain Node-environment unit tests
 * (no rendering needed) — the rendering/interaction side (clicking a header, full-row reordering
 * in the DOM, totals staying put) is covered separately in `payroll-entry-grid.test.tsx`. */

function makeEntry(overrides: Partial<PayrollEntry> & { id: string }): PayrollEntry {
  const id = overrides.id;
  return {
    cycleId: 'cycle-1',
    employeeId: `employee-${id}`,
    employee: {
      id: `employee-${id}`,
      employeeCode: null,
      cnic: null,
      name: 'Employee',
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
        id: `line-${id}`,
        payrollEntryId: id,
        siteId: 'site-1',
        unitId: 'unit-1',
        unit: { id: 'unit-1', siteId: 'site-1', name: 'Main Branch', code: null, isActive: true, createdAt: '', updatedAt: '' },
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

function withEmployeeName(id: string, name: string): PayrollEntry {
  return makeEntry({ id, employee: { ...makeEntry({ id }).employee, name } });
}

function withUnitCode(id: string, code: string | null): PayrollEntry {
  const base = makeEntry({ id });
  return {
    ...base,
    workLines: [{ ...base.workLines[0]!, unit: { ...base.workLines[0]!.unit, code } }],
  };
}

describe('sortPayrollEntries', () => {
  it('sorts Employee Name A→Z', () => {
    const entries = [withEmployeeName('1', 'Charlie'), withEmployeeName('2', 'Alice'), withEmployeeName('3', 'Bob')];
    const sort: SortState = { columnId: 'employeeName', direction: 'asc' };
    expect(sortPayrollEntries(entries, sort).map((e) => e.employee.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('sorts Employee Name Z→A', () => {
    const entries = [withEmployeeName('1', 'Charlie'), withEmployeeName('2', 'Alice'), withEmployeeName('3', 'Bob')];
    const sort: SortState = { columnId: 'employeeName', direction: 'desc' };
    expect(sortPayrollEntries(entries, sort).map((e) => e.employee.name)).toEqual(['Charlie', 'Bob', 'Alice']);
  });

  it('sorts Branch Code ascending, with sensible alphanumeric ordering', () => {
    const entries = [withUnitCode('1', 'BR-10'), withUnitCode('2', 'BR-2'), withUnitCode('3', 'BR-1')];
    const sort: SortState = { columnId: 'unitCode', direction: 'asc' };
    expect(sortPayrollEntries(entries, sort).map((e) => e.workLines[0]!.unit.code)).toEqual([
      'BR-1',
      'BR-2',
      'BR-10',
    ]);
  });

  it('sorts Branch Code descending', () => {
    const entries = [withUnitCode('1', 'BR-10'), withUnitCode('2', 'BR-2'), withUnitCode('3', 'BR-1')];
    const sort: SortState = { columnId: 'unitCode', direction: 'desc' };
    expect(sortPayrollEntries(entries, sort).map((e) => e.workLines[0]!.unit.code)).toEqual([
      'BR-10',
      'BR-2',
      'BR-1',
    ]);
  });

  it('handles missing Branch Code values deterministically — always last, in both directions', () => {
    const entries = [withUnitCode('1', 'BR-2'), withUnitCode('2', null), withUnitCode('3', 'BR-1')];
    const asc = sortPayrollEntries(entries, { columnId: 'unitCode', direction: 'asc' });
    expect(asc.map((e) => e.workLines[0]!.unit.code)).toEqual(['BR-1', 'BR-2', null]);

    const desc = sortPayrollEntries(entries, { columnId: 'unitCode', direction: 'desc' });
    expect(desc.map((e) => e.workLines[0]!.unit.code)).toEqual(['BR-2', 'BR-1', null]);
  });

  it('uses stable ordering for equal values — ties keep their original relative order', () => {
    const entries = [
      withUnitCode('1', 'BR-1'),
      withUnitCode('2', 'BR-1'),
      withUnitCode('3', 'BR-1'),
      withUnitCode('4', 'BR-1'),
    ];
    const sorted = sortPayrollEntries(entries, { columnId: 'unitCode', direction: 'asc' });
    expect(sorted.map((e) => e.id)).toEqual(['1', '2', '3', '4']);
  });

  it('sorts Gross Pay and Net Salary numerically, not lexicographically', () => {
    const entries = [
      makeEntry({ id: '1', grossPay: '9000' }),
      makeEntry({ id: '2', grossPay: '10000' }),
      makeEntry({ id: '3', grossPay: '500' }),
    ];
    const sorted = sortPayrollEntries(entries, { columnId: 'grossPay', direction: 'asc' });
    expect(sorted.map((e) => e.grossPay)).toEqual(['500', '9000', '10000']);
  });

  it('returns the same array reference (natural order) when no sort is active, and never mutates the input', () => {
    const entries = [withEmployeeName('1', 'Bob'), withEmployeeName('2', 'Alice')];
    const original = [...entries];
    const result = sortPayrollEntries(entries, null);
    expect(result).toBe(entries);

    sortPayrollEntries(entries, { columnId: 'employeeName', direction: 'asc' });
    expect(entries).toEqual(original);
  });
});
