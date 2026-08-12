// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionUser } from '@payroll/shared';
import type { PayrollCycle } from '@/hooks/use-payroll-cycles';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';

/**
 * Payroll Entry usability checkpoint (2026-07-24), item 4 — "Payroll Data must never be
 * imported." These tests render the real `PayrollEntryPage` toolbar (every hook it reads is
 * mocked below to a fixed, already-resolved DRAFT cycle, so the toolbar renders without a real
 * backend) and assert directly on what a browser paints: no Import affordance exists anywhere,
 * while every export action Payroll Entry is still meant to offer (`Print`, `Export CSV`,
 * `Export Excel`) is present and enabled.
 */

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

vi.mock('@/hooks/use-selected-payroll-cycle', () => ({
  useSelectedPayrollCycle: () => ({
    cycleId: testCycle.id,
    cycle: testCycle,
    cycles: [testCycle],
    isLoading: false,
    error: undefined,
    selectCycle: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-payroll-cycles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-cycles')>();
  return {
    ...actual,
    useReconcileDraftCycleRoster: () => ({ mutate: vi.fn() }),
  };
});

// A controllable mock (default: empty, matching every existing test in this file below) — the
// Employee Row Actions integration suite (bottom of this file) overrides it per-test via
// `mockUsePayrollEntriesReturn.entries`, without touching any other describe block's behavior.
const mockUsePayrollEntriesReturn: { entries: PayrollEntry[] } = { entries: [] };
vi.mock('@/hooks/use-payroll-entries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-entries')>();
  return {
    ...actual,
    usePayrollEntries: () => ({ data: mockUsePayrollEntriesReturn.entries, isLoading: false, error: undefined }),
  };
});

vi.mock('@/hooks/use-banks', () => ({
  useBanks: () => ({ data: [], isLoading: false, error: undefined }),
}));

vi.mock('@/hooks/use-project-sites', () => ({
  useAccessibleProjectSites: () => ({ data: [], isLoading: false, error: undefined }),
}));

// Imported after the mocks above so the module graph resolves to the mocked hooks.
const { PayrollEntryPage } = await import('./payroll-entry-page');
const { payrollEntrySaveStatusStore } = await import('@/lib/payroll-entry-save-status-store');

const testUser: SessionUser = {
  id: 'user-1',
  name: 'Test Admin',
  email: 'admin@test.local',
  roleId: 'role-1',
  roleCode: 'MASTER_ADMIN',
  roleName: 'Master Admin',
  permissions: ['payroll:entry', 'payroll-cycle:manage', 'employees:edit'] as SessionUser['permissions'],
  siteIds: [],
  themeAccentColor: '#000000',
};

// A data router (not plain `<MemoryRouter>`/`<Routes>`) — required as of the Phase 7E navigation
// guard (A3): `PayrollEntryPage` now calls `useBlocker`, which throws outside a data router's
// context. `otherPath` gives the nav-guard tests below something to navigate *to* and assert
// against.
function renderPage(initialPath = `/payroll-cycles/${testCycle.id}/payroll-entry`) {
  const queryClient = new QueryClient();
  const router = createMemoryRouter(
    [
      { path: '/payroll-cycles/:cycleId/payroll-entry', element: <PayrollEntryPage user={testUser} /> },
      { path: '/other-page', element: <div>Other Page</div> },
    ],
    { initialEntries: [initialPath] },
  );
  return {
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

describe('Payroll Entry page — import removed, export preserved', () => {
  afterEach(() => cleanup());

  it('no longer renders "Download Import Template"', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /download import template/i })).toBeNull();
  });

  it('no longer renders an "Import" action', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /^import$/i })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('still renders working Export CSV and Export Excel actions', () => {
    renderPage();
    const exportCsv = screen.getByRole('button', { name: /export csv/i });
    const exportExcel = screen.getByRole('button', { name: /export excel/i });
    expect(exportCsv.hasAttribute('disabled')).toBe(false);
    expect(exportExcel.hasAttribute('disabled')).toBe(false);
  });
});

/**
 * Phase 7E durability checkpoint (A3, item 4) — the in-app navigation guard. Seeds
 * `payrollEntrySaveStatusStore` directly (the same store the real grid rows report into) rather
 * than driving actual keystrokes through the grid, since this page's own `entries` are mocked
 * empty above (Import-removal suite's concern, not this one's) — the guard itself only ever reads
 * the store, never the grid, so this is a faithful test of the exact code path `PayrollEntryPage`
 * runs.
 */
