// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OvertimeReportListResponse, OvertimeReportRow, SessionUser } from '@payroll/shared';

/**
 * Overtime Report Checkpoint 1B — list page tests. Every data-fetching hook is mocked to a
 * controlled, already-resolved value (this codebase's own established pattern,
 * `reports-deduction-report-page.test.tsx`) — these tests exercise the page's own permission-gating,
 * filter/sort/pagination wiring, and rendering logic, never a real backend. Real browser/network
 * verification is Playwright's job (`tests/e2e/specs/22-overtime-report.spec.ts`).
 *
 * This report's grain is `PayrollEntryWorkLine`, not `PayrollEntry` — a distinct suite below
 * ("WorkLine grain") proves the page never merges/groups/deduplicates two work-line rows belonging
 * to the same employee, the one behavior genuinely unique to this report among its siblings.
 */

const mockUseOvertimeReportList = vi.hoisted(() => vi.fn());
const mockDownloadOvertimeReportExport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/hooks/use-overtime-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-overtime-report')>();
  return {
    ...actual,
    useOvertimeReportList: mockUseOvertimeReportList,
    downloadOvertimeReportExport: mockDownloadOvertimeReportExport,
  };
});

const CYCLES = [
  { id: 'cycle-jul', year: 2026, month: 7, status: 'DRAFT', sourceCycleId: null, createdAt: '', createdBy: '', releasedAt: null, releasedBy: null, archivedAt: null, archivedBy: null, isCurrentDraft: true },
  { id: 'cycle-jun', year: 2026, month: 6, status: 'RELEASED', sourceCycleId: null, createdAt: '', createdBy: '', releasedAt: null, releasedBy: null, archivedAt: null, archivedBy: null, isCurrentDraft: false },
];

const mockUseSelectedPayrollCycle = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-selected-payroll-cycle', () => ({
  useSelectedPayrollCycle: mockUseSelectedPayrollCycle,
}));

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
    data: siteId === 'site-1' ? [{ id: 'unit-1', name: 'HQ', code: null }, { id: 'unit-2', name: 'Warehouse', code: null }] : [],
    isLoading: false,
    error: undefined,
  }),
}));

const { ReportsOvertimeReportPage } = await import('./reports-overtime-report-page');

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

function mockSelectedCycle(cycle: (typeof CYCLES)[number] = CYCLES[0]!) {
  mockUseSelectedPayrollCycle.mockReturnValue({
    cycleId: cycle.id,
    cycle,
    cycles: CYCLES,
    isLoading: false,
    error: null,
    selectCycle: vi.fn(),
  });
}

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
  mockSelectedCycle();
  window.localStorage.clear();
});

function renderPage(user: SessionUser = baseUser) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reports/overtime-report']}>
        <Routes>
          <Route path="/reports/overtime-report" element={<ReportsOvertimeReportPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function row(overrides: Partial<OvertimeReportRow> = {}): OvertimeReportRow {
  return {
    workLineId: 'wl-1',
    payrollEntryId: 'entry-1',
    employeeId: 'emp-1',
    employeeCode: 'E-001',
    employeeName: 'Jane Doe',
    siteId: 'site-1',
    siteName: 'Site One',
    unit: { id: 'unit-1', name: 'HQ', code: null },
    designation: 'Clerk',
    otHours: '10.00',
    effectiveOtRate: '125.00',
    otEarned: '1250.00',
    grossPay: '30000.00',
    rowStatus: 'RELEASED',
    hasCorrection: false,
    ...overrides,
  };
}

function totals(overrides: Partial<OvertimeReportListResponse['totals']> = {}): OvertimeReportListResponse['totals'] {
  return {
    matchingCount: 1,
    employeesWithOvertimeCount: 1,
    totalOtHours: '10.00',
    totalOtEarnings: '1250.00',
    sitesWithOvertimeCount: 1,
    unitsWithOvertimeCount: 1,
    releasedCount: 1,
    heldCount: 0,
    pendingCount: 0,
    correctedEntryCount: 0,
    totalsComputed: true,
    ...overrides,
  };
}

function fullReport(overrides: Partial<OvertimeReportListResponse> = {}): OvertimeReportListResponse {
  return {
    cycle: { id: 'cycle-jul', year: 2026, month: 7, status: 'DRAFT' },
    page: 1,
    pageSize: 25,
    total: 1,
    rows: [row()],
    totals: totals(),
    generatedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('ReportsOvertimeReportPage — RBAC', () => {
  afterEach(() => cleanup());

  it('shows an access-denied state for a user without reports:view', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: [] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('renders the report for a user holding reports:view', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });

  it('never renders a "View Details" action or any detail-route link (no detail page in V1)', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByRole('button', { name: /view details/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /view details/i })).toBeNull();
  });

  it('never allows row clicks to navigate anywhere (no per-row action, no row click handler)', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const pathBefore = window.location.pathname;
    fireEvent.click(within(screen.getByTestId('on-screen-table')).getByText('Jane Doe'));
    expect(window.location.pathname).toBe(pathBefore);
  });
});

