// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Bank } from '@/hooks/use-banks';
import type { Employee } from '@/hooks/use-employees';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { computeColumnWidths, gridTemplateColumns, stickyLeftOffsets } from './columns';
import { PayrollEntryRow } from './payroll-entry-row';
import { LiveTotalsStore } from './live-totals-store';

/**
 * Payroll Deputation Sync — "Apply current assignment" (2026-09-01 business decision). Covers the
 * frontend half of the approved design: the amber mismatch indicator on the `site` cell (shown for
 * *any* divergence between `entry.employee.siteId`/`unitId` and `entry.siteId`/its primary work
 * line's `unitId` — informational only, never implies a defect) and the "Apply current assignment"
 * row action, offered only for the one shape it's safe to touch automatically (single work line,
 * zero attendance) and never for a split allocation or one with attendance already recorded.
 *
 * Reuses `payroll-entry-row-actions.test.tsx`'s own fixture shape and Radix-DropdownMenu-in-jsdom
 * polyfills rather than redefining them, since this is the exact same `⋯` menu, one more item.
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

const apiRequestMock = vi.fn();

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return {
    ...actual,
    apiRequest: (...args: Parameters<typeof actual.apiRequest>) => apiRequestMock(...args),
  };
});

const SITE_A = { id: 'site-1', name: 'Site A', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' };
const SITE_B = { id: 'site-2', name: 'Site B', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' };
const UNIT_A = { id: 'unit-1', siteId: 'site-1', name: 'Unit A', code: 'BR-A', isActive: true, createdAt: '', updatedAt: '' };
const UNIT_B = { id: 'unit-2', siteId: 'site-2', name: 'Unit B', code: 'BR-B', isActive: true, createdAt: '', updatedAt: '' };

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'employee-1',
    employeeCode: 'V001',
    cnic: null,
    name: 'Deputation Test Employee',
    fatherName: null,
    religion: null,
    dateOfBirth: null,
    mobileNumber: null,
    designation: 'Guard',
    siteId: SITE_A.id,
    site: SITE_A,
    unitId: UNIT_A.id,
    unit: UNIT_A,
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
    siteId: SITE_A.id,
    site: SITE_A,
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
        siteId: SITE_A.id,
        unitId: UNIT_A.id,
        unit: UNIT_A,
        days: '0',
        otHours: '0',
        otRate: null,
        cycleDays: 30,
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      },
    ],
    calc: {
      workLines: [{ sortOrder: 0, dailyRate: '1000', effectiveOtRate: '0', earnedAmount: '0', otEarned: '0' }],
      totalWorkingDays: '0',
      effectiveLeaveRate: '0',
      earnedAmount: '0',
      otEarned: '0',
      leaveEarned: '0',
      correctionBalancePayable: '0',
      totalEarning: '0',
      eobiDeduction: '400',
      correctionBalanceRecovery: '0',
      totalDeduction: '400',
      netSalary: '-400',
    },
    ...overrides,
    employee,
  };
}

const testBank: Bank = { id: 'bank-1', code: 'HABIBMETRO', name: 'Habib Metropolitan Bank', isActive: true, isReferenced: true };

function renderRow(entry: PayrollEntry, opts: { cycleStatus?: string } = {}) {
  const resolved = computeColumnWidths([entry], [testBank]);
  const queryClient = new QueryClient();
  const onEditEmployee = vi.fn();
  const onMarkLeftEmployee = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <PayrollEntryRow
        entry={entry}
        rowIndex={0}
        cycleId="cycle-1"
        cycleStatus={opts.cycleStatus ?? 'DRAFT'}
        banks={[testBank]}
        liveTotalsStore={new LiveTotalsStore()}
        gridTemplateColumns={gridTemplateColumns(resolved)}
        identityOffsets={stickyLeftOffsets(resolved)}
        canEditEmployee={false}
        canMarkEmployeeLeft={true}
        onEditEmployee={onEditEmployee}
        onMarkLeftEmployee={onMarkLeftEmployee}
        style={{}}
      />
    </QueryClientProvider>,
  );
  return { onEditEmployee, onMarkLeftEmployee };
}

function openMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Employee actions for Deputation Test Employee' }), {
    button: 0,
  });
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  vi.restoreAllMocks();
});

describe('Payroll Deputation Sync — mismatch indicator and Apply current assignment', () => {
  it('shows no mismatch indicator when the entry already matches the employee’s current Site/Unit', () => {
    renderRow(makeEntry());
    expect(document.querySelector('[data-col-id="site"] .bg-amber-500')).toBeNull();
  });

  it('shows the amber mismatch indicator with a comparison tooltip when the employee has since transferred', () => {
    const entry = makeEntry({ employee: makeEmployee({ siteId: SITE_B.id, site: SITE_B, unitId: UNIT_B.id, unit: UNIT_B }) });
    renderRow(entry);
    const dot = document.querySelector('[data-col-id="site"] .bg-amber-500');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute('title')).toMatch(/Site A \/ BR-A/);
    expect(dot!.getAttribute('title')).toMatch(/Site B \/ BR-B/);
  });

  it('offers "Apply current assignment" for a simple single-line, zero-attendance mismatch, and submits it after confirmation', async () => {
    const entry = makeEntry({ employee: makeEmployee({ siteId: SITE_B.id, site: SITE_B, unitId: UNIT_B.id, unit: UNIT_B }) });
    apiRequestMock.mockResolvedValue({ entry: { ...entry, siteId: SITE_B.id, site: SITE_B, version: 2 } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderRow(entry);

    openMenu();
    const item = screen.getByRole('menuitem', { name: 'Apply current assignment' });
    fireEvent.click(item);

    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(1));
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/api/v1/payroll-entries/entry-1/apply-employee-assignment',
      expect.objectContaining({ method: 'POST', body: { version: 1 } }),
    );
  });

  it('does not submit when the confirmation dialog is declined', () => {
    const entry = makeEntry({ employee: makeEmployee({ siteId: SITE_B.id, site: SITE_B, unitId: UNIT_B.id, unit: UNIT_B }) });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderRow(entry);

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Apply current assignment' }));
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      '/api/v1/payroll-entries/entry-1/apply-employee-assignment',
      expect.anything(),
    );
  });

  it('never offers the action for a split entry (more than one work line) — the badge alone still shows', () => {
    const entry = makeEntry({
      employee: makeEmployee({ siteId: SITE_B.id, site: SITE_B, unitId: UNIT_B.id, unit: UNIT_B }),
      workLines: [
        {
          id: 'line-1',
          payrollEntryId: 'entry-1',
          siteId: SITE_A.id,
          unitId: UNIT_A.id,
          unit: UNIT_A,
          days: '0',
          otHours: '0',
          otRate: null,
          cycleDays: 30,
          sortOrder: 0,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'line-2',
          payrollEntryId: 'entry-1',
          siteId: SITE_A.id,
          unitId: 'unit-3',
          unit: { id: 'unit-3', siteId: SITE_A.id, name: 'Unit C', code: 'BR-C', isActive: true, createdAt: '', updatedAt: '' },
          days: '10',
          otHours: '0',
          otRate: null,
          cycleDays: 30,
          sortOrder: 1,
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    renderRow(entry);

    expect(document.querySelector('[data-col-id="site"] .bg-amber-500')).not.toBeNull();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Apply current assignment' })).toBeNull();
  });

  it('never offers the action when the sole work line already has attendance recorded', () => {
    const entry = makeEntry({
      employee: makeEmployee({ siteId: SITE_B.id, site: SITE_B, unitId: UNIT_B.id, unit: UNIT_B }),
      workLines: [
        {
          id: 'line-1',
          payrollEntryId: 'entry-1',
          siteId: SITE_A.id,
          unitId: UNIT_A.id,
          unit: UNIT_A,
          days: '15',
          otHours: '0',
          otRate: null,
          cycleDays: 30,
          sortOrder: 0,
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    renderRow(entry);

    expect(document.querySelector('[data-col-id="site"] .bg-amber-500')).not.toBeNull();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Apply current assignment' })).toBeNull();
  });

  it('never offers the action on a released entry, even with an otherwise-eligible mismatch', () => {
    const entry = makeEntry({
      employee: makeEmployee({ siteId: SITE_B.id, site: SITE_B, unitId: UNIT_B.id, unit: UNIT_B }),
      released: true,
    });
    renderRow(entry);

    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Apply current assignment' })).toBeNull();
  });

  it('never offers the action without the Payroll Entry operational permission, even with an eligible mismatch', () => {
    const entry = makeEntry({ employee: makeEmployee({ siteId: SITE_B.id, site: SITE_B, unitId: UNIT_B.id, unit: UNIT_B }) });
    const resolved = computeColumnWidths([entry], [testBank]);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <PayrollEntryRow
          entry={entry}
          rowIndex={0}
          cycleId="cycle-1"
          cycleStatus="DRAFT"
          banks={[testBank]}
          liveTotalsStore={new LiveTotalsStore()}
          gridTemplateColumns={gridTemplateColumns(resolved)}
          identityOffsets={stickyLeftOffsets(resolved)}
          canEditEmployee={true}
          canMarkEmployeeLeft={false}
          onEditEmployee={vi.fn()}
          onMarkLeftEmployee={vi.fn()}
          style={{}}
        />
      </QueryClientProvider>,
    );
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Apply current assignment' })).toBeNull();
    // The badge itself is still visible — it's informational, not permission-gated.
    expect(document.querySelector('[data-col-id="site"] .bg-amber-500')).not.toBeNull();
  });
});