describe('Payroll Entry page — in-app navigation guard while unsaved (Phase 7E, A3)', () => {
  afterEach(() => {
    cleanup();
    payrollEntrySaveStatusStore.clear('nav-guard-entry', testCycle.id);
  });

  it('blocks navigating away while the cycle has unsaved work, and lets the user stay', async () => {
    payrollEntrySaveStatusStore.set('nav-guard-entry', testCycle.id, 'dirty');
    const { router } = renderPage();

    router.navigate('/other-page');
    const stayButton = await screen.findByRole('button', { name: /stay on this page/i });
    expect(screen.getByText(/unsaved changes/i)).not.toBeNull();

    stayButton.click();
    expect(screen.queryByText('Other Page')).toBeNull();
    expect(router.state.location.pathname).toBe(`/payroll-cycles/${testCycle.id}/payroll-entry`);
  });

  it('navigates away once the user confirms "Leave anyway"', async () => {
    payrollEntrySaveStatusStore.set('nav-guard-entry', testCycle.id, 'dirty');
    const { router } = renderPage();

    router.navigate('/other-page');
    const leaveButton = await screen.findByRole('button', { name: /leave anyway/i });
    leaveButton.click();

    await screen.findByText('Other Page');
    expect(router.state.location.pathname).toBe('/other-page');
  });

  it('never blocks navigation when everything is already saved', async () => {
    payrollEntrySaveStatusStore.clear('nav-guard-entry', testCycle.id);
    const { router } = renderPage();

    router.navigate('/other-page');

    await screen.findByText('Other Page');
    expect(screen.queryByText(/unsaved changes/i)).toBeNull();
  });
});

/**
 * Employee Row Actions (UAT 2026-08-11) — page-level integration. `payroll-entry-row-actions.test.tsx`
 * already covers the row's own menu behavior in isolation; these tests prove the page wires that
 * menu to the exact same shared `EmployeeFormModal`/`MarkLeftModal` Employee Registry itself
 * renders — same component, same field ids, populated with the selected row's own employee, one
 * instance at a time regardless of which row opened it — using the real Radix `DropdownMenu`
 * jsdom-interaction pattern already established in `reports-employee-payroll-history-page.test.tsx`.
 * The mutation/invalidation-targeting behavior itself (which cycle actually refreshes) needs a real
 * backend to verify meaningfully and is covered by Playwright instead (spec 27).
 */