describe('ReportsOvertimeReportPage — Cycle requirement', () => {
  afterEach(() => cleanup());

  it('shows "no payroll cycles exist yet" and never renders the table when no Cycle exists', () => {
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: undefined, cycle: undefined, cycles: [], isLoading: false, error: null, selectCycle: vi.fn() });
    mockUseOvertimeReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/no payroll cycles exist yet/i)).toBeTruthy();
    expect(screen.queryByTestId('on-screen-table')).toBeNull();
  });

  it('selecting a different Cycle calls selectCycle with the new id', () => {
    const selectCycle = vi.fn();
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle });
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^cycle$/i), { target: { value: 'cycle-jun' } });
    expect(selectCycle).toHaveBeenCalledWith('cycle-jun');
  });

  it('the hook is never invoked with a cycleId when none is selected (no list request without a Cycle)', () => {
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: undefined, cycle: undefined, cycles: [], isLoading: false, error: null, selectCycle: vi.fn() });
    mockUseOvertimeReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ cycleId: '' }));
  });
});

describe('ReportsOvertimeReportPage — loading/empty/error states', () => {
  afterEach(() => cleanup());

  it('shows a loading skeleton while fetching', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry action', () => {
    const refetch = vi.fn();
    mockUseOvertimeReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: new Error('boom'), refetch });
    renderPage();
    expect(screen.getByText(/could not load the overtime report/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('distinguishes "no entries for this cycle" from "no match for filters"', () => {
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({ total: 0, rows: [], totals: totals({ matchingCount: 0 }) }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/this cycle has no payroll entries yet/i)).toBeTruthy();
  });
});

describe('ReportsOvertimeReportPage — totals', () => {
  afterEach(() => cleanup());

  it('renders backend-provided totals verbatim, grouped into Overtime / Coverage / Status', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Overtime')).toBeTruthy();
    expect(cards.getByText('Coverage')).toBeTruthy();
    expect(cards.getByText('Status')).toBeTruthy();
    expect(cards.getByTestId('or-stat-total-ot-hours').textContent).toContain('10');
    expect(cards.getByTestId('or-stat-total-ot-earnings').textContent).toContain('1,250.00');
    expect(cards.getByText('Matching Work Lines')).toBeTruthy();
    expect(cards.getByText('Employees With Overtime')).toBeTruthy();
    expect(cards.getByText('Sites With Overtime')).toBeTruthy();
    expect(cards.getByText('Units With Overtime')).toBeTruthy();
  });

  it('never renders an "Average OT Rate" figure anywhere on screen (frozen decision — not implemented)', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByText(/average ot rate/i)).toBeNull();
  });

  it('shows the totals-unavailable notice instead of misleading zeros for Total OT Hours/Earnings when totalsComputed is false, but always shows Matching Work Lines and Status counts', () => {
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({
        totals: totals({
          totalsComputed: false,
          totalOtHours: null,
          totalOtEarnings: null,
          employeesWithOvertimeCount: null,
          sitesWithOvertimeCount: null,
          unitsWithOvertimeCount: null,
          matchingCount: 25000,
          releasedCount: 20000,
        }),
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId('or-totals-unavailable')).toBeTruthy();
    expect(screen.getByText(/totals are unavailable for this result size/i)).toBeTruthy();
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Coverage')).toBeTruthy();
    expect(cards.getByText('Status')).toBeTruthy();
    expect(cards.getByTestId('or-stat-matching-count').textContent).toContain('25000');
    expect(cards.getByTestId('or-stat-released').textContent).toContain('20000');
    // Bounded coverage counts individually gate to a dash, never a misleading zero.
    expect(screen.getByTestId('or-stat-employees-with-overtime').textContent).toContain('—');
    expect(screen.getByTestId('or-stat-sites-with-overtime').textContent).toContain('—');
    expect(screen.getByTestId('or-stat-units-with-overtime').textContent).toContain('—');
  });

  it('entry-level status counts (Released/Held/Pending/Corrected Entries) are rendered exactly as returned, never recomputed from visible rows', () => {
    // Two work lines belonging to the same one RELEASED entry — the backend already deduplicated
    // this to releasedCount: 1; the page must render that 1 verbatim, never count 2 visible rows.
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({
        rows: [
          row({ workLineId: 'wl-1', unit: { id: 'unit-1', name: 'HQ', code: null } }),
          row({ workLineId: 'wl-2', unit: { id: 'unit-2', name: 'Warehouse', code: null } }),
        ],
        total: 2,
        totals: totals({ matchingCount: 2, releasedCount: 1 }),
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId('or-stat-released').textContent).toContain('1');
    expect(screen.getByTestId('or-stat-matching-count').textContent).toContain('2');
  });
});

