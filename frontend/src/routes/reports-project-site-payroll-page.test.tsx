// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectSitePayrollReportListResponse, ProjectSitePayrollReportRow, SessionUser } from '@payroll/shared';

/**
 * Project Site Payroll Report Checkpoint 1B — list page tests. Every data-fetching hook is mocked to
 * a controlled, already-resolved value (this codebase's own established pattern,
 * `reports-payroll-summary-page.test.tsx`/`reports-employee-payroll-history-page.test.tsx`) — these
 * tests exercise the page's own permission-gating, filter/sort/pagination wiring, and rendering
 * logic, never a real backend. Real browser/network verification is Playwright's job
 * (`tests/e2e/specs/20-project-site-payroll-report.spec.ts`).
 */

const mockUseProjectSitePayrollReportList = vi.hoisted(() => vi.fn());
const mockDownloadProjectSitePayrollReportExport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/hooks/use-project-site-payroll-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-project-site-payroll-report')>();
  return {
    ...actual,
    useProjectSitePayrollReportList: mockUseProjectSitePayrollReportList,
    downloadProjectSitePayrollReportExport: mockDownloadProjectSitePayrollReportExport,
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

const { ReportsProjectSitePayrollPage } = await import('./reports-project-site-payroll-page');

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
      <MemoryRouter initialEntries={['/reports/project-site-payroll']}>
        <Routes>
          <Route path="/reports/project-site-payroll" element={<ReportsProjectSitePayrollPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function row(overrides: Partial<ProjectSitePayrollReportRow> = {}): ProjectSitePayrollReportRow {
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
    grossPay: '60000.00',
    allowance: '0.00',
    eobiDeduction: '800.00',
    advanceDeduction: '0.00',
    eidAdvanceDeduction: '0.00',
    fine: '0.00',
    correctionBalancePayable: '0.00',
    correctionBalanceRecovery: '0.00',
    totalEarnings: '60000.00',
    totalDeductions: '800.00',
    netSalary: '59200.00',
    rowStatus: 'RELEASED',
    correctionCount: 0,
    releasedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

function totals(overrides: Partial<ProjectSitePayrollReportListResponse['totals']> = {}): ProjectSitePayrollReportListResponse['totals'] {
  return {
    matchingCount: 1,
    releasedCount: 1,
    heldCount: 0,
    noPayDueCount: 0,
    recoveryDueCount: 0,
    pendingCount: 0,
    correctedEntryCount: 0,
    grossPay: '60000.00',
    allowance: '0.00',
    eobiDeduction: '800.00',
    advanceDeduction: '0.00',
    eidAdvanceDeduction: '0.00',
    fine: '0.00',
    correctionBalancePayable: '0.00',
    correctionBalanceRecovery: '0.00',
    totalEarnings: '60000.00',
    totalDeductions: '800.00',
    netSalaryTotal: '59200.00',
    totalsComputed: true,
    ...overrides,
  };
}

function fullReport(overrides: Partial<ProjectSitePayrollReportListResponse> = {}): ProjectSitePayrollReportListResponse {
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

describe('ReportsProjectSitePayrollPage — RBAC', () => {
  afterEach(() => cleanup());

  it('shows an access-denied state for a user without reports:view', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: [] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('renders the report for a user holding reports:view', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });

  it('never renders a "View Details" action or any detail-route link (no detail page in V1)', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByRole('button', { name: /view details/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /view details/i })).toBeNull();
  });
});

describe('ReportsProjectSitePayrollPage — Cycle requirement', () => {
  afterEach(() => cleanup());

  it('shows "no payroll cycles exist yet" and never renders the table when no Cycle exists', () => {
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: undefined, cycle: undefined, cycles: [], isLoading: false, error: null, selectCycle: vi.fn() });
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/no payroll cycles exist yet/i)).toBeTruthy();
    expect(screen.queryByTestId('on-screen-table')).toBeNull();
  });

  it('selecting a different Cycle calls selectCycle with the new id', () => {
    const selectCycle = vi.fn();
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle });
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^cycle$/i), { target: { value: 'cycle-jun' } });
    expect(selectCycle).toHaveBeenCalledWith('cycle-jun');
  });
});

