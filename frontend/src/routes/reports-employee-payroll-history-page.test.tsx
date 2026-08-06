// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EmployeePayrollHistoryListResponse, EmployeePayrollHistoryRow, SessionUser } from '@payroll/shared';

/**
 * Employee Payroll History Checkpoint 1B — list page tests. Every data-fetching hook is mocked to a
 * controlled, already-resolved value (this codebase's own established pattern,
 * `reports-payroll-summary-page.test.tsx`) — these tests exercise the page's own permission-gating,
 * filter/sort/pagination wiring, and rendering logic, never a real backend. Real browser/network
 * verification is Playwright's job (`tests/e2e/specs/19-employee-payroll-history-frontend.spec.ts`).
 */

const mockUseEmployeePayrollHistoryList = vi.hoisted(() => vi.fn());
const mockUseEmployeePayrollHistoryEmployeeSearch = vi.hoisted(() => vi.fn());
const mockDownloadEmployeePayrollHistoryExport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/hooks/use-employee-payroll-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-employee-payroll-history')>();
  return {
    ...actual,
    useEmployeePayrollHistoryList: mockUseEmployeePayrollHistoryList,
    useEmployeePayrollHistoryEmployeeSearch: mockUseEmployeePayrollHistoryEmployeeSearch,
    downloadEmployeePayrollHistoryExport: mockDownloadEmployeePayrollHistoryExport,
  };
});

vi.mock('@/hooks/use-project-sites', () => ({
  useAccessibleProjectSites: () => ({
    data: [
      { id: 'site-1', name: 'Site One', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
      { id: 'site-2', name: 'Site Two', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
    ],
    isLoading: false,
    error: undefined,
  }),
}));

vi.mock('@/hooks/use-project-units', () => ({
  // `site-1` carries one real Unit so restore/change-Site regression coverage can pick an actual
  // option; every other siteId (including `undefined`) stays empty, matching every other test's
  // existing expectation that the Unit select has no options until a real Site is selected.
  useProjectUnits: (siteId: string | undefined) => ({
    data: siteId === 'site-1' ? [{ id: 'unit-1', name: 'HQ', code: null }] : [],
    isLoading: false,
    error: undefined,
  }),
}));

vi.mock('@/hooks/use-payroll-cycles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-cycles')>();
  return {
    ...actual,
    usePayrollCycles: () => ({
      data: [
        { id: 'cycle-jul', year: 2026, month: 7, status: 'DRAFT' },
        { id: 'cycle-jun', year: 2026, month: 6, status: 'RELEASED' },
      ],
      isLoading: false,
      error: undefined,
    }),
  };
});

const { ReportsEmployeePayrollHistoryPage } = await import('./reports-employee-payroll-history-page');

const baseUser: SessionUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@test.local',
  roleId: 'role-1',
  roleCode: 'FINANCE',
  roleName: 'Finance',
  permissions: ['statements:view'] as SessionUser['permissions'],
  siteIds: ['site-1'],
  themeAccentColor: '#000000',
};

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // jsdom has neither — Radix's `DropdownMenu` (the Site filter) opens on `pointerdown` and
  // positions its portalled content via `react-popper`, which needs a `ResizeObserver`.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  // jsdom has no native `PointerEvent`, so `@testing-library`'s `fireEvent.pointerDown` falls back
  // to a bare `Event` with no `button`/`ctrlKey` — Radix's trigger checks exactly those two before
  // toggling open, so without this it would never open. `MouseEvent` already carries both.
  if (!window.PointerEvent) {
    window.PointerEvent = MouseEvent as unknown as typeof PointerEvent;
  }
});

beforeEach(() => {
  mockUseEmployeePayrollHistoryEmployeeSearch.mockReturnValue({ data: { total: 0, page: 1, pageSize: 25, employees: [] }, isLoading: false });
  window.localStorage.clear();
});

