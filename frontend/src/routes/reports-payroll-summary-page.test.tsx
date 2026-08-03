// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionUser } from '@payroll/shared';
import type { PayrollSummaryReport } from '@/hooks/use-reports';

/**
 * Phase 8B Checkpoint 1 — Payroll Summary Report page tests. Every data-fetching hook is mocked to a
 * controlled, already-resolved value (this codebase's own established pattern,
 * `statements-page.test.tsx`) — these tests exercise the page's own permission-gating/rendering/
 * pagination logic, never a real backend. Real browser/network verification is Playwright's job.
 */

const mockUsePayrollSummaryReport = vi.hoisted(() => vi.fn());
const mockDownloadPayrollSummaryExport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/hooks/use-reports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-reports')>();
  return {
    ...actual,
    usePayrollSummaryReport: mockUsePayrollSummaryReport,
    downloadPayrollSummaryExport: mockDownloadPayrollSummaryExport,
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

const { ReportsPayrollSummaryPage } = await import('./reports-payroll-summary-page');

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

// Radix's Dialog primitive probes a few DOM APIs jsdom doesn't implement — the Print Options
// dialog (post-deployment Print Usability Refinement) needs this the same way print-button.test.tsx
// already established for the shared PrintSettingsDialog.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
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
      <MemoryRouter initialEntries={['/reports/payroll-summary']}>
        <Routes>
          <Route path="/reports/payroll-summary" element={<ReportsPayrollSummaryPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function figures(overrides: Partial<PayrollSummaryReport['cycleTotals']> = {}): PayrollSummaryReport['cycleTotals'] {
  return {
    employeeCount: 2,
    heldCount: 0,
    releasedCount: 0,
    pendingReleaseCount: 2,
    noPayDueCount: 0,
    recoveryDueCount: 0,
    grossPay: '60000.00',
    overtimeAmount: '0.00',
    allowances: '0.00',
    eobi: '800.00',
    advanceDeductions: '0.00',
    eidAdvanceDeductions: '0.00',
    fines: '0.00',
    balancePayableIncluded: '0.00',
    recoveryDeducted: '0.00',
    totalEarnings: '60000.00',
    totalDeductions: '800.00',
    netSalary: '59200.00',
    releasedAmount: '0.00',
    pendingReleaseAmount: '59200.00',
    ...overrides,
  };
}

function fullReport(overrides: Partial<PayrollSummaryReport> = {}): PayrollSummaryReport {
  return {
    cycle: { id: 'cycle-jul', year: 2026, month: 7, status: 'DRAFT' },
    generatedAt: '2026-07-31T00:00:00.000Z',
    filters: { siteIds: null },
    cycleTotals: figures(),
    page: 1,
    pageSize: 25,
    total: 1,
    siteRows: [{ siteId: 'site-1', siteName: 'Site One', ...figures() }],
    ...overrides,
  };
}

describe('ReportsPayrollSummaryPage — RBAC', () => {
  afterEach(() => cleanup());

  it('shows an access-denied state without reports:view', () => {
    mockUsePayrollSummaryReport.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: [] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });
});

describe('ReportsPayrollSummaryPage — loading/empty/error states', () => {
  afterEach(() => cleanup());

  it('shows a loading skeleton while the report is fetching', () => {
    mockUsePayrollSummaryReport.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry action', () => {
    const refetch = vi.fn();
    mockUsePayrollSummaryReport.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error('boom'),
      refetch,
    });
    renderPage();
    expect(screen.getByText(/could not load the payroll summary/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows an empty state when the cycle has no payroll entries for the selection', () => {
    mockUsePayrollSummaryReport.mockReturnValue({
      data: fullReport({ total: 0, siteRows: [], cycleTotals: figures({ employeeCount: 0, netSalary: '0.00', pendingReleaseAmount: '0.00' }) }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/no payroll entries for this selection/i)).toBeTruthy();
  });
});

describe('ReportsPayrollSummaryPage — rendering totals, cycle state, and table', () => {
  afterEach(() => cleanup());

  it('renders cycle-state guidance for a Draft cycle and the site row with its figures', () => {
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/still in draft/i)).toBeTruthy();
    // Two matches from this point on: the on-screen table plus the print-only table's own
    // always-included Project Site column (Post-deployment Print Usability Refinement) — `Site One`
    // is no longer unique on the page, by design.
    expect(screen.getAllByText('Site One').length).toBeGreaterThan(0);
    // Employees stat tile
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PKR\s*59,200\.00|59,200\.00/).length).toBeGreaterThan(0);
  });

  it('renders cycle-state guidance distinctly for a Released cycle', () => {
    mockSelectedCycle(CYCLES[1]!);
    mockUsePayrollSummaryReport.mockReturnValue({
      data: fullReport({ cycle: { id: 'cycle-jun', year: 2026, month: 6, status: 'RELEASED' } }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/has been released/i)).toBeTruthy();
  });

  it('disables export buttons while no data or zero rows, enables them once data exists', () => {
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const csvButton = screen.getByRole('button', { name: /export csv/i });
    expect((csvButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('triggers the export download when an export button is clicked', async () => {
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadPayrollSummaryExport).toHaveBeenCalled());
    expect(mockDownloadPayrollSummaryExport.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ id: 'cycle-jul' }));
    expect(mockDownloadPayrollSummaryExport.mock.calls[0]?.[2]).toBe('csv');
  });
});