describe('ReportsProjectSitePayrollPage — loading/empty/error states', () => {
  afterEach(() => cleanup());

  it('shows a loading skeleton while fetching', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry action', () => {
    const refetch = vi.fn();
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: new Error('boom'), refetch });
    renderPage();
    expect(screen.getByText(/could not load the project site payroll report/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('distinguishes "no entries for this cycle" from "no match for filters"', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({
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

describe('ReportsProjectSitePayrollPage — totals', () => {
  afterEach(() => cleanup());

  it('renders backend-provided totals verbatim, grouped into Payroll Totals / Deductions and Adjustments / Status Counts', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Payroll Totals')).toBeTruthy();
    expect(cards.getByText('Deductions and Adjustments')).toBeTruthy();
    expect(cards.getByText('Status Counts')).toBeTruthy();
    expect(cards.getAllByText(/59,200\.00/).length).toBeGreaterThan(0);
    expect(cards.getByText('Matching Entries')).toBeTruthy();
  });

  it('shows the totals-unavailable notice instead of misleading zeros when totalsComputed is false, but always shows status counts', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({
      data: fullReport({
        totals: totals({
          totalsComputed: false,
          grossPay: null,
          allowance: null,
          eobiDeduction: null,
          advanceDeduction: null,
          eidAdvanceDeduction: null,
          fine: null,
          correctionBalancePayable: null,
          correctionBalanceRecovery: null,
          totalEarnings: null,
          totalDeductions: null,
          netSalaryTotal: null,
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
    expect(screen.getByTestId('psp-totals-unavailable')).toBeTruthy();
    expect(screen.getByText(/totals are unavailable for this result size/i)).toBeTruthy();
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Status Counts')).toBeTruthy();
    expect(cards.getByText('20000')).toBeTruthy();
    // Deductions and Adjustments group is entirely monetary — hidden while unavailable.
    expect(cards.queryByText('Deductions and Adjustments')).toBeNull();
  });
});

describe('ReportsProjectSitePayrollPage — table', () => {
  afterEach(() => cleanup());

  it('renders every approved column with no sensitive fields (no CNIC/bank/account/IBAN anywhere)', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText('E-001')).toBeTruthy();
    expect(onScreenTable.getByText('Jane Doe')).toBeTruthy();
    expect(onScreenTable.getByText('Site One')).toBeTruthy();
    expect(onScreenTable.getByText('HQ')).toBeTruthy();
    expect(onScreenTable.getByText('Clerk')).toBeTruthy();
    expect(onScreenTable.getAllByText(/59,200\.00/).length).toBeGreaterThan(0);
    expect(onScreenTable.getByText('Released')).toBeTruthy();
    const bodyText = container.textContent ?? '';
    expect(bodyText).not.toMatch(/cnic/i);
    expect(bodyText).not.toMatch(/iban/i);
    expect(bodyText).not.toMatch(/account number/i);
  });

  it('shows "+N more" for additional units', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({
      data: fullReport({ rows: [row({ additionalUnitCount: 3 })] }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(within(screen.getByTestId('on-screen-table')).getByText(/\+3 more/)).toBeTruthy();
  });

  it('renders a correction-count badge when correctionCount > 0, and a plain "0" — never a badge — when there are none, with the row otherwise visible and correct', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({
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

    // correctionCount > 0 renders the count inside a Badge (a <span>), never as bare text.
    const correctionBadge = within(withCorrectionRow).getByText('4');
    expect(correctionBadge.tagName).toBe('SPAN');
    expect(correctionBadge.className).toContain('rounded-full');

    // correctionCount === 0 renders a plain "0" — the nearest matching element is the <td> itself,
    // never a <span>/Badge — and the rest of the row remains visible and correct alongside it.
    const zeroCell = within(withoutCorrectionRow).getByText('0');
    expect(zeroCell.tagName).toBe('TD');
    expect(zeroCell.className).not.toContain('rounded-full');
    expect(within(withoutCorrectionRow).getByText('E-002')).toBeTruthy();
    expect(within(withoutCorrectionRow).getByText('Without Correction')).toBeTruthy();
    expect(within(withoutCorrectionRow).getByText('Released')).toBeTruthy();
  });

  it('renders a distinct row-status badge for each of the five statuses', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({
      data: fullReport({
        rows: [
          row({ payrollEntryId: 'e1', rowStatus: 'RELEASED' }),
          row({ payrollEntryId: 'e2', rowStatus: 'HELD' }),
          row({ payrollEntryId: 'e3', rowStatus: 'NO_PAY_DUE' }),
          row({ payrollEntryId: 'e4', rowStatus: 'RECOVERY_DUE' }),
          row({ payrollEntryId: 'e5', rowStatus: 'PENDING' }),
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

describe('ReportsProjectSitePayrollPage — sorting and pagination', () => {
  afterEach(() => cleanup());

  it('clicking a sortable column header requests the backend with the new sort field, reset to page 1', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /net salary/i }));
    const lastCall = mockUseProjectSitePayrollReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'netSalary', sortDir: 'asc', page: 1 }));
  });

  it('clicking the active sort header again reverses direction', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /net salary/i }));
    fireEvent.click(screen.getByRole('button', { name: /net salary/i }));
    const lastCall = mockUseProjectSitePayrollReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'netSalary', sortDir: 'desc' }));
  });

  it('exposes aria-sort on the active sortable column', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const header = within(screen.getByTestId('on-screen-table')).getByRole('columnheader', { name: /employee name/i });
    expect(header.getAttribute('aria-sort')).toBe('ascending');
  });

  it('uses server-provided page/pageSize/total, never client-side slicing', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport({ total: 40, page: 1, pageSize: 25 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/showing 1.25 of 40/i)).toBeTruthy();
  });

  it('the table body never renders more rows than the backend-provided page', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport({ rows: [row()], total: 400 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getAllByRole('row')).toHaveLength(2); // header + 1 data row
  });
});

describe('ReportsProjectSitePayrollPage — filters', () => {
  afterEach(() => cleanup());

  it('changing Row Status resets the page passed to the hook to 1 and forwards the value', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport({ page: 2 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    const lastCall = mockUseProjectSitePayrollReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ rowStatus: 'HELD', page: 1 }));
  });

  it('Has Correction supports All/Yes/No tri-state and passes a boolean or undefined', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/has correction/i), { target: { value: 'YES' } });
    let lastCall = mockUseProjectSitePayrollReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: true }));

    fireEvent.change(screen.getByLabelText(/has correction/i), { target: { value: 'NO' } });
    lastCall = mockUseProjectSitePayrollReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: false }));

    fireEvent.change(screen.getByLabelText(/has correction/i), { target: { value: 'ALL' } });
    lastCall = mockUseProjectSitePayrollReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: undefined }));
  });

  it('the Unit filter is disabled unless exactly one Site is selected, and invalid Unit is never sent', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    // No Site selected yet — the field falls back to the generic "Unit" label (no single Site's
    // own `unitLabel` to show).
    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).disabled).toBe(true);
    const lastCall = mockUseProjectSitePayrollReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ unitId: undefined }));
  });

  it('selecting one Site enables the Unit filter and choosing a Unit forwards it', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    const lastCall = mockUseProjectSitePayrollReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ unitId: 'unit-1', siteIds: ['site-1'] }));
  });

  it('selecting a second Site clears an already-chosen Unit', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).value).toBe('unit-1');

    // The Site filter's trigger button is labelled by its own associated <label> ("Site"), which
    // the accessible-name algorithm uses in place of the trigger's own changing visible text — its
    // accessible name stays "Site" throughout, regardless of what's currently selected.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site Two' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    // Two Sites are now selected — the field reverts to the generic "Unit" label.
    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).disabled).toBe(true);
  });

  it('unsupported filters (employee search, designation, date range) never appear on this page', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByLabelText(/employee/i)).toBeNull();
    expect(screen.queryByLabelText(/designation/i)).toBeNull();
    expect(screen.queryByLabelText(/cycle from/i)).toBeNull();
    expect(screen.queryByLabelText(/cycle to/i)).toBeNull();
    expect(screen.queryByLabelText(/roster status/i)).toBeNull();
  });

  it('Clear Filters restores defaults but never resets the currently selected Cycle', () => {
    const selectCycle = vi.fn();
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle });
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('HELD');

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('');
    expect(selectCycle).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/^cycle$/i) as HTMLSelectElement).value).toBe('cycle-jul');
  });
});

