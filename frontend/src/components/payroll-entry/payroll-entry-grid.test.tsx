// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Bank } from '@/hooks/use-banks';
import type { PayrollCycle } from '@/hooks/use-payroll-cycles';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { PayrollEntryGrid } from './payroll-entry-grid';

// jsdom reports every element as 0×0 and has no real ResizeObserver, so `@tanstack/react-virtual`
// (which sizes its visible window from the scroll container's measured height) would otherwise
// compute an empty virtual range and render zero body rows — a jsdom limitation, not a real
// application behavior. Stubbing a non-zero `clientHeight`/`getBoundingClientRect` and a no-op
// `ResizeObserver` is the standard workaround so these tests can assert on actually-rendered rows.
beforeAll(() => {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = MockResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 1200, height: 800, top: 0, left: 0, bottom: 800, right: 1200, x: 0, y: 0, toJSON() {} }) as DOMRect;
});

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
      unitId: 'unit-live',
      // Deliberately a *different* code than any work line's own `unit.code` below — proves the
      // grid's Branch Code column reads each entry's own work-line `unit`, never the employee's
      // current live default unit (which would silently rewrite a released entry's history).
      unit: { id: 'unit-live', siteId: 'site-1', name: 'Current Live Branch', code: 'LIVE-CODE', isActive: true, createdAt: '', updatedAt: '' },
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

const testCycle: PayrollCycle = {
  id: 'cycle-1',
  year: 2026,
  month: 7,
  status: 'DRAFT',
  sourceCycleId: null,
  createdAt: '',
  createdBy: 'user-1',
  releasedAt: null,
  releasedBy: null,
  archivedAt: null,
  archivedBy: null,
  isCurrentDraft: true,
};

const testBank: Bank = { id: 'bank-1', code: 'HABIBMETRO', name: 'Habib Metropolitan Bank', isActive: true, isReferenced: true };

function employeeNamesInOrder(): string[] {
  return screen.getAllByRole('row').map((row) => within(row).queryByText(/Employee /)?.textContent ?? '').filter(Boolean);
}

function renderGrid(entries: PayrollEntry[]) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <PayrollEntryGrid
        cycle={testCycle}
        entries={entries}
        banks={[testBank]}
        canCorrect={false}
        onCreateCorrection={() => {}}
        onViewCorrectionHistory={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe('PayrollEntryGrid — sortable columns (Payroll Entry usability checkpoint, 2026-07-24)', () => {
  afterEach(() => cleanup());

  it('shows a visible, correctly-populated Deputed Branch column sourced from each entry’s own work line, for Draft rows', () => {
    const entry = makeEntry({ id: '1', employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee One' } });
    renderGrid([entry]);

    const header = screen.getByRole('columnheader', { name: /deputed branch/i });
    expect(header).toBeTruthy();

    const unitCodeCells = document.querySelectorAll('[data-col-id="unitCode"]');
    // One header cell + one body cell for the single rendered row.
    const bodyCell = Array.from(unitCodeCells).find((el) => el.textContent === 'BR-01');
    expect(bodyCell).toBeTruthy();
    // Never the employee's own current default unit code ("LIVE-CODE") — that would be the wrong,
    // historically-incorrect source for a released/archived entry.
    expect(Array.from(unitCodeCells).some((el) => el.textContent === 'LIVE-CODE')).toBe(false);
  });

  it('preserves a released entry’s own historical work-line Deputed Branch code, distinct from the employee’s current unit', () => {
    const released = makeEntry({
      id: '1',
      released: true,
      releasedAt: '2026-07-01T00:00:00.000Z',
      employee: { ...makeEntry({ id: '1' }).employee, name: 'Released Employee' },
    });
    renderGrid([released]);

    const unitCodeCells = Array.from(document.querySelectorAll('[data-col-id="unitCode"]'));
    expect(unitCodeCells.some((el) => el.textContent === 'BR-01')).toBe(true);
  });

  it('clicking the Employee header sorts full rows A→Z, then Z→A on a second click — never individual cells', () => {
    const alice = makeEntry({ id: '1', employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee Alice' } });
    const charlie = makeEntry({ id: '2', employee: { ...makeEntry({ id: '2' }).employee, name: 'Employee Charlie' } });
    const bob = makeEntry({ id: '3', employee: { ...makeEntry({ id: '3' }).employee, name: 'Employee Bob' } });
    renderGrid([charlie, alice, bob]);

    const header = within(screen.getByRole('columnheader', { name: 'Employee' })).getByRole('button');
    fireEvent.click(header);
    expect(employeeNamesInOrder()).toEqual(['Employee Alice', 'Employee Bob', 'Employee Charlie']);

    fireEvent.click(header);
    expect(employeeNamesInOrder()).toEqual(['Employee Charlie', 'Employee Bob', 'Employee Alice']);
  });

  it('sorting never changes the totals row — it still represents the full filtered dataset regardless of display order', () => {
    const one = makeEntry({ id: '1', grossPay: '10000', employee: { ...makeEntry({ id: '1' }).employee, name: 'Zed' } });
    const two = makeEntry({ id: '2', grossPay: '20000', employee: { ...makeEntry({ id: '2' }).employee, name: 'Anna' } });
    renderGrid([one, two]);

    const grossPayCellsBefore = document.querySelectorAll('[data-col-id="grossPay"]');
    const totalsGrossBefore = grossPayCellsBefore[grossPayCellsBefore.length - 1]?.textContent;

    const header = within(screen.getByRole('columnheader', { name: 'Employee' })).getByRole('button');
    fireEvent.click(header);

    const grossPayCellsAfter = document.querySelectorAll('[data-col-id="grossPay"]');
    const totalsGrossAfter = grossPayCellsAfter[grossPayCellsAfter.length - 1]?.textContent;
    expect(totalsGrossAfter).toBe(totalsGrossBefore);
    // Sanity check the total is actually the sum, not a coincidental match (e.g. both empty).
    expect(totalsGrossAfter).toBe('PKR 30,000.00');
  });
});