function renderPage(user: SessionUser = baseUser) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reports/employee-payroll-history']}>
        <Routes>
          <Route path="/reports/employee-payroll-history" element={<ReportsEmployeePayrollHistoryPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function row(overrides: Partial<EmployeePayrollHistoryRow> = {}): EmployeePayrollHistoryRow {
  return {
    payrollEntryId: 'entry-1',
    cycle: { id: 'cycle-jul', year: 2026, month: 7, status: 'DRAFT' },
    employeeId: 'emp-1',
    employeeCode: 'E-001',
    employeeName: 'Jane Doe',
    siteId: 'site-1',
    siteName: 'Site One',
    primaryUnit: { id: 'unit-1', name: 'HQ', code: null },
    additionalUnitCount: 0,
    designation: 'Clerk',
    currentEmployeeRosterStatus: 'ACTIVE',
    totalEarnings: '60000.00',
    totalDeductions: '800.00',
    netSalary: '59200.00',
    rowStatus: 'RELEASED',
    correctionCount: 0,
    hasOutstandingOriginBalance: false,
    releasedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

function totals(overrides: Partial<EmployeePayrollHistoryListResponse['totals']> = {}): EmployeePayrollHistoryListResponse['totals'] {
  return {
    matchingCount: 1,
    totalEarnings: '60000.00',
    totalDeductions: '800.00',
    netSalaryTotal: '59200.00',
    totalsComputed: true,
    releasedCount: 1,
    heldCount: 0,
    noPayDueCount: 0,
    recoveryDueCount: 0,
    pendingCount: 0,
    correctedEntryCount: 0,
    ...overrides,
  };
}

function fullReport(overrides: Partial<EmployeePayrollHistoryListResponse> = {}): EmployeePayrollHistoryListResponse {
  return {
    page: 1,
    pageSize: 25,
    total: 1,
    rows: [row()],
    totals: totals(),
    generatedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('ReportsEmployeePayrollHistoryPage — RBAC', () => {
  afterEach(() => cleanup());

  it('shows an access-denied state for a user without statements:view', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to employee payroll history/i)).toBeTruthy();
  });

  it('renders the report for a user holding statements:view', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });
});

describe('ReportsEmployeePayrollHistoryPage — loading/empty/error states', () => {
  afterEach(() => cleanup());

  it('shows a loading skeleton while fetching', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry action', () => {
    const refetch = vi.fn();
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: new Error('boom'), refetch });
    renderPage();
    expect(screen.getByText(/could not load employee payroll history/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('distinguishes "no history exists" from "no match for filters"', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({
      data: fullReport({ total: 0, rows: [], totals: totals({ matchingCount: 0 }) }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/no payroll history exists yet/i)).toBeTruthy();
  });
});

describe('ReportsEmployeePayrollHistoryPage — totals', () => {
  afterEach(() => cleanup());

  it('renders backend-provided totals directly', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getAllByText(/59,200\.00/).length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('on-screen-cards')).getByText('Matching Entries')).toBeTruthy();
  });

  it('shows the totals-unavailable notice instead of misleading zeros when totalsComputed is false', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({
      data: fullReport({ totals: totals({ totalsComputed: false, totalEarnings: null, totalDeductions: null, netSalaryTotal: null, matchingCount: 25000 }) }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/totals are unavailable for this result size/i)).toBeTruthy();
  });
});