describe('ReportsOvertimeReportPage — table', () => {
  afterEach(() => cleanup());

  it('renders every approved column with no sensitive fields, and never Net Salary or Total Earnings', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText('E-001')).toBeTruthy();
    expect(onScreenTable.getByText('Jane Doe')).toBeTruthy();
    expect(onScreenTable.getByText('Site One')).toBeTruthy();
    expect(onScreenTable.getByText('HQ')).toBeTruthy();
    expect(onScreenTable.getByText('Clerk')).toBeTruthy();
    expect(onScreenTable.getByText('10')).toBeTruthy();
    expect(onScreenTable.getAllByText(/125\.00/).length).toBeGreaterThan(0);
    expect(onScreenTable.getAllByText(/1,250\.00/).length).toBeGreaterThan(0);
    expect(onScreenTable.getAllByText(/30,000\.00/).length).toBeGreaterThan(0);
    expect(onScreenTable.getByText('Released')).toBeTruthy();
    expect(onScreenTable.getByText('No')).toBeTruthy();
    const bodyText = container.textContent ?? '';
    expect(bodyText).not.toMatch(/cnic/i);
    expect(bodyText).not.toMatch(/iban/i);
    expect(bodyText).not.toMatch(/account number/i);
    expect(onScreenTable.queryByText('Net Salary')).toBeNull();
    expect(onScreenTable.queryByText('Total Earnings')).toBeNull();
    expect(onScreenTable.queryByText('Correction Balance Payable')).toBeNull();
  });

  it('renders "Yes" for Has Correction when true, and "No" when false', () => {
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({
        rows: [
          row({ workLineId: 'wl-yes', employeeCode: 'E-001', employeeName: 'Corrected Employee', hasCorrection: true }),
          row({ workLineId: 'wl-no', employeeCode: 'E-002', employeeName: 'Uncorrected Employee', hasCorrection: false }),
        ],
        total: 2,
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    const yesRow = onScreenTable.getByText('Corrected Employee').closest('tr');
    const noRow = onScreenTable.getByText('Uncorrected Employee').closest('tr');
    if (!yesRow || !noRow) throw new Error('expected both rows to render inside a <tr>');
    expect(within(yesRow).getByText('Yes')).toBeTruthy();
    expect(within(noRow).getByText('No')).toBeTruthy();
  });

  it('renders a distinct row-status badge for each of the five statuses', () => {
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({
        rows: [
          row({ workLineId: 'wl1', rowStatus: 'RELEASED' }),
          row({ workLineId: 'wl2', rowStatus: 'HELD' }),
          row({ workLineId: 'wl3', rowStatus: 'NO_PAY_DUE' }),
          row({ workLineId: 'wl4', rowStatus: 'RECOVERY_DUE' }),
          row({ workLineId: 'wl5', rowStatus: 'PENDING' }),
        ],
        total: 5,
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText('Released')).toBeTruthy();
    expect(onScreenTable.getByText('Held')).toBeTruthy();
    expect(onScreenTable.getByText('No Pay Due')).toBeTruthy();
    expect(onScreenTable.getByText('Recovery Due')).toBeTruthy();
    expect(onScreenTable.getByText('Pending')).toBeTruthy();
  });
});

/**
 * WorkLine-grain suite — the one behavior genuinely unique to this report among its siblings
 * (Employee Payroll History, Project Site Payroll Report, Deduction Report are all `PayrollEntry`
 * grain; this report is `PayrollEntryWorkLine` grain by frozen architectural decision). An employee
 * with 2 work lines this cycle legitimately produces 2 table rows — the page must never merge,
 * group, or deduplicate them by employee.
 */
describe('ReportsOvertimeReportPage — WorkLine grain', () => {
  afterEach(() => cleanup());

  const multiUnitRows: OvertimeReportRow[] = [
    row({
      workLineId: 'wl-hq',
      payrollEntryId: 'entry-multi',
      unit: { id: 'unit-1', name: 'HQ', code: null },
      otHours: '5.00',
      effectiveOtRate: '100.00',
      otEarned: '500.00',
    }),
    row({
      workLineId: 'wl-warehouse',
      payrollEntryId: 'entry-multi',
      unit: { id: 'unit-2', name: 'Warehouse', code: null },
      otHours: '8.00',
      effectiveOtRate: '110.00',
      otEarned: '880.00',
    }),
  ];

  it('one employee with two work lines renders exactly two table rows, never merged into one', () => {
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({ rows: multiUnitRows, total: 2 }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getAllByRole('row')).toHaveLength(3); // header + 2 data rows
    expect(onScreenTable.getAllByText('Jane Doe')).toHaveLength(2);
  });

  it('each row displays its own correct Unit, never a shared or averaged one', () => {
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({ rows: multiUnitRows, total: 2 }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText('HQ')).toBeTruthy();
    expect(onScreenTable.getByText('Warehouse')).toBeTruthy();
  });

  it('each row preserves its own independent OT Hours, Effective OT Rate, and OT Earnings — never merged/averaged/shared across rows', () => {
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({ rows: multiUnitRows, total: 2 }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    const hqRow = onScreenTable.getByText('HQ').closest('tr');
    const warehouseRow = onScreenTable.getByText('Warehouse').closest('tr');
    if (!hqRow || !warehouseRow) throw new Error('expected both rows to render inside a <tr>');

    expect(within(hqRow).getByText('5')).toBeTruthy();
    expect(within(hqRow).getByText(/100\.00/)).toBeTruthy();
    expect(within(hqRow).getByText(/500\.00/)).toBeTruthy();

    expect(within(warehouseRow).getByText('8')).toBeTruthy();
    expect(within(warehouseRow).getByText(/110\.00/)).toBeTruthy();
    expect(within(warehouseRow).getByText(/880\.00/)).toBeTruthy();
  });

  it('entry-level fields (Row Status, Has Correction) repeat identically across both of the same entry\'s rows', () => {
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({
        rows: multiUnitRows.map((r) => ({ ...r, rowStatus: 'HELD' as const, hasCorrection: true })),
        total: 2,
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getAllByText('Held')).toHaveLength(2);
    expect(onScreenTable.getAllByText('Yes')).toHaveLength(2);
  });

  it('the table body never renders fewer rows than the backend page — proof against accidental client-side deduplication by employee', () => {
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({ rows: multiUnitRows, total: 2 }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(within(screen.getByTestId('on-screen-table')).getAllByRole('row')).toHaveLength(3);
  });
});

describe('ReportsOvertimeReportPage — sorting and pagination', () => {
  afterEach(() => cleanup());

  it('clicking a sortable column header requests the backend with the new sort field, reset to page 1', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /ot hours/i }));
    const lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'otHours', sortDir: 'asc', page: 1 }));
  });

  it('clicking the active sort header again reverses direction', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /ot hours/i }));
    fireEvent.click(screen.getByRole('button', { name: /ot hours/i }));
    const lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'otHours', sortDir: 'desc' }));
  });

  it('exposes aria-sort on the active sortable column', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const header = within(screen.getByTestId('on-screen-table')).getByRole('columnheader', { name: /employee name/i });
    expect(header.getAttribute('aria-sort')).toBe('ascending');
  });

  it('Designation, Effective OT Rate, OT Earnings, Gross Pay, and Has Correction are not sortable buttons (backend does not approve these sorts)', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.queryByRole('button', { name: /^designation$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^effective ot rate$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^ot earnings$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^gross pay$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^has correction$/i })).toBeNull();
  });

  it('every approved sort field (Employee Code, Employee Name, Project Site, Unit, OT Hours, Row Status) is exposed as a sortable button', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    for (const name of [/^employee code$/i, /^employee name$/i, /^project site$/i, /^unit$/i, /^ot hours$/i, /^row status$/i]) {
      expect(onScreenTable.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('uses server-provided page/pageSize/total, never client-side slicing', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport({ total: 40, page: 1, pageSize: 25 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/showing 1.25 of 40/i)).toBeTruthy();
  });

  it('the table body never renders more rows than the backend-provided page', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport({ rows: [row()], total: 400 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getAllByRole('row')).toHaveLength(2); // header + 1 data row
  });
});

