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
      <PayrollEntryGrid cycle={testCycle} entries={entries} banks={[testBank]} />
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

describe('PayrollEntryGrid — sticky header containment (Post-Checkpoint-1A UAT Stabilization)', () => {
  afterEach(() => cleanup());

  /**
   * Root cause of the reported "sticky header reveals a blank/underlying strip while scrolling":
   * each virtualized row was fully transparent (`background-color: rgba(0,0,0,0)`), relying
   * entirely on the ancestor Card's own incidental white background rather than painting its own
   * opaque surface — a real robustness gap for a row sharing screen space with the grid's sticky
   * header/totals rows during scroll compositing. Every row must now be its own explicit, opaque
   * paint surface (`bg-surface-2`), regardless of what's behind it.
   */
  it('every body row has an explicit opaque background — never relying on an ancestor to happen to be white', () => {
    const entry = makeEntry({ id: '1', employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee One' } });
    renderGrid([entry]);

    const row = screen.getByRole('row', { name: /Employee One/ });
    expect(row.className).toMatch(/\bbg-surface-2\b/);
  });

  it('the sticky group-header and column-header rows both carry an opaque background and elevated z-index above body rows', () => {
    const entry = makeEntry({ id: '1' });
    renderGrid([entry]);

    // The group-label row ("BANK DETAILS" etc.) and the column-header row ("#", "STATUS", ...) —
    // both directly sticky, both directly opaque (the totals row is sticky too, but its own
    // opaque `bg-surface` lives on its child `PayrollEntryTotalsRow`, not this outer wrapper, so
    // it's deliberately excluded from this direct-class assertion).
    const columnHeaderRow = screen.getByRole('columnheader', { name: 'Employee' }).closest('[role="row"]')!;
    expect(columnHeaderRow.className).toMatch(/\bsticky\b/);
    expect(columnHeaderRow.className).toMatch(/\bbg-surface\b/);
    expect(columnHeaderRow.className).toMatch(/\bz-20\b/);

    const groupHeaderRow = columnHeaderRow.previousElementSibling!;
    expect(groupHeaderRow.className).toMatch(/\bsticky\b/);
    expect(groupHeaderRow.className).toMatch(/\bbg-surface\b/);
    expect(groupHeaderRow.className).toMatch(/\bz-20\b/);
  });
});

describe('PayrollEntryGrid — EOBI footer total (Post-Checkpoint-1A UAT Stabilization)', () => {
  afterEach(() => cleanup());

  function eobiFooterTotal(): string | null {
    const cells = document.querySelectorAll('[data-col-id="eobiAmount"]');
    return cells[cells.length - 1]?.textContent ?? null;
  }

  it('excludes a disabled row entirely — the footer must never sum raw eobiAmount regardless of eobiApplicable', () => {
    const disabled = makeEntry({
      id: '1',
      eobiAmount: '400',
      eobiApplicable: false,
      employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee Disabled' },
    });
    renderGrid([disabled]);

    expect(eobiFooterTotal()).toBe('PKR 0.00');
  });

  it('includes every enabled row at its own configured amount', () => {
    const enabled = makeEntry({
      id: '1',
      eobiAmount: '400',
      eobiApplicable: true,
      employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee Enabled' },
    });
    renderGrid([enabled]);

    expect(eobiFooterTotal()).toBe('PKR 400.00');
  });

  it('mixed applicable/non-applicable rows — only the enabled rows contribute to the total', () => {
    const enabledA = makeEntry({
      id: '1',
      eobiAmount: '400',
      eobiApplicable: true,
      employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee A' },
    });
    const disabled = makeEntry({
      id: '2',
      eobiAmount: '400',
      eobiApplicable: false,
      employee: { ...makeEntry({ id: '2' }).employee, name: 'Employee B' },
    });
    const enabledC = makeEntry({
      id: '3',
      eobiAmount: '550',
      eobiApplicable: true,
      employee: { ...makeEntry({ id: '3' }).employee, name: 'Employee C' },
    });
    renderGrid([enabledA, disabled, enabledC]);

    // 400 + 550, the disabled row's own 400 excluded entirely — never 1,350.
    expect(eobiFooterTotal()).toBe('PKR 950.00');
  });
});

describe('PayrollEntryGrid — Status column header alignment (Presentation & Workflow Stabilization Checkpoint, 2026-07-25)', () => {
  afterEach(() => cleanup());

  /**
   * Root cause of the reported "STATUS misaligned" defect: the header row applied no per-column
   * text alignment at all, so a center-aligned column's header label always rendered left-aligned
   * regardless of what its body cells did — the header and body were never sharing one alignment
   * decision. The header must now derive its own alignment from `PAYROLL_COLUMNS`' own `align`
   * field (the same field the column's body cells are centered per), via `data-col-id`, not via a
   * one-off Status-only class.
   */
  it('the Status column header is centered, matching the canonical center-align of the Status column definition', () => {
    const entry = makeEntry({ id: '1' });
    renderGrid([entry]);

    const header = document.querySelector('[data-col-id="status"][role="columnheader"]') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.className).toMatch(/\btext-center\b/);
  });

  it('a non-center-aligned header (Employee) does not get the center-alignment class', () => {
    const entry = makeEntry({ id: '1' });
    renderGrid([entry]);

    const header = document.querySelector('[data-col-id="employeeName"][role="columnheader"]') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.className).not.toMatch(/\btext-center\b/);
  });
});