describe('ReportsProjectSitePayrollPage — export', () => {
  afterEach(() => cleanup());

  it('triggers CSV export with the current Cycle, filters, and sort', async () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadProjectSitePayrollReportExport).toHaveBeenCalled());
    const call = mockDownloadProjectSitePayrollReportExport.mock.calls.at(-1);
    expect(call?.[0]).toEqual(expect.objectContaining({ id: 'cycle-jul' }));
    expect(call?.[1]).toEqual(expect.objectContaining({ cycleId: 'cycle-jul', rowStatus: 'HELD' }));
    expect(call?.[2]).toBe('employeeName');
    expect(call?.[3]).toBe('asc');
    expect(call?.[4]).toBe('csv');
  });

  it('triggers XLSX export', async () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export excel/i }));
    await vi.waitFor(() => expect(mockDownloadProjectSitePayrollReportExport).toHaveBeenCalled());
    expect(mockDownloadProjectSitePayrollReportExport.mock.calls.at(-1)?.[4]).toBe('xlsx');
  });

  it('disables export buttons while no data or zero rows', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport({ total: 0, rows: [] }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect((screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables both export buttons while one export is already in flight, preventing a duplicate request', async () => {
    // This mock's call history persists across tests in this file (no `clearMocks` in
    // `vitest.config.ts`, matching `reports-payroll-summary-page.test.tsx`'s own documented
    // behavior) — cleared here so this test's own count is unambiguous.
    mockDownloadProjectSitePayrollReportExport.mockClear();
    let resolveExport: (() => void) | undefined;
    mockDownloadProjectSitePayrollReportExport.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveExport = resolve; }),
    );
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const csvButton = screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement;
    const xlsxButton = screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement;
    fireEvent.click(csvButton);
    // The in-flight export disables both buttons (the page's own `activeExport` guard) —
    // proving a second click, real or synthetic, can never start a duplicate request.
    expect(csvButton.disabled).toBe(true);
    expect(xlsxButton.disabled).toBe(true);
    expect(mockDownloadProjectSitePayrollReportExport).toHaveBeenCalledTimes(1);
    resolveExport?.();
    await vi.waitFor(() => expect(csvButton.disabled).toBe(false));
    expect(mockDownloadProjectSitePayrollReportExport).toHaveBeenCalledTimes(1);
  });

  it('shows the backend structured 413 message via toast and does not crash the page', async () => {
    const { ProjectSitePayrollReportExportRowLimitExceededError } = await import('@/hooks/use-project-site-payroll-report');
    mockDownloadProjectSitePayrollReportExport.mockRejectedValueOnce(
      new ProjectSitePayrollReportExportRowLimitExceededError(25000, 20000, 'This export matches 25000 rows. Narrow your filters and try again.'),
    );
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadProjectSitePayrollReportExport).toHaveBeenCalled());
    // Filters remain exactly as they were — the export failure never resets page state.
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('');
  });
});

