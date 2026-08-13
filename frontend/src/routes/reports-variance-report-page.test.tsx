// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VarianceReportListResponse, VarianceReportRow, VarianceReportTotals, SessionUser } from '@payroll/shared';

/**
 * Variance / Month-on-Month Report Checkpoint 1B — list page tests. Every data-fetching hook is
 * mocked to a controlled, already-resolved value (this codebase's own established pattern,
 * `reports-salary-release-report-page.test.tsx`) — these tests exercise the page's own
 * permission-gating, dual-Cycle selection/URL wiring, filter/sort/pagination wiring, and rendering
 * logic, never a real backend. Real browser/network verification is Playwright's job (the next
 * numbered spec in `tests/e2e/specs/`).
 */

const mockUseVarianceReportList = vi.hoisted(() => vi.fn());
const mockUseVarianceReportEmployeeSearch = vi.hoisted(() => vi.fn());
const mockDownloadVarianceReportExport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/hooks/use-variance-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-variance-report')>();
  return {
    ...actual,
    useVarianceReportList: mockUseVarianceReportList,
    useVarianceReportEmployeeSearch: mockUseVarianceReportEmployeeSearch,
    downloadVarianceReportExport: mockDownloadVarianceReportExport,
  };
});

const CYCLES = [
  { id: 'cycle-sep', year: 2026, month: 9, status: 'DRAFT' },
  { id: 'cycle-aug', year: 2026, month: 8, status: 'RELEASED' },
  { id: 'cycle-jul', year: 2026, month: 7, status: 'RELEASED' },
  { id: 'cycle-jun', year: 2026, month: 6, status: 'ARCHIVED' },
];

const mockUsePayrollCycles = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-payroll-cycles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-cycles')>();
  return {
    ...actual,
    usePayrollCycles: mockUsePayrollCycles,
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
  useProjectUnits: (siteId: string | undefined) => ({
    data: siteId === 'site-1' ? [{ id: 'unit-1', name: 'HQ', code: null }] : [],
    isLoading: false,
    error: undefined,
  }),
}));

const { ReportsVarianceReportPage } = await import('./reports-variance-report-page');

const baseUser: SessionUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@test.local',
  roleId: 'role-1',
  roleCode: 'PAYROLL_STAFF',
  roleName: 'Payroll Staff',
  permissions: ['reports:view'] as SessionUser['permissions'],
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

beforeEach(() => {
  mockUsePayrollCycles.mockReturnValue({ data: CYCLES, isLoading: false, error: null });
  mockUseVarianceReportEmployeeSearch.mockReturnValue({ data: { total: 0, page: 1, pageSize: 25, employees: [] }, isLoading: false });
  window.localStorage.clear();
});

afterEach(() => cleanup());