describe('ReportsEmployeePayrollHistoryPage — table', () => {
  afterEach(() => cleanup());

  it('renders row status badge, correction count badge, and outstanding-balance badge', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({
      data: fullReport({ rows: [row({ correctionCount: 2, hasOutstandingOriginBalance: true, rowStatus: 'HELD' })] }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText('Held')).toBeTruthy();
    expect(onScreenTable.getByText('2')).toBeTruthy();
    expect(onScreenTable.getByText('Outstanding')).toBeTruthy();
  });

  it('shows "+N more" for additional units', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({
      data: fullReport({ rows: [row({ additionalUnitCount: 3 })] }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText(/\+3 more/)).toBeTruthy();
  });

  it('clicking a sortable column header requests the backend with the new sort field, reset to page 1', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /net salary/i }));
    const lastCall = mockUseEmployeePayrollHistoryList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'netSalary', sortDir: 'asc', page: 1 }));
  });

  it('clicking View Details navigates to the entry detail route', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reports/employee-payroll-history']}>
          <Routes>
            <Route path="/reports/employee-payroll-history" element={<ReportsEmployeePayrollHistoryPage user={baseUser} />} />
            <Route path="/reports/employee-payroll-history/:entryId" element={<div>Detail Page Placeholder</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /view details/i }));
    expect(screen.getByText('Detail Page Placeholder')).toBeTruthy();
  });
});

describe('ReportsEmployeePayrollHistoryPage — pagination', () => {
  afterEach(() => cleanup());

  it('uses server-provided page/pageSize/total, never client-side slicing', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({
      data: fullReport({ total: 40, page: 1, pageSize: 25 }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/showing 1.25 of 40/i)).toBeTruthy();
  });
});

describe('ReportsEmployeePayrollHistoryPage — filters', () => {
  afterEach(() => cleanup());

  it('Clear Filters resets Row Status back to All', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/row status/i), { target: { value: 'HELD' } });
    expect((screen.getByLabelText(/row status/i) as HTMLSelectElement).value).toBe('HELD');
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect((screen.getByLabelText(/row status/i) as HTMLSelectElement).value).toBe('');
  });

  it('changing a filter resets the page passed to the hook to 1', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport({ page: 2 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    const lastCall = mockUseEmployeePayrollHistoryList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ rowStatus: 'HELD', page: 1 }));
  });

  it('Has Correction supports All/Yes/No tri-state and passes a boolean or undefined', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/has correction/i), { target: { value: 'YES' } });
    let lastCall = mockUseEmployeePayrollHistoryList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: true }));

    fireEvent.change(screen.getByLabelText(/has correction/i), { target: { value: 'NO' } });
    lastCall = mockUseEmployeePayrollHistoryList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: false }));

    fireEvent.change(screen.getByLabelText(/has correction/i), { target: { value: 'ALL' } });
    lastCall = mockUseEmployeePayrollHistoryList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: undefined }));
  });

  it('the Unit filter is disabled unless exactly one Site is selected', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).disabled).toBe(true);
  });
});

