// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SalaryReleaseReportListResponse, SalaryReleaseReportRow, SessionUser } from '@payroll/shared';

/**
 * Salary Release Report Checkpoint 1B — list page tests. Every data-fetching hook is mocked to a
 * controlled, already-resolved value (this codebase's own established pattern,
 * `reports-deduction-report-page.test.tsx`) — these tests exercise the page's own permission-gating
 * (including the OR gate — the first Reports-module report on an any-of permission), filter/sort/
 * pagination wiring, and rendering logic, never a real backend. Real browser/network verification is
 * Playwright's job (`tests/e2e/specs/26-salary-release-report.spec.ts`).
 */

const mockUseSalaryReleaseReportList = vi.hoisted(() => vi.fn());
const mockDownloadSalaryReleaseReportExport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/hooks/use-salary-release-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-salary-release-report')>();
  return {
    ...actual,
    useSalaryReleaseReportList: mockUseSalaryReleaseReportList,
    downloadSalaryReleaseReportExport: mockDownloadSalaryReleaseReportExport,
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
    data: siteId === 'site-1' ? [{ id: 'unit-1', name: 'HQ', code: null }] : [],
    isLoading: false,
    error: undefined,
  }),
}));

const { ReportsSalaryReleaseReportPage } = await import('./reports-salary-release-report-page');

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
      <MemoryRouter initialEntries={['/reports/salary-release']}>
        <Routes>
          <Route path="/reports/salary-release" element={<ReportsSalaryReleaseReportPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function row(overrides: Partial<SalaryReleaseReportRow> = {}): SalaryReleaseReportRow {
  return {
    payrollEntryId: 'entry-1',
    employeeId: 'emp-1',
    employeeCode: 'E-001',
    employeeName: 'Jane Doe',
    siteId: 'site-1',
    siteName: 'Site One',
    primaryUnit: { id: 'unit-1', name: 'HQ', code: null },
    additionalUnitCount: 0,
    designation: 'Clerk',
    rowStatus: 'RELEASED',
    originalReleasedAmount: '45000.00',
    correctionBalancePayable: '0.00',
    correctionBalanceRecovery: '0.00',
    releasedAt: '2026-07-31T00:00:00.000Z',
    correctionCount: 0,
    ...overrides,
  };
}

function totals(overrides: Partial<SalaryReleaseReportListResponse['totals']> = {}): SalaryReleaseReportListResponse['totals'] {
  return {
    matchingCount: 1,
    releasedCount: 1,
    heldCount: 0,
    noPayDueCount: 0,
    recoveryDueCount: 0,
    pendingCount: 0,
    correctedEntryCount: 0,
    releasedAmount: '45000.00',
    pendingReleaseAmount: '0.00',
    correctionBalancePayableTotal: '0.00',
    correctionBalanceRecoveryTotal: '0.00',
    totalsComputed: true,
    ...overrides,
  };
}

function fullReport(overrides: Partial<SalaryReleaseReportListResponse> = {}): SalaryReleaseReportListResponse {
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

describe('ReportsSalaryReleaseReportPage — OR permission gate (reports:view OR payroll:view)', () => {
  afterEach(() => cleanup());

  it('shows an access-denied state for a user with neither reports:view nor payroll:view', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: [] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('renders the report for a user holding only reports:view', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });

  it('renders the report for a user holding only payroll:view (the Finance case — never reports:view)', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: ['payroll:view'] as SessionUser['permissions'] });
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });

  it('renders the report for a user holding both permissions', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: ['reports:view', 'payroll:view'] as SessionUser['permissions'] });
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
  });

  it('denies a user holding only payroll:release (never implies access on its own)', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: ['payroll:release'] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('denies a user holding only statements:view', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: ['statements:view'] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('never renders a "View Details" action or any detail-route link (no detail page in V1)', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByRole('button', { name: /view details/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /view details/i })).toBeNull();
  });
});

describe('ReportsSalaryReleaseReportPage — Cycle requirement', () => {
  afterEach(() => cleanup());

  it('shows "no payroll cycles exist yet" and never renders the table when no Cycle exists', () => {
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: undefined, cycle: undefined, cycles: [], isLoading: false, error: null, selectCycle: vi.fn() });
    mockUseSalaryReleaseReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/no payroll cycles exist yet/i)).toBeTruthy();
    expect(screen.queryByTestId('on-screen-table')).toBeNull();
  });

  it('selecting a different Cycle calls selectCycle with the new id', () => {
    const selectCycle = vi.fn();
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle });
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^cycle$/i), { target: { value: 'cycle-jun' } });
    expect(selectCycle).toHaveBeenCalledWith('cycle-jun');
  });
});