describe('ReportsProjectSitePayrollPage — Print', () => {
  afterEach(() => cleanup());

  it('states the print scope is current page only', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(within(screen.getByRole('dialog')).getByText(/current page only/i)).toBeTruthy();
  });

  it('clicking Print opens the options dialog instead of calling window.print() immediately, defaulting to every safe column selected', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Print Options')).toBeTruthy();
    expect(screen.getByText(/19 columns selected/)).toBeTruthy();
  });

  it('never offers CNIC or banking fields as print options', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.queryByText(/cnic/i)).toBeNull();
    expect(screen.queryByText(/bank/i)).toBeNull();
    expect(screen.queryByText(/iban/i)).toBeNull();
  });

  it('confirming the dialog calls window.print()', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Print Options')).toBeNull();
  });

  it('warns (readability) once the selection reaches Very Wide, without blocking Print', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    // Default selection is every column (19) — already Very Wide by this report's own threshold (16+).
    expect(screen.getByText(/many columns/i)).toBeTruthy();
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    expect((confirmButtons[confirmButtons.length - 1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('Reset to Default restores every safe field after fields were unchecked', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByLabelText('Designation'));
    expect(screen.getByText(/18 columns selected/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));
    expect(screen.getByText(/19 columns selected/)).toBeTruthy();
  });

  it('restores a previously saved field selection using this report-specific localStorage key', () => {
    window.localStorage.setItem(
      'project-site-payroll-print-fields:v1',
      JSON.stringify({ cards: [], columns: ['employeeName', 'netSalary'] }),
    );
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByText('2 columns selected', { exact: false })).toBeTruthy();
  });

  it('shows the totals-unavailable explanation in print, never zeros, when totalsComputed is false', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({
      data: fullReport({ totals: totals({ totalsComputed: false, grossPay: null, netSalaryTotal: null }) }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId('psp-totals-unavailable')).toBeTruthy();
  });
});