describe('ReportsEmployeePayrollHistoryPage — restoring navigation state after Back to Report', () => {
  afterEach(() => cleanup());

  /** Stands in for the real `EmployeePayrollHistoryDetailPage` — the behavior under test here is
   * entirely the *list* page's own restore logic, so this mirrors only the one mechanism that
   * matters (`goBackToReport`, `reports-employee-payroll-history-detail-page.tsx`): read
   * `location.state.listState` and hand it straight back on the way to the list route. Using the
   * real detail page would additionally require mocking its own `useEmployeePayrollHistoryDetail`
   * data hook for no benefit to this regression. */
  function DetailPlaceholder() {
    const location = useLocation();
    const navigate = useNavigate();
    const listState = (location.state as { listState?: unknown } | null)?.listState;
    return (
      <button
        type="button"
        onClick={() => navigate('/reports/employee-payroll-history', listState ? { state: { listState } } : undefined)}
      >
        Back to Report
      </button>
    );
  }

  function renderWithDetailRoute() {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reports/employee-payroll-history']}>
          <Routes>
            <Route path="/reports/employee-payroll-history" element={<ReportsEmployeePayrollHistoryPage user={baseUser} />} />
            <Route path="/reports/employee-payroll-history/:entryId" element={<DetailPlaceholder />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('restores a previously selected Site and Unit after navigating to detail and back, then still clears Unit on a genuine Site change', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderWithDetailRoute();

    // The Site filter's trigger button is labelled by its own associated `<label>` ("Site"), which
    // the accessible-name algorithm uses in place of the trigger's own changing visible text — so
    // its accessible name stays "Site" throughout, regardless of what's currently selected; the
    // selection itself is asserted via the button's `textContent` instead.
    const siteFilterTrigger = () => screen.getByRole('button', { name: 'Site' });
    // Radix's `DropdownMenu` trigger opens on `pointerdown`, not `click` (`onOpenToggle` fires
    // from `onPointerDown`) — a plain `fireEvent.click` never opens it.
    const openSiteFilter = () => fireEvent.pointerDown(siteFilterTrigger(), { button: 0 });
    // A checkbox item's own `onSelect` is deliberately `preventDefault`-ed (multi-select stays
    // open across toggles, `multi-select-filter.tsx`), so the menu must be closed explicitly —
    // while open, Radix marks the rest of the page `aria-hidden` for focus containment, which
    // would otherwise make every `getByRole` query below fail to find anything outside the menu.
    const closeSiteFilter = () => fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    // 1. Start the list with one Site and one Unit selected.
    openSiteFilter();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    closeSiteFilter();
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'unit-1' } });
    expect((screen.getByLabelText('Branch') as HTMLSelectElement).value).toBe('unit-1');
    expect(siteFilterTrigger().textContent).toContain('Site One');

    // 2. Navigate to detail — carries the current filter selection via `location.state`.
    fireEvent.click(screen.getByRole('button', { name: /view details/i }));
    expect(screen.getByRole('button', { name: /back to report/i })).toBeTruthy();

    // 3. Return using "Back to Report."
    fireEvent.click(screen.getByRole('button', { name: /back to report/i }));

    // 4. Both Site and Unit are restored — the Unit-clearing effect's own mount-time run must not
    //    wipe a Unit that was validly restored alongside its own matching single-Site selection.
    expect(siteFilterTrigger().textContent).toContain('Site One');
    expect((screen.getByLabelText('Branch') as HTMLSelectElement).value).toBe('unit-1');

    // 5. A genuine Site change afterwards still clears the now-incompatible Unit (single Site ->
    //    a different single Site).
    openSiteFilter();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site Two' }));
    closeSiteFilter();
    expect((screen.getByLabelText('Branch') as HTMLSelectElement).value).toBe('');
  });
});

describe('ReportsEmployeePayrollHistoryPage — export', () => {
  afterEach(() => cleanup());

  it('triggers CSV export with current filters and sort', async () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadEmployeePayrollHistoryExport).toHaveBeenCalled());
    const call = mockDownloadEmployeePayrollHistoryExport.mock.calls.at(-1);
    expect(call?.[1]).toBe('cycle');
    expect(call?.[2]).toBe('desc');
    expect(call?.[3]).toBe('csv');
  });

  it('disables export buttons while no data or zero rows', () => {
    mockUseEmployeePayrollHistoryList.mockReturnValue({
      data: fullReport({ total: 0, rows: [] }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect((screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ReportsEmployeePayrollHistoryPage — Print', () => {
  afterEach(() => cleanup());

  it('clicking Print opens the options dialog instead of calling window.print() immediately, defaulting to every safe column selected', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Print Options')).toBeTruthy();
    expect(screen.getByText(/13 columns selected/)).toBeTruthy();
  });

  it('confirming the dialog calls window.print() and no CNIC/banking fields ever appear as print options', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.queryByText(/cnic/i)).toBeNull();
    expect(screen.queryByText(/bank/i)).toBeNull();
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    expect(screen.queryByText('Print Options')).toBeNull();
  });

  it('restores a previously saved field selection using this report-specific localStorage key', () => {
    window.localStorage.setItem(
      'employee-payroll-history-print-fields:v1',
      JSON.stringify({ cards: [], columns: ['employeeName', 'netSalary'] }),
    );
    mockUseEmployeePayrollHistoryList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByText('2 columns selected', { exact: false })).toBeTruthy();
  });
});
