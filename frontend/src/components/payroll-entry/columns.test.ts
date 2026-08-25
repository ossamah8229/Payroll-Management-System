import { describe, expect, it } from 'vitest';
import type { Bank } from '@/hooks/use-banks';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { FROZEN_LEFT_COLUMN_IDS, PAYROLL_COLUMNS, computeColumnWidths, gridTemplateColumns, totalGridWidth } from './columns';

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
      workLines: [
        { sortOrder: 0, dailyRate: '1000', effectiveOtRate: '0', earnedAmount: '30000', otEarned: '0' },
      ],
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

const testBank: Bank = { id: 'bank-1', code: 'HABIBMETRO', name: 'Habib Metropolitan Bank', isActive: true, isReferenced: true };

describe('computeColumnWidths', () => {
  it('displays the Bank Code, not the Bank Name — the approved dense-grid Bank display rule', () => {
    const entry = makeEntry({ bankId: testBank.id });
    const resolved = computeColumnWidths([entry], [testBank]);
    const bankColumn = resolved.find((c) => c.id === 'bankId')!;
    // A column sized only for "HABIBMETRO" (10 chars) is far narrower than one sized for
    // "Habib Metropolitan Bank (HABIBMETRO)" (37 chars) — this is what actually proves the code,
    // not the name, drove the measurement (not just an assertion on the rendered label elsewhere).
    expect(bankColumn.width).toBeLessThan(150);
  });

  it('a cash entry (no bankId) contributes "Cash" to the Bank column, not a blank', () => {
    const entry = makeEntry({ bankId: null });
    const resolved = computeColumnWidths([entry], [testBank]);
    const bankColumn = resolved.find((c) => c.id === 'bankId')!;
    expect(bankColumn.width).toBeGreaterThanOrEqual(60);
  });

  it('IBAN column widens for a longer loaded value — the 34-character schema maximum needs more room than the 24-character Pakistani test value', () => {
    const shortIban = makeEntry({ iban: 'PK36SCBL0000001123456702' });
    const longIban = makeEntry({ iban: 'PK36ABCD1234567890123456789012345' });
    const resolvedShort = computeColumnWidths([shortIban], []);
    const resolvedLong = computeColumnWidths([longIban], []);
    const ibanShort = resolvedShort.find((c) => c.id === 'iban')!;
    const ibanLong = resolvedLong.find((c) => c.id === 'iban')!;
    expect(ibanLong.width).toBeGreaterThan(ibanShort.width);
  });

  it('Account Number column reflects the longest loaded value across the full dataset, not just one row', () => {
    const shortAcct = makeEntry({ id: 'e1', accountNumber: '123' });
    const longAcct = makeEntry({ id: 'e2', accountNumber: '00330011002233445566' });
    const resolved = computeColumnWidths([shortAcct, longAcct], []);
    const soloShort = computeColumnWidths([shortAcct], []);
    const accountColumn = resolved.find((c) => c.id === 'accountNumber')!;
    const soloShortColumn = soloShort.find((c) => c.id === 'accountNumber')!;
    // The dataset containing the long value must be at least as wide as the long value alone
    // demands — proves the calculation inspects every loaded row, not an arbitrary one.
    expect(accountColumn.width).toBeGreaterThan(soloShortColumn.width);
  });

  it('fixed-width UI controls (toggles, serial, Units pill) never change size with data, unlike text columns', () => {
    const shortEntry = makeEntry({ remarks: null });
    const longEntry = makeEntry({ remarks: 'A very long remark that would otherwise widen a text column considerably' });
    const resolvedShort = computeColumnWidths([shortEntry], []);
    const resolvedLong = computeColumnWidths([longEntry], []);
    for (const id of ['serial', 'units', 'eobiApplicable', 'hold']) {
      const short = resolvedShort.find((c) => c.id === id)!;
      const long = resolvedLong.find((c) => c.id === id)!;
      expect(short.width).toBe(long.width);
      expect(short.fixedWidth).toBeDefined();
    }
    const remarksShort = resolvedShort.find((c) => c.id === 'remarks')!;
    const remarksLong = resolvedLong.find((c) => c.id === 'remarks')!;
    expect(remarksLong.width).toBeGreaterThan(remarksShort.width);
  });

  it('every column in PAYROLL_COLUMNS is resolved exactly once, in the same order — the one shared calculation every layer reuses', () => {
    const resolved = computeColumnWidths([makeEntry()], [testBank]);
    expect(resolved.map((c) => c.id)).toEqual(PAYROLL_COLUMNS.map((c) => c.id));
  });

  it('the grouped-header/body/totals shared template: gridTemplateColumns and totalGridWidth agree on the same resolved array', () => {
    const resolved = computeColumnWidths([makeEntry({ iban: 'PK36SCBL0000001123456702' })], [testBank]);
    const template = gridTemplateColumns(resolved);
    const tokens = template.split(' ');
    expect(tokens).toHaveLength(resolved.length);
    const summedFromTemplate = tokens.reduce((sum, token) => sum + Number(token.replace('px', '')), 0);
    expect(summedFromTemplate).toBe(totalGridWidth(resolved));
  });

  /**
   * Employee Identity Visibility (v1.0.1 Checkpoint 1, 2026-08-25) — Father Name/CNIC join the
   * frozen identity block. Same measurement discipline as the existing IBAN/Account Number tests
   * above: a column's width must reflect the longest loaded value across the full dataset.
   */
  it('Father Name column widens for a longer loaded value across the dataset', () => {
    const shortFather = makeEntry({ id: 'e1', employee: { ...makeEntry().employee, fatherName: 'Ali' } });
    const longFather = makeEntry({ id: 'e2', employee: { ...makeEntry().employee, fatherName: 'Muhammad Abdul Rehman Chaudhry' } });
    const resolved = computeColumnWidths([shortFather, longFather], []);
    const soloShort = computeColumnWidths([shortFather], []);
    const fatherColumn = resolved.find((c) => c.id === 'fatherName')!;
    const soloShortColumn = soloShort.find((c) => c.id === 'fatherName')!;
    expect(fatherColumn.width).toBeGreaterThan(soloShortColumn.width);
  });

  it('CNIC column reflects a real 13-digit value; a missing CNIC contributes nothing wider than the header', () => {
    const withCnic = makeEntry({ employee: { ...makeEntry().employee, cnic: '3520212345671' } });
    const withoutCnic = makeEntry({ employee: { ...makeEntry().employee, cnic: null } });
    const resolvedWith = computeColumnWidths([withCnic], []);
    const resolvedWithout = computeColumnWidths([withoutCnic], []);
    const cnicWith = resolvedWith.find((c) => c.id === 'cnic')!;
    const cnicWithout = resolvedWithout.find((c) => c.id === 'cnic')!;
    expect(cnicWith.width).toBeGreaterThanOrEqual(cnicWithout.width);
    expect(cnicWithout.width).toBeGreaterThan(0); // header "CNIC" still sizes the column
  });

  it('Father Name and CNIC are part of the frozen identity pane, positioned immediately after Code/Employee', () => {
    expect(FROZEN_LEFT_COLUMN_IDS).toEqual(['employeeCode', 'employeeName', 'fatherName', 'cnic']);
    const ids = PAYROLL_COLUMNS.map((c) => c.id);
    expect(ids.indexOf('fatherName')).toBe(ids.indexOf('employeeName') + 1);
    expect(ids.indexOf('cnic')).toBe(ids.indexOf('fatherName') + 1);
  });
});