describe('ReportsOvertimeReportPage — filters', () => {
  afterEach(() => cleanup());

  it('changing Row Status resets the page passed to the hook to 1 and forwards the value', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport({ page: 2 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    const lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ rowStatus: 'HELD', page: 1 }));
  });

  it('Has Correction supports All/Yes/No tri-state and passes a boolean or undefined', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'YES' } });
    let lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: true }));

    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'NO' } });
    lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: false }));

    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'ALL' } });
    lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: undefined }));
  });

  it('Has Overtime supports All/Yes/No tri-state and passes a boolean or undefined', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^has overtime$/i), { target: { value: 'YES' } });
    let lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasOvertime: true }));

    fireEvent.change(screen.getByLabelText(/^has overtime$/i), { target: { value: 'NO' } });
    lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasOvertime: false }));

    fireEvent.change(screen.getByLabelText(/^has overtime$/i), { target: { value: 'ALL' } });
    lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasOvertime: undefined }));
  });

  it('the Unit filter is disabled unless exactly one Site is selected, and invalid Unit is never sent', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    // No Site selected yet — the filter falls back to the generic "Unit" label (a per-Site
    // `unitLabel` only applies once exactly one Site is chosen, proven by the next test).
    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).disabled).toBe(true);
    const lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ unitId: undefined }));
  });

  it('selecting one Site enables the Unit filter and choosing a Unit forwards it', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    const lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ unitId: 'unit-1', siteIds: ['site-1'] }));
  });

  it('selecting a second Site clears an already-chosen Unit, but does not clear on an unrelated rerender', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

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

  it('unsupported filters (employee search, designation, OT hours/rate/earnings range, cycle range) never appear on this page', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByLabelText(/^employee$/i)).toBeNull();
    expect(screen.queryByLabelText(/designation/i)).toBeNull();
    expect(screen.queryByLabelText(/ot hours (min|max|from|to)/i)).toBeNull();
    expect(screen.queryByLabelText(/ot rate/i)).toBeNull();
    expect(screen.queryByLabelText(/cycle from/i)).toBeNull();
    expect(screen.queryByLabelText(/cycle to/i)).toBeNull();
    expect(screen.queryByLabelText(/roster status/i)).toBeNull();
  });

  it('Clear Filters restores defaults, resets the page, but never resets the currently selected Cycle', () => {
    const selectCycle = vi.fn();
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle });
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.change(screen.getByLabelText(/^has overtime$/i), { target: { value: 'YES' } });
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('HELD');

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText(/^has overtime$/i) as HTMLSelectElement).value).toBe('ALL');
    expect(selectCycle).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/^cycle$/i) as HTMLSelectElement).value).toBe('cycle-jul');
    const lastCall = mockUseOvertimeReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ page: 1 }));
  });
});

