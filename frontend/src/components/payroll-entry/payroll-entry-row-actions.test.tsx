// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Bank } from '@/hooks/use-banks';
import type { Employee } from '@/hooks/use-employees';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { PAYROLL_COLUMNS, computeColumnWidths, gridTemplateColumns } from './columns';
import { PayrollEntryRow } from './payroll-entry-row';
import { LiveTotalsStore } from './live-totals-store';

/**
 * Employee Row Actions (UAT 2026-08-11, RBAC-split revision) — the row's `⋯` overflow menu.
 * Verifies the frozen placement (far right, after `netSalary`, never before `employeeCode`),
 * independent permission gating for each item (`canEditEmployee` for Edit Employee,
 * `canMarkEmployeeLeft` for Mark as Left — no trigger at all when both are false, never a
 * visible-but-dead action for whichever one the caller lacks), and that selecting a menu item calls
 * back with this row's own `entry.employee` — the exact same `Employee` shape
 * `EmployeeFormModal`/`MarkLeftModal` already consume, proving no second, row-local employee
 * representation exists.
 *
 * Interacts with the real Radix `DropdownMenu` (not a mock) using the same jsdom-polyfill +
 * `pointerdown`-to-open pattern already established and documented in
 * `reports-employee-payroll-history-page.test.tsx` for the Site filter's own `DropdownMenu` — a
 * plain `fireEvent.click` on the trigger never opens a Radix dropdown in jsdom.
 */

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!window.PointerEvent) {
    window.PointerEvent = MouseEvent as unknown as typeof PointerEvent;
  }
});

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'employee-1',
    employeeCode: 'V001',
    cnic: null,
    name: 'Row Actions Test Employee',
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
    ...overrides,
  };
}

function makeEntry(overrides: Partial<PayrollEntry> = {}): PayrollEntry {
  const employee = makeEmployee(overrides.employee);
  return {
    id: 'entry-1',
    cycleId: 'cycle-1',
    employeeId: employee.id,
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
    employee,
  };
}

const testBank: Bank = { id: 'bank-1', code: 'HABIBMETRO', name: 'Habib Metropolitan Bank', isActive: true, isReferenced: true };

function renderRow(opts: {
  entry?: PayrollEntry;
  canEditEmployee?: boolean;
  canMarkEmployeeLeft?: boolean;
  onEditEmployee?: (employee: Employee) => void;
  onMarkLeftEmployee?: (employee: Employee) => void;
} = {}) {
  const entry = opts.entry ?? makeEntry();
  const resolved = computeColumnWidths([entry], [testBank]);
  const queryClient = new QueryClient();
  const onEditEmployee = opts.onEditEmployee ?? vi.fn();
  const onMarkLeftEmployee = opts.onMarkLeftEmployee ?? vi.fn();
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <PayrollEntryRow
        entry={entry}
        rowIndex={0}
        cycleId="cycle-1"
        cycleStatus="DRAFT"
        banks={[testBank]}
        liveTotalsStore={new LiveTotalsStore()}
        gridTemplateColumns={gridTemplateColumns(resolved)}
        canEditEmployee={opts.canEditEmployee ?? true}
        canMarkEmployeeLeft={opts.canMarkEmployeeLeft ?? true}
        onEditEmployee={onEditEmployee}
        onMarkLeftEmployee={onMarkLeftEmployee}
        style={{}}
      />
    </QueryClientProvider>,
  );
  return { entry, onEditEmployee, onMarkLeftEmployee, container: rendered.container };
}

function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0 });
}

afterEach(() => cleanup());