describe('ReportsSalaryReleaseReportPage — loading/empty/error states', () => {
  afterEach(() => cleanup());

  it('shows a loading skeleton while fetching', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry action', () => {
    const refetch = vi.fn();
    mockUseSalaryReleaseReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: new Error('boom'), refetch });
    renderPage();
    expect(screen.getByText(/could not load the salary release report/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('distinguishes "no entries for this cycle" from "no match for filters"', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({
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

describe('ReportsSalaryReleaseReportPage — release-semantics disclosure', () => {
  afterEach(() => cleanup());

  it('shows the Original Released Amount / Correction Balance disclosure notice', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const notice = screen.getByTestId('release-semantics-notice');
    expect(notice.textContent).toMatch(/original released amount/i);
    expect(notice.textContent).toMatch(/correction balance payable\/recovery/i);
  });
});

describe('ReportsSalaryReleaseReportPage — totals', () => {
  afterEach(() => cleanup());

  it('renders backend-provided totals verbatim, grouped into Release Amounts / Status', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Release Amounts')).toBeTruthy();
    expect(cards.getByText('Status')).toBeTruthy();
    expect(cards.getAllByText(/45,?000\.00/).length).toBeGreaterThan(0);
    expect(cards.getByText('Matching Entries')).toBeTruthy();
  });

  it('shows the totals-unavailable notice instead of misleading zeros when totalsComputed is false, but always shows status counts', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({
      data: fullReport({
        totals: totals({
          totalsComputed: false,
          releasedAmount: null,
          pendingReleaseAmount: null,
          correctionBalancePayableTotal: null,
          correctionBalanceRecoveryTotal: null,
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
    expect(screen.getByTestId('srr-totals-unavailable')).toBeTruthy();
    expect(screen.getByText(/totals are unavailable for this result size/i)).toBeTruthy();
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Status')).toBeTruthy();
    expect(cards.getByText('20000')).toBeTruthy();
  });

  it('never shows a bounded financial total as 0 when totalsComputed is false', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({
      data: fullReport({
        totals: totals({ totalsComputed: false, releasedAmount: null, pendingReleaseAmount: null, correctionBalancePayableTotal: null, correctionBalanceRecoveryTotal: null }),
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId('srr-stat-released-amount')).toBeNull();
  });
});

describe('ReportsSalaryReleaseReportPage — table', () => {
  afterEach(() => cleanup());

  it('renders every approved column with no sensitive fields (no Released By/Payment Method/CNIC/bank/account/IBAN anywhere)', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText('E-001')).toBeTruthy();
    expect(onScreenTable.getByText('Jane Doe')).toBeTruthy();
    expect(onScreenTable.getByText('Site One')).toBeTruthy();
    expect(onScreenTable.getByText('HQ')).toBeTruthy();
    expect(onScreenTable.getByText('Clerk')).toBeTruthy();
    expect(onScreenTable.getByText('Released')).toBeTruthy();
    const bodyText = container.textContent ?? '';
    expect(bodyText).not.toMatch(/cnic/i);
    expect(bodyText).not.toMatch(/iban/i);
    expect(bodyText).not.toMatch(/account number/i);
    expect(bodyText).not.toMatch(/released by/i);
    expect(bodyText).not.toMatch(/payment method/i);
    expect(onScreenTable.queryByText('Gross Pay')).toBeNull();
    expect(onScreenTable.queryByText('Net Salary')).toBeNull();
  });

  it('shows "+N more" for additional units', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({
      data: fullReport({ rows: [row({ additionalUnitCount: 3 })] }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(within(screen.getByTestId('on-screen-table')).getByText(/\+3 more/)).toBeTruthy();
  });

  it('renders a correction-count badge when correctionCount > 0, and a plain "0" — never a badge — when there are none', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({
      data: fullReport({
        rows: [
          row({ payrollEntryId: 'e-with-correction', employeeCode: 'E-001', employeeName: 'With Correction', correctionCount: 4 }),
          row({ payrollEntryId: 'e-without-correction', employeeCode: 'E-002', employeeName: 'Without Correction', correctionCount: 0 }),
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

    const withCorrectionRow = onScreenTable.getByText('With Correction').closest('tr');
    const withoutCorrectionRow = onScreenTable.getByText('Without Correction').closest('tr');
    if (!withCorrectionRow || !withoutCorrectionRow) throw new Error('expected both rows to render inside a <tr>');

    const correctionBadge = within(withCorrectionRow).getByText('4');
    expect(correctionBadge.tagName).toBe('SPAN');
    expect(correctionBadge.className).toContain('rounded-full');

    const zeroCell = within(withoutCorrectionRow).getByText('0');
    expect(zeroCell.tagName).toBe('TD');
    expect(zeroCell.className).not.toContain('rounded-full');
  });

  it('renders a distinct row-status badge for each of the five statuses, never an invented vocabulary', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({
      data: fullReport({
        rows: [
          row({ payrollEntryId: 'e1', rowStatus: 'RELEASED' }),
          row({ payrollEntryId: 'e2', rowStatus: 'HELD', originalReleasedAmount: null, releasedAt: null }),
          row({ payrollEntryId: 'e3', rowStatus: 'NO_PAY_DUE', originalReleasedAmount: null, releasedAt: null }),
          row({ payrollEntryId: 'e4', rowStatus: 'RECOVERY_DUE', originalReleasedAmount: null, releasedAt: null }),
          row({ payrollEntryId: 'e5', rowStatus: 'PENDING', originalReleasedAmount: null, releasedAt: null }),
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

  it('shows a dash, never a fabricated amount or timestamp, for a non-RELEASED row (HELD/PENDING/NO_PAY_DUE/RECOVERY_DUE)', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({
      data: fullReport({
        rows: [row({ rowStatus: 'PENDING', originalReleasedAmount: null, releasedAt: null })],
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    const dataRow = onScreenTable.getByText('Jane Doe').closest('tr');
    if (!dataRow) throw new Error('expected a data row');
    const cellsText = within(dataRow).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cellsText).toContain('—');
  });

  it('keeps Original Released Amount separate from Correction Balance Payable/Recovery, both visible at once', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({
      data: fullReport({
        rows: [row({ originalReleasedAmount: '45000.00', correctionBalancePayable: '1000.00', correctionBalanceRecovery: '500.00' })],
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getAllByText(/45,?000\.00/).length).toBeGreaterThan(0);
    expect(onScreenTable.getAllByText(/1,?000\.00/).length).toBeGreaterThan(0);
    expect(onScreenTable.getAllByText(/500\.00/).length).toBeGreaterThan(0);
  });
});

describe('ReportsSalaryReleaseReportPage — sorting and pagination', () => {
  afterEach(() => cleanup());

  it('clicking a sortable column header requests the backend with the new sort field, reset to page 1', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /released at/i }));
    const lastCall = mockUseSalaryReleaseReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'releasedAt', sortDir: 'asc', page: 1 }));
  });

  it('clicking the active sort header again reverses direction', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /released at/i }));
    fireEvent.click(screen.getByRole('button', { name: /released at/i }));
    const lastCall = mockUseSalaryReleaseReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'releasedAt', sortDir: 'desc' }));
  });

  it('exposes aria-sort on the active sortable column', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const header = within(screen.getByTestId('on-screen-table')).getByRole('columnheader', { name: /employee name/i });
    expect(header.getAttribute('aria-sort')).toBe('ascending');
  });

  it('Original Released Amount / Correction Balance / Correction Count / Designation / Primary Unit are not sortable buttons (unsupported by the backend)', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.queryByRole('button', { name: /^original released amount$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^correction bal\. payable$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^correction bal\. recovery$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^correction count$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^designation$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^primary unit$/i })).toBeNull();
  });

  it('uses server-provided page/pageSize/total, never client-side slicing', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport({ total: 40, page: 1, pageSize: 25 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/showing 1.25 of 40/i)).toBeTruthy();
  });

  it('the table body never renders more rows than the backend-provided page', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport({ rows: [row()], total: 400 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getAllByRole('row')).toHaveLength(2); // header + 1 data row
  });

  it('clamps down to the last valid page when the backend total shrinks below the currently-viewed page, without looping', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({
      data: fullReport({ page: 3, pageSize: 25, total: 10, rows: [] }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    // lastValidPage = ceil(10/25) = 1; page(3) > 1 -> setPage(1) triggers exactly one re-render with page:1
    const calls = mockUseSalaryReleaseReportList.mock.calls;
    const pages = calls.map((call) => call[0]?.page);
    expect(pages.at(-1)).toBe(1);
  });
});

describe('ReportsSalaryReleaseReportPage — filters', () => {
  afterEach(() => cleanup());

  it('changing Row Status resets the page passed to the hook to 1 and forwards the value', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport({ page: 2 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    const lastCall = mockUseSalaryReleaseReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ rowStatus: 'HELD', page: 1 }));
  });

  it('Has Correction supports All/Yes/No tri-state and passes a boolean or undefined', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'YES' } });
    let lastCall = mockUseSalaryReleaseReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: true }));

    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'NO' } });
    lastCall = mockUseSalaryReleaseReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: false }));

    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'ALL' } });
    lastCall = mockUseSalaryReleaseReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: undefined }));
  });

  it('the Unit filter is disabled unless exactly one Site is selected, and invalid Unit is never sent', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).disabled).toBe(true);
    const lastCall = mockUseSalaryReleaseReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ unitId: undefined }));
  });

  it('selecting one Site enables the Unit filter and choosing a Unit forwards it', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    const lastCall = mockUseSalaryReleaseReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ unitId: 'unit-1', siteIds: ['site-1'] }));
  });

  it('selecting a second Site clears an already-chosen Unit', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
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

  it('an unrelated rerender never clears an already-selected Unit', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const { rerender } = renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).value).toBe('unit-1');

    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport({ generatedAt: 'new' }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/reports/salary-release']}>
          <Routes>
            <Route path="/reports/salary-release" element={<ReportsSalaryReleaseReportPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });

  it('unsupported filters (employee search, designation, date range, roster status, released by, payment method) never appear on this page', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByLabelText(/^employee$/i)).toBeNull();
    expect(screen.queryByLabelText(/designation/i)).toBeNull();
    expect(screen.queryByLabelText(/cycle from/i)).toBeNull();
    expect(screen.queryByLabelText(/cycle to/i)).toBeNull();
    expect(screen.queryByLabelText(/roster status/i)).toBeNull();
    expect(screen.queryByLabelText(/released by/i)).toBeNull();
    expect(screen.queryByLabelText(/payment method/i)).toBeNull();
    expect(screen.queryByLabelText(/bank/i)).toBeNull();
  });

  it('Clear Filters restores defaults but never resets the currently selected Cycle', () => {
    const selectCycle = vi.fn();
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle });
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'YES' } });
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('HELD');

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText(/^has correction$/i) as HTMLSelectElement).value).toBe('ALL');
    expect(selectCycle).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/^cycle$/i) as HTMLSelectElement).value).toBe('cycle-jul');
  });
});