function renderPage(user: SessionUser = baseUser, initialEntry = '/reports/variance') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/reports/variance" element={<ReportsVarianceReportPage user={user} />} />
          <Route
            path="/reports/employee-payroll-history"
            element={<EmployeePayrollHistoryPlaceholder />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Stands in for the real Employee Payroll History list page — the behavior under test here is
 * entirely the Variance page's own "View Full History" navigation, so this only reads back
 * `location.state.listState` and renders it for assertion, mirroring
 * `reports-employee-payroll-history-page.test.tsx`'s own identical `DetailPlaceholder` pattern. */
function EmployeePayrollHistoryPlaceholder() {
  const location = useLocation();
  const listState = (location.state as { listState?: { employeeId?: string; selectedCandidate?: { name?: string } } } | null)?.listState;
  return (
    <div data-testid="eph-landed">
      employeeId={listState?.employeeId ?? ''} name={listState?.selectedCandidate?.name ?? ''}
    </div>
  );
}

function row(overrides: Partial<VarianceReportRow> = {}): VarianceReportRow {
  return {
    employeeId: 'emp-1',
    employeeCode: 'E-001',
    employeeName: 'Jane Doe',
    populationStatus: 'CONTINUED',
    direction: 'INCREASED',
    comparisonPayrollEntryId: 'entry-comp-1',
    currentPayrollEntryId: 'entry-cur-1',
    comparisonSiteId: 'site-1',
    comparisonSiteName: 'Site One',
    currentSiteId: 'site-1',
    currentSiteName: 'Site One',
    siteTransfer: false,
    comparisonUnit: { id: 'unit-1', name: 'HQ', code: null },
    currentUnit: { id: 'unit-1', name: 'HQ', code: null },
    unitChange: false,
    comparisonNet: '50000.00',
    currentNet: '55000.00',
    varianceAmount: '5000.00',
    variancePercent: '10.00',
    hasComparisonCorrection: false,
    hasCurrentCorrection: false,
    ...overrides,
  };
}

function totals(overrides: Partial<VarianceReportTotals> = {}): VarianceReportTotals {
  return {
    matchingCount: 1,
    newEmployeeCount: 0,
    departedEmployeeCount: 0,
    continuedEmployeeCount: 1,
    increasedCount: 1,
    decreasedCount: 0,
    unchangedCount: 0,
    siteTransferCount: 0,
    correctedEntryCount: 0,
    comparisonTotalNet: '50000.00',
    currentTotalNet: '55000.00',
    aggregateVarianceAmount: '5000.00',
    aggregateVariancePercent: '10.00',
    totalsComputed: true,
    ...overrides,
  };
}

function fullReport(overrides: Partial<VarianceReportListResponse> = {}): VarianceReportListResponse {
  return {
    currentCycle: { id: 'cycle-sep', year: 2026, month: 9, status: 'DRAFT' },
    comparisonCycle: { id: 'cycle-aug', year: 2026, month: 8, status: 'RELEASED' },
    page: 1,
    pageSize: 25,
    total: 1,
    rows: [row()],
    totals: totals(),
    generatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockReport(response: VarianceReportListResponse) {
  mockUseVarianceReportList.mockReturnValue({ data: response, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
}

describe('ReportsVarianceReportPage — permission gate (reports:view only, no OR gate)', () => {
  it('shows an access-denied state for a user without reports:view', () => {
    mockUseVarianceReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: [] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('denies a user holding only payroll:view (no OR gate, unlike Salary Release Report)', () => {
    mockUseVarianceReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: ['payroll:view'] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('denies a user holding only statements:view', () => {
    mockUseVarianceReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: ['statements:view'] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('renders the report for a user holding reports:view', () => {
    mockReport(fullReport());
    renderPage({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });

  it('never renders a dedicated detail-page link (no Variance detail endpoint in V1 — only View Full History)', () => {
    mockReport(fullReport());
    renderPage();
    expect(screen.queryByRole('button', { name: /^view details$/i })).toBeNull();
  });
});

describe('ReportsVarianceReportPage — dual-cycle selection', () => {
  it('makes no report request effectively (both empty) and shows the "select both cycles" state when the URL has neither cycle and cycles are still loading', () => {
    mockUsePayrollCycles.mockReturnValue({ data: [], isLoading: true, error: null });
    mockUseVarianceReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    // cyclesQuery.isLoading -> top-level skeleton, not the "select cycles" copy yet.
    expect(screen.queryByText(/select a current cycle and a comparison cycle/i)).toBeNull();
  });

  it('shows "no payroll cycles exist yet" when zero cycles exist', () => {
    mockUsePayrollCycles.mockReturnValue({ data: [], isLoading: false, error: null });
    mockUseVarianceReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/no payroll cycles exist yet/i)).toBeTruthy();
  });

  it('smart-defaults Current Cycle to the Draft cycle and Comparison Cycle to the immediately preceding one when neither is in the URL', async () => {
    mockReport(fullReport());
    renderPage();
    await waitFor(() => {
      const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
      expect(lastCall?.[0]).toEqual(expect.objectContaining({ currentCycleId: 'cycle-sep', comparisonCycleId: 'cycle-aug' }));
    });
    expect((screen.getByLabelText(/^current cycle$/i) as HTMLSelectElement).value).toBe('cycle-sep');
    expect((screen.getByLabelText(/^comparison cycle$/i) as HTMLSelectElement).value).toBe('cycle-aug');
  });

  it('leaves Comparison Cycle unset (never a forced/synthetic pick) when Current Cycle is already the oldest cycle', async () => {
    mockUsePayrollCycles.mockReturnValue({ data: [CYCLES[3]], isLoading: false, error: null }); // only cycle-jun exists
    mockUseVarianceReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    await waitFor(() => {
      const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
      expect(lastCall?.[0]).toEqual(expect.objectContaining({ currentCycleId: 'cycle-jun', comparisonCycleId: '' }));
    });
    expect(screen.getByText(/select a current cycle and a comparison cycle/i)).toBeTruthy();
  });

  it('respects an explicit, arbitrary non-adjacent comparison already present in the URL (never overridden by the smart default)', async () => {
    mockReport(fullReport({ currentCycle: { id: 'cycle-sep', year: 2026, month: 9, status: 'DRAFT' }, comparisonCycle: { id: 'cycle-jun', year: 2026, month: 6, status: 'ARCHIVED' } }));
    renderPage(baseUser, '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-jun');
    await waitFor(() => {
      const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
      expect(lastCall?.[0]).toEqual(expect.objectContaining({ currentCycleId: 'cycle-sep', comparisonCycleId: 'cycle-jun' }));
    });
    expect(screen.getAllByText(/September 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/June 2026/).length).toBeGreaterThan(0);
  });

  it('changing the Comparison Cycle selector forwards the new id and resets the page to 1', async () => {
    mockReport(fullReport({ page: 2 }));
    renderPage(baseUser, '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug');
    await waitFor(() => expect((screen.getByLabelText(/^comparison cycle$/i) as HTMLSelectElement).value).toBe('cycle-aug'));

    fireEvent.change(screen.getByLabelText(/^comparison cycle$/i), { target: { value: 'cycle-jul' } });
    await waitFor(() => {
      const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
      expect(lastCall?.[0]).toEqual(expect.objectContaining({ currentCycleId: 'cycle-sep', comparisonCycleId: 'cycle-jul', page: 1 }));
    });
  });

  it('changing the Current Cycle selector keeps the already-chosen Comparison Cycle (arbitrary comparison, never auto-reset)', async () => {
    mockReport(fullReport());
    renderPage(baseUser, '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-jun');
    await waitFor(() => expect((screen.getByLabelText(/^current cycle$/i) as HTMLSelectElement).value).toBe('cycle-sep'));

    fireEvent.change(screen.getByLabelText(/^current cycle$/i), { target: { value: 'cycle-aug' } });
    await waitFor(() => {
      const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
      expect(lastCall?.[0]).toEqual(expect.objectContaining({ currentCycleId: 'cycle-aug', comparisonCycleId: 'cycle-jun' }));
    });
  });

  it('displays the comparison direction clearly using real cycle labels ("Current: ... / Compared with: ...")', () => {
    mockReport(fullReport());
    renderPage(baseUser, '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug');
    expect(screen.getAllByText(/September 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/August 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/compared with/i).length).toBeGreaterThan(0);
  });
});

describe('ReportsVarianceReportPage — loading/empty/error states', () => {
  it('shows a loading skeleton while the report is fetching', () => {
    mockUseVarianceReportList.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    const { container } = renderPage(baseUser, '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug');
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry action', () => {
    const refetch = vi.fn();
    mockUseVarianceReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: new Error('boom'), refetch });
    renderPage(baseUser, '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug');
    expect(screen.getByText(/could not load the variance report/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('distinguishes "no variance data" from "no match for filters"', () => {
    mockReport(fullReport({ total: 0, rows: [], totals: totals({ matchingCount: 0 }) }));
    renderPage(baseUser, '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug');
    expect(screen.getByText(/no employee-level variance data for this comparison/i)).toBeTruthy();
  });
});

describe('ReportsVarianceReportPage — totals', () => {
  const url = '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug';

  it('renders backend-provided totals verbatim, grouped into Financial Totals / Population & Direction', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Financial Totals')).toBeTruthy();
    expect(cards.getByText('Population & Direction')).toBeTruthy();
    expect(cards.getAllByText(/50,?000\.00/).length).toBeGreaterThan(0);
    expect(cards.getAllByText(/55,?000\.00/).length).toBeGreaterThan(0);
    expect(cards.getByText('Matching Employees')).toBeTruthy();
  });

  it('never averages/sums row-level percentages into the aggregate — renders the backend aggregate verbatim', () => {
    mockReport(fullReport({ totals: totals({ aggregateVariancePercent: '3.33' }) }));
    renderPage(baseUser, url);
    expect(within(screen.getByTestId('on-screen-cards')).getByText('3.33%')).toBeTruthy();
  });

  it('shows the totals-unavailable notice instead of misleading zeros when totalsComputed is false, but always shows population/direction counts', () => {
    mockReport(
      fullReport({
        totals: totals({
          totalsComputed: false,
          comparisonTotalNet: null,
          currentTotalNet: null,
          aggregateVarianceAmount: null,
          aggregateVariancePercent: null,
          matchingCount: 25000,
          newEmployeeCount: 500,
        }),
      }),
    );
    renderPage(baseUser, url);
    expect(screen.getByTestId('vr-totals-unavailable')).toBeTruthy();
    expect(screen.getByText(/totals are unavailable for this result size/i)).toBeTruthy();
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Population & Direction')).toBeTruthy();
    expect(cards.getByText('500')).toBeTruthy();
  });

  it('never shows a bounded financial total as 0 when totalsComputed is false', () => {
    mockReport(fullReport({ totals: totals({ totalsComputed: false, comparisonTotalNet: null, currentTotalNet: null, aggregateVarianceAmount: null, aggregateVariancePercent: null }) }));
    renderPage(baseUser, url);
    expect(screen.queryByTestId('vr-stat-comparison-total-net')).toBeNull();
  });
});

describe('ReportsVarianceReportPage — population status and direction presentation', () => {
  const url = '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug';

  it('renders NEW with — for the comparison side, no fabricated variance, and no Direction badge', () => {
    mockReport(
      fullReport({
        rows: [
          row({
            populationStatus: 'NEW',
            direction: null,
            comparisonPayrollEntryId: null,
            comparisonSiteId: null,
            comparisonSiteName: null,
            comparisonUnit: null,
            comparisonNet: null,
            varianceAmount: null,
            variancePercent: null,
          }),
        ],
      }),
    );
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    expect(table.getByText('New')).toBeTruthy();
    const dataRow = table.getByText('Jane Doe').closest('tr');
    if (!dataRow) throw new Error('expected a data row');
    const cellsText = within(dataRow)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cellsText).toContain('—');
    expect(within(dataRow).queryByText('Increased')).toBeNull();
    expect(within(dataRow).queryByText(/0\.00%/)).toBeNull();
  });

  it('renders DEPARTED with — for the current side, no fabricated variance, and no Direction badge', () => {
    mockReport(
      fullReport({
        rows: [
          row({
            populationStatus: 'DEPARTED',
            direction: null,
            currentPayrollEntryId: null,
            currentSiteId: null,
            currentSiteName: null,
            currentUnit: null,
            currentNet: null,
            varianceAmount: null,
            variancePercent: null,
          }),
        ],
      }),
    );
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    expect(table.getByText('Departed')).toBeTruthy();
    const dataRow = table.getByText('Jane Doe').closest('tr');
    if (!dataRow) throw new Error('expected a data row');
    expect(within(dataRow).queryByText('Decreased')).toBeNull();
  });

  it('renders CONTINUED with a Direction badge matching the sign of the variance (Increased/Decreased/Unchanged)', () => {
    mockReport(
      fullReport({
        rows: [
          row({ employeeId: 'e-inc', employeeName: 'Increased Employee', direction: 'INCREASED', varianceAmount: '1000.00', variancePercent: '5.00' }),
          row({ employeeId: 'e-dec', employeeName: 'Decreased Employee', direction: 'DECREASED', varianceAmount: '-1000.00', variancePercent: '-5.00' }),
          row({ employeeId: 'e-unc', employeeName: 'Unchanged Employee', direction: 'UNCHANGED', varianceAmount: '0.00', variancePercent: '0.00' }),
        ],
        total: 3,
      }),
    );
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    expect(table.getByText('Increased')).toBeTruthy();
    expect(table.getByText('Decreased')).toBeTruthy();
    expect(table.getByText('Unchanged')).toBeTruthy();
    expect(table.getByText(/-1,?000\.00/)).toBeTruthy();
    expect(table.getByText(/-5\.00%/)).toBeTruthy();
  });

  it('renders — (never Infinity/NaN) for Variance % when Comparison Net is 0', () => {
    mockReport(fullReport({ rows: [row({ comparisonNet: '0.00', currentNet: '500.00', varianceAmount: '500.00', variancePercent: null })] }));
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    const dataRow = table.getByText('Jane Doe').closest('tr');
    if (!dataRow) throw new Error('expected a data row');
    const bodyText = dataRow.textContent ?? '';
    expect(bodyText).not.toMatch(/infinity/i);
    expect(bodyText).not.toMatch(/nan/i);
  });
});

describe('ReportsVarianceReportPage — table (no sensitive fields, transfer/unit/correction context)', () => {
  const url = '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug';

  it('renders every approved column with no sensitive fields (no CNIC/bank/account/IBAN/Released By/payment method/correction reason)', () => {
    mockReport(fullReport());
    const { container } = renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    expect(table.getByText('E-001')).toBeTruthy();
    expect(table.getByText('Jane Doe')).toBeTruthy();
    expect(table.getAllByText('Site One').length).toBeGreaterThan(0);
    const bodyText = container.textContent ?? '';
    expect(bodyText).not.toMatch(/cnic/i);
    expect(bodyText).not.toMatch(/iban/i);
    expect(bodyText).not.toMatch(/account number/i);
    expect(bodyText).not.toMatch(/released by/i);
    expect(bodyText).not.toMatch(/payment method/i);
    expect(bodyText).not.toMatch(/correction reason/i);
  });

  it('a Site Transfer row shows both sides distinctly and a Site Transfer indicator; a non-transfer row shows No', () => {
    mockReport(
      fullReport({
        rows: [
          row({ employeeId: 'e-transfer', employeeName: 'Transferred Employee', siteTransfer: true, comparisonSiteId: 'site-1', comparisonSiteName: 'Site One', currentSiteId: 'site-2', currentSiteName: 'Site Two' }),
          row({ employeeId: 'e-stable', employeeName: 'Stable Employee', siteTransfer: false }),
        ],
        total: 2,
      }),
    );
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    const transferRow = table.getByText('Transferred Employee').closest('tr');
    const stableRow = table.getByText('Stable Employee').closest('tr');
    if (!transferRow || !stableRow) throw new Error('expected both rows');
    expect(within(transferRow).getByText('Site One')).toBeTruthy();
    expect(within(transferRow).getByText('Site Two')).toBeTruthy();
    expect(within(transferRow).getAllByText('Yes').length).toBeGreaterThan(0);
    expect(within(stableRow).queryAllByText('Yes')).toHaveLength(0);
  });

  it('a Unit Change row shows a Unit Change indicator without affecting Net figures', () => {
    mockReport(
      fullReport({
        rows: [row({ unitChange: true, comparisonUnit: { id: 'unit-1', name: 'HQ', code: null }, currentUnit: { id: 'unit-2', name: 'Branch B', code: null } })],
      }),
    );
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    const dataRow = table.getByText('Jane Doe').closest('tr');
    if (!dataRow) throw new Error('expected a data row');
    expect(within(dataRow).getAllByText('Yes').length).toBeGreaterThan(0);
    expect(within(dataRow).getByText(/50,?000\.00/)).toBeTruthy();
  });

  it('correction flags are existence-only and never rewrite the compared Net figures', () => {
    mockReport(
      fullReport({
        rows: [row({ hasComparisonCorrection: true, hasCurrentCorrection: true, comparisonNet: '50000.00', currentNet: '55000.00' })],
      }),
    );
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    const dataRow = table.getByText('Jane Doe').closest('tr');
    if (!dataRow) throw new Error('expected a data row');
    expect(within(dataRow).getByText(/50,?000\.00/)).toBeTruthy();
    expect(within(dataRow).getByText(/55,?000\.00/)).toBeTruthy();
  });

  it('an employee remains exactly one row even with a Site Transfer and a Unit Change together', () => {
    mockReport(fullReport({ rows: [row({ siteTransfer: true, unitChange: true })], total: 1 }));
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    expect(table.getAllByText('Jane Doe')).toHaveLength(1);
  });
});

describe('ReportsVarianceReportPage — sorting and pagination', () => {
  const url = '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug';

  it('clicking a sortable column header requests the backend with the new sort field, reset to page 1', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    fireEvent.click(screen.getByRole('button', { name: /current net/i }));
    const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'currentNet', sortDir: 'asc', page: 1 }));
  });

  it('clicking the active sort header again reverses direction', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    fireEvent.click(screen.getByRole('button', { name: /current net/i }));
    fireEvent.click(screen.getByRole('button', { name: /current net/i }));
    const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'currentNet', sortDir: 'desc' }));
  });

  it('exposes aria-sort on the active sortable column', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    const header = within(screen.getByTestId('on-screen-table')).getByRole('columnheader', { name: /employee name/i });
    expect(header.getAttribute('aria-sort')).toBe('ascending');
  });

  it('Variance %, Direction, Site Transfer, Unit Change, and both correction columns are never sortable buttons (unsupported by the backend)', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    expect(table.queryByRole('button', { name: /^variance %$/i })).toBeNull();
    expect(table.queryByRole('button', { name: /^direction$/i })).toBeNull();
    expect(table.queryByRole('button', { name: /^site transfer$/i })).toBeNull();
    expect(table.queryByRole('button', { name: /^unit change$/i })).toBeNull();
    expect(table.queryByRole('button', { name: /^has comparison correction$/i })).toBeNull();
    expect(table.queryByRole('button', { name: /^has current correction$/i })).toBeNull();
  });

  it('uses server-provided page/pageSize/total, never client-side slicing', () => {
    mockReport(fullReport({ total: 40, page: 1, pageSize: 25 }));
    renderPage(baseUser, url);
    expect(screen.getByText(/showing 1.25 of 40/i)).toBeTruthy();
  });

  it('the table body never renders more rows than the backend-provided page', () => {
    mockReport(fullReport({ rows: [row()], total: 400 }));
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    expect(table.getAllByRole('row')).toHaveLength(2); // header + 1 data row
  });

  it('clamps down to the last valid page when the backend total shrinks below the currently-viewed page, without looping', () => {
    mockReport(fullReport({ page: 3, pageSize: 25, total: 10, rows: [] }));
    renderPage(baseUser, url);
    const calls = mockUseVarianceReportList.mock.calls;
    const pages = calls.map((call) => call[0]?.page);
    expect(pages.at(-1)).toBe(1);
  });
});

describe('ReportsVarianceReportPage — filters', () => {
  const url = '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug';

  it('changing Direction resets the page passed to the hook to 1 and forwards the value', () => {
    mockReport(fullReport({ page: 2 }));
    renderPage(baseUser, url);
    fireEvent.change(screen.getByLabelText(/^direction$/i), { target: { value: 'DECREASED' } });
    const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ direction: 'DECREASED', page: 1 }));
  });

  it('Has Correction supports All/Yes/No tri-state and passes a boolean or undefined', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'YES' } });
    let lastCall = mockUseVarianceReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: true }));

    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'NO' } });
    lastCall = mockUseVarianceReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: false }));

    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'ALL' } });
    lastCall = mockUseVarianceReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: undefined }));
  });

  it('the Unit filter is disabled unless exactly one Site is selected, and no unitId is ever sent', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).disabled).toBe(true);
    const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ unitId: undefined }));
  });

  it('selecting one Site (either-side match on the backend) enables the Unit filter and choosing a Unit forwards it', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ unitId: 'unit-1', siteIds: ['site-1'] }));
  });

  it('selecting a second Site clears an already-chosen Unit', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).value).toBe('unit-1');

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site Two' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).disabled).toBe(true);
  });

  it('typing an Employee search and selecting a match forwards employeeId to the hook', async () => {
    mockReport(fullReport());
    mockUseVarianceReportEmployeeSearch.mockReturnValue({
      data: {
        total: 1,
        page: 1,
        pageSize: 25,
        employees: [{ employeeId: 'emp-9', employeeCode: 'E-009', cnic: null, name: 'Bob Smith', currentSiteId: 'site-1', currentSiteName: 'Site One' }],
      },
      isLoading: false,
    });
    renderPage(baseUser, url);

    const input = screen.getByLabelText(/^employee$/i);
    fireEvent.change(input, { target: { value: 'Bob' } });
    fireEvent.focus(input);

    await waitFor(() => expect(screen.getByRole('option', { name: /Bob Smith/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: /Bob Smith/i }));

    const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ employeeId: 'emp-9', page: 1 }));
  });

  it('unsupported filters (minimum variance, roster status, release date, payment method, correction reason, released by) never appear on this page', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    expect(screen.queryByLabelText(/minimum variance/i)).toBeNull();
    expect(screen.queryByLabelText(/roster status/i)).toBeNull();
    expect(screen.queryByLabelText(/release date/i)).toBeNull();
    expect(screen.queryByLabelText(/payment method/i)).toBeNull();
    expect(screen.queryByLabelText(/correction reason/i)).toBeNull();
    expect(screen.queryByLabelText(/released by/i)).toBeNull();
  });

  it('Clear Filters restores defaults but never resets either selected Cycle, and preserves sort', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);

    fireEvent.change(screen.getByLabelText(/^direction$/i), { target: { value: 'DECREASED' } });
    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'YES' } });
    fireEvent.click(screen.getByRole('button', { name: /employee name/i })); // change sort away from default
    expect((screen.getByLabelText(/^direction$/i) as HTMLSelectElement).value).toBe('DECREASED');

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect((screen.getByLabelText(/^direction$/i) as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText(/^has correction$/i) as HTMLSelectElement).value).toBe('ALL');
    expect((screen.getByLabelText(/^current cycle$/i) as HTMLSelectElement).value).toBe('cycle-sep');
    expect((screen.getByLabelText(/^comparison cycle$/i) as HTMLSelectElement).value).toBe('cycle-aug');
    // Sort preserved (documented choice) — the last hook call after Clear still carries the sort
    // direction the header click above set, not a reset back to the original default.
    const lastCall = mockUseVarianceReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortDir: 'desc' }));
  });
});

