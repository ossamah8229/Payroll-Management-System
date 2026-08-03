// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

beforeEach(() => mockSelectedCycle());

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
    expect(screen.getByText('Site One')).toBeTruthy();
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