describe('ReportsOvertimeReportPage — export', () => {
  afterEach(() => cleanup());

  it('triggers CSV export with the current Cycle, filters, and sort', async () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadOvertimeReportExport).toHaveBeenCalled());
    const call = mockDownloadOvertimeReportExport.mock.calls.at(-1);
    expect(call?.[0]).toEqual(expect.objectContaining({ id: 'cycle-jul' }));
    expect(call?.[1]).toEqual(expect.objectContaining({ cycleId: 'cycle-jul', rowStatus: 'HELD' }));
    expect(call?.[2]).toBe('employeeName');
    expect(call?.[3]).toBe('asc');
    expect(call?.[4]).toBe('csv');
  });

  it('triggers XLSX export', async () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export excel/i }));
    await vi.waitFor(() => expect(mockDownloadOvertimeReportExport).toHaveBeenCalled());
    expect(mockDownloadOvertimeReportExport.mock.calls.at(-1)?.[4]).toBe('xlsx');
  });

  it('disables export buttons while no data or zero rows', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport({ total: 0, rows: [] }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect((screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables both export buttons while one export is already in flight, preventing a duplicate request', async () => {
    mockDownloadOvertimeReportExport.mockClear();
    let resolveExport: (() => void) | undefined;
    mockDownloadOvertimeReportExport.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveExport = resolve; }),
    );
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const csvButton = screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement;
    const xlsxButton = screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement;
    fireEvent.click(csvButton);
    expect(csvButton.disabled).toBe(true);
    expect(xlsxButton.disabled).toBe(true);
    expect(mockDownloadOvertimeReportExport).toHaveBeenCalledTimes(1);
    resolveExport?.();
    await vi.waitFor(() => expect(csvButton.disabled).toBe(false));
    expect(mockDownloadOvertimeReportExport).toHaveBeenCalledTimes(1);
  });

  it('shows the backend structured 413 message via toast and does not crash the page', async () => {
    const { OvertimeReportExportRowLimitExceededError } = await import('@/hooks/use-overtime-report');
    mockDownloadOvertimeReportExport.mockRejectedValueOnce(
      new OvertimeReportExportRowLimitExceededError(25000, 20000, 'This export matches 25000 rows. Narrow your filters and try again.'),
    );
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadOvertimeReportExport).toHaveBeenCalled());
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('');
  });

  it('the 413 structured message is shown via toast exactly once, telling the user to narrow filters', async () => {
    const { toast } = await import('sonner');
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const { OvertimeReportExportRowLimitExceededError } = await import('@/hooks/use-overtime-report');
    mockDownloadOvertimeReportExport.mockRejectedValueOnce(
      new OvertimeReportExportRowLimitExceededError(25000, 20000, 'This export matches 25000 rows. Narrow your filters and try again.'),
    );
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadOvertimeReportExport).toHaveBeenCalled());
    await vi.waitFor(() => expect(toastErrorSpy).toHaveBeenCalledTimes(1));
    expect(toastErrorSpy).toHaveBeenCalledWith('This export matches 25000 rows. Narrow your filters and try again.');
  });

  it('CSV and XLSX exports both carry the exact same current Cycle/filters/sort — proven by comparing two separate, sequential export calls\' actual arguments; pagination is never included', async () => {
    mockDownloadOvertimeReportExport.mockClear();
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.change(screen.getByLabelText(/^has overtime$/i), { target: { value: 'YES' } });
    fireEvent.click(screen.getByRole('button', { name: /ot hours/i })); // sortBy=otHours, sortDir=asc

    const csvButton = screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement;
    const xlsxButton = screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement;

    fireEvent.click(csvButton);
    await vi.waitFor(() => expect(mockDownloadOvertimeReportExport).toHaveBeenCalledTimes(1));
    const csvCall = mockDownloadOvertimeReportExport.mock.calls.at(-1)!;
    await vi.waitFor(() => expect(xlsxButton.disabled).toBe(false));

    fireEvent.click(xlsxButton);
    await vi.waitFor(() => expect(mockDownloadOvertimeReportExport).toHaveBeenCalledTimes(2));
    const xlsxCall = mockDownloadOvertimeReportExport.mock.calls.at(-1)!;

    expect(csvCall[0]).toEqual(xlsxCall[0]);
    expect(csvCall[1]).toEqual(xlsxCall[1]);
    expect(csvCall[1]).toEqual(expect.objectContaining({ siteIds: ['site-1'], rowStatus: 'HELD', hasOvertime: true }));
    expect(csvCall[1]).not.toHaveProperty('page');
    expect(csvCall[1]).not.toHaveProperty('pageSize');
    expect(csvCall[2]).toBe(xlsxCall[2]); // sortBy
    expect(csvCall[3]).toBe(xlsxCall[3]); // sortDir
    expect(csvCall[4]).toBe('csv');
    expect(xlsxCall[4]).toBe('xlsx');

    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('HELD');
    expect((screen.getByLabelText(/^has overtime$/i) as HTMLSelectElement).value).toBe('YES');
  });

  it('export never navigates the page — the route stays exactly where the user was', async () => {
    mockDownloadOvertimeReportExport.mockClear();
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const pathBefore = window.location.pathname;

    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadOvertimeReportExport).toHaveBeenCalled());

    expect(window.location.pathname).toBe(pathBefore);
    expect(screen.getByTestId('on-screen-table')).toBeTruthy();
  });
});