describe('ReportsProjectSitePayrollPage — page clamp when the backend total shrinks', () => {
  afterEach(() => cleanup());

  /** A resolved response that echoes back whatever `page` was actually requested (matching a real
   * paginated backend, which never silently rewrites an out-of-range page number itself — see
   * `reports.md` §16.7's own "an out-of-range pageSize correctly rejected with 400 — never
   * clamped" precedent for `pageSize`; a `page` beyond the last valid page still resolves normally,
   * just with fewer/zero rows, which is exactly the shape this safeguard reacts to). */
  function reportForPage(page: number, total: number): ProjectSitePayrollReportListResponse {
    return fullReport({ page, total, pageSize: 25, rows: total === 0 ? [] : [row()] });
  }

  function renderPageWithMock(mockImpl: (params: { page: number }) => ReturnType<typeof mockUseProjectSitePayrollReportList>) {
    mockUseProjectSitePayrollReportList.mockImplementation(mockImpl);
    const queryClient = new QueryClient();
    const tree = (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reports/project-site-payroll']}>
          <Routes>
            <Route path="/reports/project-site-payroll" element={<ReportsProjectSitePayrollPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    return render(tree);
  }

  function lastRequestedPage(): number | undefined {
    return mockUseProjectSitePayrollReportList.mock.calls.at(-1)?.[0]?.page;
  }

  function clickNext() {
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  }

  it('leaves the current page unchanged when it is still valid for the current total', () => {
    // 100 rows / 25 per page = 4 valid pages throughout — page 2 is always in range.
    renderPageWithMock((params) => ({
      data: reportForPage(params.page, 100),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }));
    clickNext(); // page 1 -> 2
    expect(lastRequestedPage()).toBe(2);
    // Settled — no further clamp fires for an already-valid page.
    expect(lastRequestedPage()).toBe(2);
  });

  it('clamps to the new last valid page once a resolved response reports a shrunk total for the same filters', () => {
    let currentTotal = 100; // 4 pages while navigating up to page 4
    const { rerender } = renderPageWithMock((params) => ({
      data: reportForPage(params.page, currentTotal),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }));
    clickNext(); // 1 -> 2
    clickNext(); // 2 -> 3
    clickNext(); // 3 -> 4
    expect(lastRequestedPage()).toBe(4);

    const callsBeforeShrink = mockUseProjectSitePayrollReportList.mock.calls.length;

    // Simulate the backend total shrinking for the *same* filters/page (e.g. rows released/held by
    // another user) — a background refetch of the same page:4 key now resolves with a total whose
    // last valid page (2) is below the page currently being viewed (4). Re-render (no prop/filter
    // change) so the component reads the updated total the mock now returns for page 4.
    currentTotal = 30; // 2 pages
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/reports/project-site-payroll']}>
          <Routes>
            <Route path="/reports/project-site-payroll" element={<ReportsProjectSitePayrollPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(lastRequestedPage()).toBe(2);
    // Exactly two additional hook invocations: the re-render itself (page 4, now-shrunk total) and
    // the one corrective `setPage(2)` it triggers — proves this settles, it does not loop/storm.
    expect(mockUseProjectSitePayrollReportList.mock.calls.length).toBe(callsBeforeShrink + 2);
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
    clickNext(); // 1 -> 2
    clickNext(); // 2 -> 3
    expect(lastRequestedPage()).toBe(3);

    currentTotal = 0;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/reports/project-site-payroll']}>
          <Routes>
            <Route path="/reports/project-site-payroll" element={<ReportsProjectSitePayrollPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(lastRequestedPage()).toBe(1);
  });

  it('never clamps before a resolved response exists (loading/no data is a no-op, not a crash or a reset)', () => {
    mockUseProjectSitePayrollReportList.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    expect(() => renderPage()).not.toThrow();
    expect(lastRequestedPage()).toBe(1);
  });
});