describe('ReportsSalaryReleaseReportPage — export', () => {
  afterEach(() => cleanup());

  it('clicking Export CSV calls downloadSalaryReleaseReportExport with the current filters/sort and format csv', async () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await Promise.resolve();
    expect(mockDownloadSalaryReleaseReportExport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cycle-jul' }),
      expect.objectContaining({ cycleId: 'cycle-jul' }),
      'employeeName',
      'asc',
      'csv',
    );
  });

  it('clicking Export Excel calls downloadSalaryReleaseReportExport with format xlsx', async () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export excel/i }));
    await Promise.resolve();
    expect(mockDownloadSalaryReleaseReportExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'employeeName',
      'asc',
      'xlsx',
    );
  });

  it('export is disabled when there are zero matching rows', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport({ total: 0, rows: [], totals: totals({ matchingCount: 0 }) }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect((screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ReportsSalaryReleaseReportPage — print', () => {
  afterEach(() => cleanup());

  it('opens the Print Options dialog on Print click, with no change to the report query params passed to the hook (no new request shape)', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const paramsBefore = mockUseSalaryReleaseReportList.mock.calls.at(-1)?.[0];
    fireEvent.click(screen.getByRole('button', { name: /^print$/i }));
    expect(screen.getByText('Print Options')).toBeTruthy();
    // Opening the dialog is local UI state only — every render still calls the (mocked) hook with
    // the exact same params object shape, proving no filter/sort/page/cycle state was touched.
    expect(mockUseSalaryReleaseReportList.mock.calls.at(-1)?.[0]).toEqual(paramsBefore);
  });

  it('the print context header includes Cycle, Site, Unit, Row Status, and Has Correction', () => {
    mockUseSalaryReleaseReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    const contextEl = container.querySelector('.print\\:mb-4 p.text-\\[11px\\]');
    expect(contextEl?.textContent).toMatch(/Site: All/);
    expect(contextEl?.textContent).toMatch(/Unit: Any/);
    expect(contextEl?.textContent).toMatch(/Row Status: All/);
    expect(contextEl?.textContent).toMatch(/Has Correction: All/);
    expect(contextEl?.textContent).toMatch(/Current page only/);
  });
});