describe('ReportsOvertimeReportPage — Print', () => {
  afterEach(() => cleanup());

  it('states the print scope is current page only', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(within(screen.getByRole('dialog')).getByText(/current page only/i)).toBeTruthy();
  });

  it('clicking Print opens the options dialog instead of calling window.print() immediately, defaulting to every safe column selected', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Print Options')).toBeTruthy();
    expect(screen.getByText(/11 columns selected/)).toBeTruthy();
  });

  it('never offers CNIC, banking, or correction-reason fields as print options', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.queryByText(/cnic/i)).toBeNull();
    expect(screen.queryByText(/bank/i)).toBeNull();
    expect(screen.queryByText(/iban/i)).toBeNull();
    expect(screen.queryByText(/correction reason/i)).toBeNull();
  });

  it('confirming the dialog calls window.print()', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Print Options')).toBeNull();
  });

  it('warns (readability) once the selection reaches Very Wide, without blocking Print', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    // Default selection is every column (11) — already Very Wide by this report's own threshold (10+).
    expect(screen.getByText(/many columns/i)).toBeTruthy();
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    expect((confirmButtons[confirmButtons.length - 1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('Reset to Default restores every safe field after fields were unchecked', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByLabelText('Designation'));
    expect(screen.getByText(/10 columns selected/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));
    expect(screen.getByText(/11 columns selected/)).toBeTruthy();
  });

  it('restores a previously saved field selection using this report-specific localStorage key', () => {
    window.localStorage.setItem(
      'overtime-report-print-fields:v1',
      JSON.stringify({ cards: [], columns: ['employeeName', 'rowStatus'] }),
    );
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByText('2 columns selected', { exact: false })).toBeTruthy();
  });

  it('shows the totals-unavailable explanation in print, never zeros, when totalsComputed is false', () => {
    mockUseOvertimeReportList.mockReturnValue({
      data: fullReport({ totals: totals({ totalsComputed: false, totalOtHours: null, totalOtEarnings: null }) }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId('or-totals-unavailable')).toBeTruthy();
  });

  it('the print context header states the Cycle, every filter summary — including Has Correction and Has Overtime — a generated timestamp, and "current page only"', () => {
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle: vi.fn() });
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'YES' } });
    fireEvent.change(screen.getByLabelText(/^has overtime$/i), { target: { value: 'NO' } });

    const contextText = screen.getByText(/Current page only/i).parentElement?.textContent ?? '';
    expect(contextText).toContain('July 2026');
    expect(contextText).toContain('Row Status: Held');
    expect(contextText).toContain('Has Correction: Yes');
    expect(contextText).toContain('Has Overtime: No');
    expect(contextText).toContain('Current page only');
    expect(screen.getByText(/^Generated /)).toBeTruthy();
  });

  it('the print-only totals cards render the same backend totals the on-screen cards show (present by default, not only after confirming Print)', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const printCards = within(screen.getByTestId('print-only-cards'));
    expect(printCards.getByText('Matching Work Lines')).toBeTruthy();
    expect(printCards.getByText('Total OT Hours')).toBeTruthy();
    expect(printCards.getByText('Total OT Earnings')).toBeTruthy();
  });

  it('the print-only table renders exactly the confirmed selected columns, including both work-line rows for a multi-unit employee', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const multiUnitRows: OvertimeReportRow[] = [
      row({ workLineId: 'wl-hq', unit: { id: 'unit-1', name: 'HQ', code: null } }),
      row({ workLineId: 'wl-warehouse', unit: { id: 'unit-2', name: 'Warehouse', code: null } }),
    ];
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport({ rows: multiUnitRows, total: 2 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByLabelText('Designation'));
    fireEvent.click(screen.getByLabelText('Gross Pay'));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    const printTable = within(screen.getByTestId('print-only-table'));
    expect(printTable.getByRole('columnheader', { name: 'Employee Name' })).toBeTruthy();
    expect(printTable.queryByRole('columnheader', { name: 'Designation' })).toBeNull();
    expect(printTable.queryByRole('columnheader', { name: 'Gross Pay' })).toBeNull();
    expect(printTable.getByRole('columnheader', { name: 'OT Hours' })).toBeTruthy();
    expect(printTable.getByText('HQ')).toBeTruthy();
    expect(printTable.getByText('Warehouse')).toBeTruthy();
  });

  it('opening and confirming Print never triggers an export/download request — no backend request is fired by Print', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    printSpy.mockClear();
    mockDownloadOvertimeReportExport.mockClear();
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    expect(mockDownloadOvertimeReportExport).not.toHaveBeenCalled();
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('the printed output never includes Net Salary, Total Earnings, CNIC, banking, release/audit actor, or correction-reason fields', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    const bodyText = (container.textContent ?? '').toLowerCase();
    for (const forbidden of [
      'net salary',
      'total earnings',
      'cnic',
      'account number',
      'iban',
      'bank',
      'branch code',
      'released by',
      'release actor',
      'approved by',
      'reviewed by',
      'correction reason',
    ]) {
      expect(bodyText).not.toContain(forbidden);
    }
  });
});