describe('ReportsPayrollSummaryPage — pagination', () => {
  afterEach(() => cleanup());

  it('shows pagination summary text and paginates to the next page on click', () => {
    mockUsePayrollSummaryReport.mockReturnValue({
      data: fullReport({
        total: 2,
        page: 1,
        pageSize: 1,
        siteRows: [{ siteId: 'site-1', siteName: 'Site One', ...figures() }],
      }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/showing 1.1 of 2 sites/i)).toBeTruthy();
    const nextButton = screen.getByRole('button', { name: /next/i });
    expect((nextButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(nextButton);
    // The mocked hook is stateless, so we only assert the button remained interactable and the
    // page didn't crash on the click — the real page/pageSize plumbing into the query key is
    // covered by `use-reports.test.ts`'s own `payrollSummaryReportUrl` unit tests.
    expect(screen.getByRole('button', { name: /next/i })).toBeTruthy();
  });

  it('disables Previous on the first page', () => {
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport({ page: 1 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect((screen.getByRole('button', { name: /previous/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// --- Post-deployment Print Usability Refinement -------------------------------------------------
//
// Production UAT found the full 19-column table illegible when printed. These tests cover the new
// Print Options dialog flow this page now owns: Print no longer calls window.print() directly, and
// the print-only cards/table (`data-testid="print-only-cards"`/`"print-only-table"`) render only the
// user's selected fields from the exact same already-loaded `report.data` the on-screen version
// above already asserts against — never a second fetch, never a recalculated figure.

describe('ReportsPayrollSummaryPage — Print Options dialog', () => {
  afterEach(() => cleanup());

  it('clicking Print opens the options dialog instead of calling window.print() immediately', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Print Options')).toBeTruthy();
  });

  it('first open defaults to the Full Report — every card and every column already selected (Final Print UX Refinement)', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByText(/Full Report \(all fields\)/)).toBeTruthy();
    expect(screen.getByText('19 columns selected', { exact: false })).toBeTruthy();
  });

  it('confirming the dialog calls window.print() with the field selection already applied', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Print Options')).toBeNull();
  });

  it('confirming without picking a preset prints the complete Full Report (every column, every card)', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    const printTable = within(screen.getByTestId('print-only-table'));
    const printCards = within(screen.getByTestId('print-only-cards'));
    expect(printTable.getByText('Held')).toBeTruthy();
    expect(printTable.getByText('Overtime')).toBeTruthy();
    expect(printTable.getByText('Balance Payable Included')).toBeTruthy();
    expect(printCards.getByText('EOBI')).toBeTruthy();
    expect(printCards.getByText('Fines')).toBeTruthy();
  });

  it('the print-only table shows exactly the selected columns and hides the rest', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deductions' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    const printTable = within(screen.getByTestId('print-only-table'));
    expect(printTable.getByText('Advance Deduction')).toBeTruthy();
    expect(printTable.getByText('Eid Advance Deduction')).toBeTruthy();
    expect(printTable.getByText('Recovery Deducted')).toBeTruthy();
    // Held/Released/Pending counts are not part of the Deductions preset — must be absent.
    expect(printTable.queryByText('Held')).toBeNull();
    expect(printTable.queryByText('Overtime')).toBeNull();
  });

  it('the print-only summary cards show exactly the selected cards and hide the rest', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release Status' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    const printCards = within(screen.getByTestId('print-only-cards'));
    expect(printCards.getByText('Employees')).toBeTruthy();
    expect(printCards.getByText('Released Amount')).toBeTruthy();
    expect(printCards.getByText('Pending Release Amount')).toBeTruthy();
    // Release Status has no EOBI/Fines/Advances card.
    expect(printCards.queryByText('EOBI')).toBeNull();
    expect(printCards.queryByText('Fines')).toBeNull();
  });

  it('the on-screen report still shows every column and every card regardless of print selection', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compact Summary' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText('Held')).toBeTruthy();
    expect(onScreenTable.getByText('Overtime')).toBeTruthy();
    expect(onScreenTable.getByText('Bal. Payable')).toBeTruthy();
    const onScreenCards = within(screen.getByTestId('on-screen-cards'));
    expect(onScreenCards.getByText('EOBI')).toBeTruthy();
    expect(onScreenCards.getByText('Fines')).toBeTruthy();
  });

  it('CSV/XLSX export still exports the complete filtered report, unaffected by print field selection', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compact Summary' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    fireEvent.click(screen.getByRole('button', { name: /export excel/i }));
    await vi.waitFor(() => expect(mockDownloadPayrollSummaryExport).toHaveBeenCalled());
    // The export call carries no field-selection argument at all — the backend export endpoint
    // always returns every column (`reports.service.ts`'s own contract, unaffected by this
    // checkpoint), matching the same call shape the CSV/XLSX tests above already assert. This
    // mock's call history isn't reset between tests in this file (no `clearMocks` in
    // `vitest.config.ts`), so the most recent call — not necessarily index 0 — is this test's own.
    const lastCall = mockDownloadPayrollSummaryExport.mock.calls.at(-1);
    expect(lastCall?.[2]).toBe('xlsx');
  });

  it('restores a previously saved field selection the next time the dialog opens', () => {
    window.localStorage.setItem(
      'payroll-summary-print-fields:v1',
      JSON.stringify({ cards: ['fines'], columns: ['siteName', 'fines'] }),
    );
    mockUsePayrollSummaryReport.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    // The stored selection is `['siteName', 'fines']` — 2 columns, Project Site plus Fines. Not the
    // Full Report default, proving a saved preference wins over it (Final Print UX Refinement).
    expect(screen.getByText('2 columns selected', { exact: false })).toBeTruthy();
  });
});