describe('Payroll Entry page — Employee Row Actions (UAT 2026-08-11)', () => {
  // jsdom reports every element as 0×0 with no real `ResizeObserver`, so `@tanstack/react-virtual`
  // would otherwise compute an empty visible range and render zero body rows — the same jsdom
  // limitation `payroll-entry-grid.test.tsx` already documents and works around. Combined here with
  // the Radix `DropdownMenu` `pointerdown`/`PointerEvent` polyfills (`reports-employee-payroll-
  // history-page.test.tsx`'s own established pattern) since this suite needs both.
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
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 });
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ width: 1200, height: 800, top: 0, left: 0, bottom: 800, right: 1200, x: 0, y: 0, toJSON() {} }) as DOMRect;
  });

  function makeRowActionsEntry(): PayrollEntry {
    return {
      id: 'entry-row-actions-1',
      cycleId: testCycle.id,
      employeeId: 'employee-row-actions-1',
      employee: {
        id: 'employee-row-actions-1',
        employeeCode: 'V900',
        cnic: null,
        name: 'Row Actions Page Employee',
        fatherName: null,
        religion: null,
        dateOfBirth: null,
        mobileNumber: null,
        designation: 'Site Engineer',
        siteId: 'site-1',
        site: { id: 'site-1', name: 'Test Site', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
        unitId: 'unit-1',
        unit: { id: 'unit-1', siteId: 'site-1', name: 'Main Branch', code: null, isActive: true, createdAt: '', updatedAt: '' },
        dateOfJoining: null,
        dateOfLeaving: null,
        payType: 'DAILY_WAGE',
        grossPay: '45000',
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
      designation: 'Site Engineer',
      bankId: null,
      branchCode: null,
      accountNumber: null,
      iban: null,
      grossPay: '45000',
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
          id: 'line-row-actions-1',
          payrollEntryId: 'entry-row-actions-1',
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
        workLines: [{ sortOrder: 0, dailyRate: '1500', effectiveOtRate: '0', earnedAmount: '45000', otEarned: '0' }],
        effectiveLeaveRate: '0',
        earnedAmount: '45000',
        otEarned: '0',
        leaveEarned: '0',
        correctionBalancePayable: '0',
        totalEarning: '45000',
        eobiDeduction: '400',
        correctionBalanceRecovery: '0',
        totalDeduction: '400',
        netSalary: '44600',
      },
    };
  }

  afterEach(() => {
    cleanup();
    mockUsePayrollEntriesReturn.entries = [];
  });

  it('Edit Employee opens the same shared EmployeeFormModal, pre-populated with the selected row\'s employee', () => {
    mockUsePayrollEntriesReturn.entries = [makeRowActionsEntry()];
    renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Employee actions for Row Actions Page Employee' }), {
      button: 0,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Employee' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Edit Employee', { exact: true })).toBeTruthy();
    // Same field ids as Employee Registry's own modal (`employee-form-modal.tsx`) — proof it's the
    // one shared component, not a second implementation — populated from this row's own employee.
    expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('Row Actions Page Employee');
    expect((screen.getByLabelText('Employee code') as HTMLInputElement).value).toBe('V900');
    expect((screen.getByLabelText('Designation') as HTMLInputElement).value).toBe('Site Engineer');
  });

  it('Mark as Left opens the same shared MarkLeftModal for the selected row\'s employee', () => {
    mockUsePayrollEntriesReturn.entries = [makeRowActionsEntry()];
    renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Employee actions for Row Actions Page Employee' }), {
      button: 0,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as Left' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Mark Employee as Left', { exact: true })).toBeTruthy();
    expect(within(dialog).getByText('Row Actions Page Employee')).toBeTruthy();
  });

  /** Renders `PayrollEntryPage` directly for a given user (bypassing `App.tsx`'s own
   * `RequirePermission` route guard, exactly like the "no `⋯` trigger" test already did) — an
   * isolated check of the row menu's own RBAC-split logic, independent of whether the real router
   * would ever admit that exact permission combination to this page at all. */
  function renderPageForUser(user: SessionUser) {
    const queryClient = new QueryClient();
    const router = createMemoryRouter(
      [{ path: '/payroll-cycles/:cycleId/payroll-entry', element: <PayrollEntryPage user={user} /> }],
      { initialEntries: [`/payroll-cycles/${testCycle.id}/payroll-entry`] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  it('Payroll Entry permission only: the trigger renders with Mark as Left offered and Edit Employee absent', () => {
    mockUsePayrollEntriesReturn.entries = [makeRowActionsEntry()];
    const peOnlyUser: SessionUser = {
      ...testUser,
      permissions: ['payroll:entry', 'payroll-cycle:manage'] as SessionUser['permissions'],
    };
    renderPageForUser(peOnlyUser);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Employee actions for Row Actions Page Employee' }), {
      button: 0,
    });
    expect(screen.getByRole('menuitem', { name: 'Mark as Left' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Edit Employee' })).toBeNull();
  });

  it('employees:edit only (no payroll:entry): the trigger renders with Edit Employee offered and Mark as Left absent — employees:edit alone must never grant Mark as Left', () => {
    mockUsePayrollEntriesReturn.entries = [makeRowActionsEntry()];
    const editOnlyUser: SessionUser = {
      ...testUser,
      permissions: ['employees:edit'] as SessionUser['permissions'],
    };
    renderPageForUser(editOnlyUser);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Employee actions for Row Actions Page Employee' }), {
      button: 0,
    });
    expect(screen.getByRole('menuitem', { name: 'Edit Employee' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Mark as Left' })).toBeNull();
  });

  it('both employees:edit and payroll:entry: the trigger renders with both Edit Employee and Mark as Left offered', () => {
    mockUsePayrollEntriesReturn.entries = [makeRowActionsEntry()];
    const bothUser: SessionUser = {
      ...testUser,
      permissions: ['employees:edit', 'payroll:entry'] as SessionUser['permissions'],
    };
    renderPageForUser(bothUser);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Employee actions for Row Actions Page Employee' }), {
      button: 0,
    });
    expect(screen.getByRole('menuitem', { name: 'Edit Employee' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Mark as Left' })).toBeTruthy();
  });

  it('renders no `⋯` trigger anywhere on the page when the user holds neither employees:edit nor payroll:entry', () => {
    mockUsePayrollEntriesReturn.entries = [makeRowActionsEntry()];
    const neitherUser: SessionUser = {
      ...testUser,
      permissions: ['payroll-cycle:manage'] as SessionUser['permissions'],
    };
    renderPageForUser(neitherUser);

    expect(screen.queryByRole('button', { name: /Employee actions for/ })).toBeNull();
  });
});