describe('ReportsOvertimeReportPage — accessibility', () => {
  afterEach(() => cleanup());

  it('every filter control (Cycle, Unit, Row Status, Has Correction, Has Overtime) is reachable by its own visible label', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    for (const label of [/^cycle$/i, /^unit$/i, /^row status$/i, /^has correction$/i, /^has overtime$/i]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Site' })).toBeTruthy();
  });

  it('both tri-state filters\' three values are plain, unambiguous text ("All"/"Yes"/"No") — never conveyed by color or an icon alone', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    for (const label of [/^has correction$/i, /^has overtime$/i]) {
      const select = screen.getByLabelText(label) as HTMLSelectElement;
      const optionTexts = Array.from(select.options).map((o) => o.textContent);
      expect(optionTexts).toEqual(['All', 'Yes', 'No']);
    }
  });

  it('every sortable column header exposes aria-sort="none" before any interaction, and every non-sortable header carries no aria-sort attribute at all', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));

    for (const name of [/^employee code$/i, /^project site$/i, /^unit$/i, /^ot hours$/i, /^row status$/i]) {
      const header = onScreenTable.getByRole('columnheader', { name });
      expect(header.getAttribute('aria-sort')).toBe('none');
    }
    for (const name of [/^designation$/i, /^effective ot rate$/i, /^ot earnings$/i, /^gross pay$/i, /^has correction$/i]) {
      const header = onScreenTable.getByRole('columnheader', { name });
      expect(header.hasAttribute('aria-sort')).toBe(false);
    }
  });

  it('the Print dialog exposes its own accessible name via the shared Modal\'s DialogTitle wiring', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByRole('dialog', { name: 'Print Options' })).toBeTruthy();
  });

  it('pressing Escape closes the Print dialog (the shared Modal/Radix Dialog primitive\'s own built-in behavior)', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing the Print dialog (Cancel) removes it cleanly and never traps focus on a removed element', async () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dialog.contains(document.activeElement)).toBe(false);
  });

  it('Export CSV/Export Excel expose their full accessible names, and their disabled state is exposed via the native disabled attribute, not color alone', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: fullReport({ total: 0, rows: [] }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const csvButton = screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement;
    const xlsxButton = screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement;
    expect(csvButton.disabled).toBe(true);
    expect(xlsxButton.disabled).toBe(true);
  });
});