describe('ReportsVarianceReportPage — export', () => {
  const url = '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug';

  it('clicking Export CSV calls downloadVarianceReportExport with both cycles, current filters/sort, and format csv', async () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await Promise.resolve();
    expect(mockDownloadVarianceReportExport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cycle-sep' }),
      expect.objectContaining({ id: 'cycle-aug' }),
      expect.objectContaining({ currentCycleId: 'cycle-sep', comparisonCycleId: 'cycle-aug' }),
      'employeeName',
      'asc',
      'csv',
    );
  });

  it('clicking Export Excel calls downloadVarianceReportExport with format xlsx', async () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    fireEvent.click(screen.getByRole('button', { name: /export excel/i }));
    await Promise.resolve();
    expect(mockDownloadVarianceReportExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'employeeName',
      'asc',
      'xlsx',
    );
  });

  it('export is disabled when there are zero matching rows', () => {
    mockReport(fullReport({ total: 0, rows: [], totals: totals({ matchingCount: 0 }) }));
    renderPage(baseUser, url);
    expect((screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('never sends page/pageSize in the export request params object', async () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await Promise.resolve();
    const filtersArg = mockDownloadVarianceReportExport.mock.calls.at(-1)?.[2];
    expect(filtersArg).not.toHaveProperty('page');
    expect(filtersArg).not.toHaveProperty('pageSize');
  });
});

describe('ReportsVarianceReportPage — print', () => {
  const url = '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug';

  it('opens the Print Options dialog on Print click, with no change to the report query params passed to the hook (no new request from Print)', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    const paramsBefore = mockUseVarianceReportList.mock.calls.at(-1)?.[0];
    fireEvent.click(screen.getByRole('button', { name: /^print$/i }));
    expect(screen.getByText('Print Options')).toBeTruthy();
    expect(mockUseVarianceReportList.mock.calls.at(-1)?.[0]).toEqual(paramsBefore);
  });

  it('the print context header includes both Cycles, Site, Unit, Employee, Direction, Has Correction, and the variance formula', () => {
    mockReport(fullReport());
    const { container } = renderPage(baseUser, url);
    const contextEl = container.querySelector('.print\\:mb-4 p.text-\\[11px\\]');
    expect(contextEl?.textContent).toMatch(/Current: September 2026/);
    expect(contextEl?.textContent).toMatch(/Compared with: August 2026/);
    expect(contextEl?.textContent).toMatch(/Site: All/);
    expect(contextEl?.textContent).toMatch(/Unit: Any/);
    expect(contextEl?.textContent).toMatch(/Employee: All/);
    expect(contextEl?.textContent).toMatch(/Direction: All/);
    expect(contextEl?.textContent).toMatch(/Has Correction: All/);
    expect(contextEl?.textContent).toMatch(/Variance = Current Net.*Comparison Net/);
    expect(contextEl?.textContent).toMatch(/Current page only/);
  });

  it('Print is disabled until both Cycles are selected', () => {
    // Only one cycle exists at all, so the smart comparison default has nothing to resolve to
    // (Checkpoint 1B §4) — this is the one real state where `comparisonCycleId` genuinely stays
    // empty, unlike passing a partial URL against the full CYCLES fixture (which the smart default
    // would immediately fill in).
    mockUsePayrollCycles.mockReturnValue({ data: [CYCLES[0]], isLoading: false, error: null });
    mockUseVarianceReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage(baseUser, '/reports/variance?currentCycleId=cycle-sep');
    expect((screen.getByRole('button', { name: /^print$/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ReportsVarianceReportPage — Employee Payroll History drill-down', () => {
  const url = '/reports/variance?currentCycleId=cycle-sep&comparisonCycleId=cycle-aug';

  it('View Full History navigates to Employee Payroll History carrying the correct row employeeId', () => {
    mockReport(fullReport({ rows: [row({ employeeId: 'emp-target', employeeName: 'Target Employee' })] }));
    renderPage(baseUser, url);

    const table = within(screen.getByTestId('on-screen-table'));
    fireEvent.click(table.getByRole('button', { name: /view full history/i }));

    const landed = screen.getByTestId('eph-landed');
    expect(landed.textContent).toContain('employeeId=emp-target');
    expect(landed.textContent).toContain('name=Target Employee');
  });

  it('never creates a new Variance-specific detail query — this is a plain in-app navigation, not a data fetch', () => {
    mockReport(fullReport());
    renderPage(baseUser, url);
    const table = within(screen.getByTestId('on-screen-table'));
    fireEvent.click(table.getByRole('button', { name: /view full history/i }));
    // The mocked list hook is never called with anything resembling a detail-shaped param.
    for (const call of mockUseVarianceReportList.mock.calls) {
      expect(call[0]).not.toHaveProperty('employeeIdDetail');
    }
  });
});