describe('Payroll Entry row — employee actions `⋯` menu (UAT 2026-08-11)', () => {
  it('is the last (far-right) data column — never before employeeCode', () => {
    // `actions` must be the final entry in the canonical column order, matching the frozen UX
    // placement decision, and the last entry ever appended.
    expect(PAYROLL_COLUMNS[PAYROLL_COLUMNS.length - 1]!.id).toBe('actions');
  });

  it('renders the accessible trigger at the far right, with no action control in the employeeCode cell', () => {
    const { container } = renderRow();
    const trigger = screen.getByRole('button', { name: 'Employee actions for Row Actions Test Employee' });
    expect(trigger).toBeTruthy();

    const actionsCell = trigger.closest('[data-col-id="actions"]');
    expect(actionsCell).toBeTruthy();

    // The last `[data-col-id]` cell in DOM order is the actions cell — proving right-edge
    // placement mechanically, not just "a trigger exists somewhere."
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-col-id]'));
    expect(cells[cells.length - 1]!.getAttribute('data-col-id')).toBe('actions');

    // Employee Code — the left-side scanning anchor — carries no action trigger of any kind.
    const codeCell = container.querySelector<HTMLElement>('[data-col-id="employeeCode"]')!;
    expect(within(codeCell).queryByRole('button')).toBeNull();
  });

  it('renders no `⋯` trigger at all when the caller has neither employees:edit nor the Payroll Entry operational permission', () => {
    renderRow({ canEditEmployee: false, canMarkEmployeeLeft: false });
    expect(screen.queryByRole('button', { name: /Employee actions for/ })).toBeNull();
  });

  it('opening the menu offers Edit Employee and Mark as Left, and selecting each calls back with this row\'s own entry.employee', () => {
    const { entry, onEditEmployee, onMarkLeftEmployee } = renderRow();

    openMenu('Employee actions for Row Actions Test Employee');
    expect(screen.getByRole('menuitem', { name: 'Edit Employee' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Mark as Left' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Employee' }));
    expect(onEditEmployee).toHaveBeenCalledTimes(1);
    expect(onEditEmployee).toHaveBeenCalledWith(entry.employee);
    expect(onMarkLeftEmployee).not.toHaveBeenCalled();

    openMenu('Employee actions for Row Actions Test Employee');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as Left' }));
    expect(onMarkLeftEmployee).toHaveBeenCalledTimes(1);
    expect(onMarkLeftEmployee).toHaveBeenCalledWith(entry.employee);
  });

  it('hides Mark as Left (keeps Edit Employee) once the employee already has a dateOfLeaving', () => {
    const entry = makeEntry({ employee: makeEmployee({ dateOfLeaving: '2026-01-15' }) });
    renderRow({ entry });

    openMenu('Employee actions for Row Actions Test Employee');
    expect(screen.getByRole('menuitem', { name: 'Edit Employee' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Mark as Left' })).toBeNull();
  });

  describe('RBAC-split menu matrix (Payroll Entry Row Actions checkpoint)', () => {
    it('Payroll Entry operational permission only: trigger renders, Mark as Left is offered, Edit Employee is not', () => {
      renderRow({ canEditEmployee: false, canMarkEmployeeLeft: true });

      openMenu('Employee actions for Row Actions Test Employee');
      expect(screen.getByRole('menuitem', { name: 'Mark as Left' })).toBeTruthy();
      expect(screen.queryByRole('menuitem', { name: 'Edit Employee' })).toBeNull();
    });

    it('employees:edit only: trigger renders, Edit Employee is offered, Mark as Left is not', () => {
      renderRow({ canEditEmployee: true, canMarkEmployeeLeft: false });

      openMenu('Employee actions for Row Actions Test Employee');
      expect(screen.getByRole('menuitem', { name: 'Edit Employee' })).toBeTruthy();
      expect(screen.queryByRole('menuitem', { name: 'Mark as Left' })).toBeNull();
    });

    it('both permissions: both menu items are offered', () => {
      renderRow({ canEditEmployee: true, canMarkEmployeeLeft: true });

      openMenu('Employee actions for Row Actions Test Employee');
      expect(screen.getByRole('menuitem', { name: 'Edit Employee' })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: 'Mark as Left' })).toBeTruthy();
    });
  });

  it('the actions cell is the one documented sticky-right column, with an opaque background matching the row', () => {
    const { container } = renderRow();
    const actionsCell = container.querySelector('[data-col-id="actions"]')!;
    expect(actionsCell.className).toMatch(/\bsticky\b/);
    expect(actionsCell.className).toMatch(/\bright-0\b/);
    expect(actionsCell.className).toMatch(/\bbg-surface-2\b/);
  });
});