describe('ReportsOvertimeReportPage — page clamp when the backend total shrinks', () => {
  afterEach(() => cleanup());

  function reportForPage(page: number, total: number): OvertimeReportListResponse {
    return fullReport({ page, total, pageSize: 25, rows: total === 0 ? [] : [row()] });
  }

  function renderPageWithMock(mockImpl: (params: { page: number }) => ReturnType<typeof mockUseOvertimeReportList>) {
    mockUseOvertimeReportList.mockImplementation(mockImpl);
    const queryClient = new QueryClient();
    const tree = (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reports/overtime-report']}>
          <Routes>
            <Route path="/reports/overtime-report" element={<ReportsOvertimeReportPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    return render(tree);
  }

  function lastRequestedPage(): number | undefined {
    return mockUseOvertimeReportList.mock.calls.at(-1)?.[0]?.page;
  }

  function clickNext() {
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  }

  it('leaves the current page unchanged when it is still valid for the current total', () => {
    renderPageWithMock((params) => ({
      data: reportForPage(params.page, 100),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }));
    clickNext();
    expect(lastRequestedPage()).toBe(2);
  });

  it('clamps to the new last valid page once a resolved response reports a shrunk total for the same filters', () => {
    let currentTotal = 100;
    const { rerender } = renderPageWithMock((params) => ({
      data: reportForPage(params.page, currentTotal),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }));
    clickNext();
    clickNext();
    clickNext();
    expect(lastRequestedPage()).toBe(4);

    const callsBeforeShrink = mockUseOvertimeReportList.mock.calls.length;

    currentTotal = 30;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/reports/overtime-report']}>
          <Routes>
            <Route path="/reports/overtime-report" element={<ReportsOvertimeReportPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(lastRequestedPage()).toBe(2);
    expect(mockUseOvertimeReportList.mock.calls.length).toBe(callsBeforeShrink + 2);
  });

  it('clamps to page 1 when the total becomes 0', () => {
    let currentTotal = 100;
    const { rerender } = renderPageWithMock((params) => ({
      data: reportForPage(params.page, currentTotal),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }));
    clickNext();
    clickNext();
    expect(lastRequestedPage()).toBe(3);

    currentTotal = 0;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/reports/overtime-report']}>
          <Routes>
            <Route path="/reports/overtime-report" element={<ReportsOvertimeReportPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(lastRequestedPage()).toBe(1);
  });

  it('never clamps before a resolved response exists (loading/no data is a no-op, not a crash or a reset)', () => {
    mockUseOvertimeReportList.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    expect(() => renderPage()).not.toThrow();
    expect(lastRequestedPage()).toBe(1);
  });
});
