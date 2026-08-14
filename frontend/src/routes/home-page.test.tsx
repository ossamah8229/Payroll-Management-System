// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DashboardResponse, SessionUser } from '@payroll/shared';
import { ApiError } from '@/lib/api-client';

/**
 * Dashboard Checkpoint 1B — page tests over the frozen Checkpoint 1A backend contract
 * (`shared/src/schemas/dashboard.ts`). `useDashboard` is mocked to a controlled, already-resolved
 * value (this codebase's own established pattern, `reports-salary-release-report-page.test.tsx`) —
 * these tests exercise rendering/permission-null handling only, never a real backend. Real
 * browser/network verification is Playwright's job (`tests/e2e/specs/30-dashboard.spec.ts`).
 */

const mockUseDashboard = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-dashboard', () => ({
  useDashboard: mockUseDashboard,
}));

const { HomePage } = await import('./home-page');

const baseUser: SessionUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@test.local',
  roleId: 'role-1',
  roleCode: 'MASTER_ADMIN',
  roleName: 'Master Admin',
  permissions: ['reports:view', 'payroll:view', 'employees:view', 'corrections:approve', 'advances:manage'] as SessionUser['permissions'],
  siteIds: [],
  themeAccentColor: '#000000',
};

const CYCLE = { id: 'cycle-1', year: 2026, month: 8, status: 'DRAFT' as const };

function fullDashboard(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    generatedAt: '2026-08-14T00:00:00.000Z',
    cycle: CYCLE,
    siteScope: { siteIds: null },
    totalEmployees: 42,
    netPayroll: '1000000.00',
    pendingRelease: { count: 3, amount: '50000.00' },
    releaseProgress: {
      totalCount: 42,
      releasedCount: 39,
      pendingCount: 3,
      heldCount: 1,
      noPayDueCount: 0,
      recoveryDueCount: 0,
      releasedAmount: '950000.00',
      pendingAmount: '50000.00',
    },
    deductionBreakdown: { eobi: '1000.00', advance: '2000.00', eidAdvance: '500.00', fine: '250.00' },
    siteSummary: [
      { siteId: 'site-1', siteName: 'Site One', employeeCount: 30, netPayroll: '700000.00', releasedAmount: '650000.00', pendingReleaseAmount: '50000.00' },
      { siteId: 'site-2', siteName: 'Site Two', employeeCount: 12, netPayroll: '300000.00', releasedAmount: '300000.00', pendingReleaseAmount: '0.00' },
    ],
    siteSummaryTotalSites: 2,
    attention: {
      heldEntries: { count: 1 },
      pendingCorrections: { count: 2 },
      recoveryDue: { count: 4, amount: '15000.00' },
    },
    ...overrides,
  };
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

afterEach(() => cleanup());

function renderPage(user: SessionUser = baseUser) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HomePage (Dashboard) — loading/error states', () => {
  it('shows a skeleton while loading, never a zero-valued widget', () => {
    mockUseDashboard.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByTestId('dashboard-loading')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-stat-row')).toBeNull();
  });

  it('shows a Dashboard-level error state on request failure, with a retry action, never a silent zero', () => {
    const refetch = vi.fn();
    mockUseDashboard.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(500, 'INTERNAL_ERROR', 'Something broke'),
      refetch,
    });
    renderPage();
    expect(screen.getByText(/could not load the dashboard/i)).toBeTruthy();
    expect(screen.getByText('Something broke')).toBeTruthy();
    screen.getByRole('button', { name: /try again/i }).click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('HomePage (Dashboard) — empty-cycle state', () => {
  it('shows the approved empty state when no PayrollCycle exists, and every cycle-scoped widget shows "No active cycle"', () => {
    mockUseDashboard.mockReturnValue({
      data: fullDashboard({
        cycle: null,
        netPayroll: null,
        pendingRelease: null,
        releaseProgress: null,
        deductionBreakdown: null,
        siteSummary: [],
        siteSummaryTotalSites: 0,
        totalEmployees: 10,
        attention: { heldEntries: { count: 0 }, pendingCorrections: { count: 0 }, recoveryDue: { count: 0 } },
      }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByTestId('dashboard-empty-cycle')).toBeTruthy();
    expect(screen.getByText('No payroll cycle exists yet')).toBeTruthy();
    // totalEmployees is not cycle-scoped — still renders even with no cycle.
    expect(within(screen.getByTestId('dashboard-stat-total-employees')).getByText('10')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-stat-net-payroll')).getByText('No active cycle')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-stat-pending-release')).getByText('No active cycle')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-stat-release-progress')).getByText('No active cycle')).toBeTruthy();
    expect(screen.getByTestId('dashboard-deductions-unavailable')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-deductions-unavailable')).getByText('No active cycle')).toBeTruthy();
  });
});

describe('HomePage (Dashboard) — full data render (verbatim backend values, no client recomputation)', () => {
  it('renders Current Cycle Status with period, status badge, and operational context', () => {
    mockUseDashboard.mockReturnValue({ data: fullDashboard(), isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderPage();
    const cycleCard = screen.getByTestId('dashboard-current-cycle');
    expect(within(cycleCard).getByText('August 2026')).toBeTruthy();
    expect(within(cycleCard).getByText(/draft/i)).toBeTruthy();
    expect(screen.getByTestId('dashboard-cycle-context').textContent).toBe('39 of 42 entries released');
  });

  it('renders Total Employees, Net Payroll, Pending Release, and Release Progress verbatim off the backend response', () => {
    mockUseDashboard.mockReturnValue({ data: fullDashboard(), isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(within(screen.getByTestId('dashboard-stat-total-employees')).getByText('42')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-stat-net-payroll')).getByText('PKR 1,000,000.00')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-stat-pending-release')).getByText('3')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-stat-pending-release')).getByText('PKR 50,000.00')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-stat-release-progress')).getByText('39 / 42 released')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-stat-release-progress')).getByText('3 pending · 1 held')).toBeTruthy();
  });

  it('renders the Site Payroll Summary table with backend rows only, and a "+more" link when total exceeds the Top-5 cap', () => {
    mockUseDashboard.mockReturnValue({
      data: fullDashboard({ siteSummaryTotalSites: 8 }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const table = screen.getByTestId('dashboard-site-summary-table');
    expect(within(table).getByText('Site One')).toBeTruthy();
    expect(within(table).getByText('Site Two')).toBeTruthy();
    expect(within(table).getByText('PKR 700,000.00')).toBeTruthy();
    const more = screen.getByTestId('dashboard-site-summary-view-all');
    expect(more.textContent).toContain('+3 more');
  });

  // --- Site Summary drill-down honesty (Dashboard Checkpoint 1B UAT remediation, Issue B) -------
  // Payroll Summary has no per-Site URL/state filter to land on, so a Site row must never imply
  // one exists: the Site name is plain text, never a Link, and the one real drill-down is a single
  // card-level action that is honest about going to the *overall* (unfiltered) report.

  it('never makes an individual Site row clickable — Site name is plain text, not a Link', () => {
    mockUseDashboard.mockReturnValue({ data: fullDashboard(), isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderPage();
    const table = screen.getByTestId('dashboard-site-summary-table');
    const siteOneCell = within(table).getByText('Site One');
    expect(siteOneCell.closest('a')).toBeNull();
    const siteTwoCell = within(table).getByText('Site Two');
    expect(siteTwoCell.closest('a')).toBeNull();
  });

  it('always offers one honest, card-level "View Payroll Summary" action, even with no overflow', () => {
    mockUseDashboard.mockReturnValue({
      data: fullDashboard({ siteSummaryTotalSites: 2 }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const viewAll = screen.getByTestId('dashboard-site-summary-view-all');
    expect(viewAll.textContent).toBe('View Payroll Summary');
    expect(viewAll.getAttribute('href')).toBe(screen.getByTestId('dashboard-stat-net-payroll').getAttribute('href'));
  });

  it('renders Deductions This Cycle as the exact approved four-line breakdown, never a client-side sum', () => {
    mockUseDashboard.mockReturnValue({ data: fullDashboard(), isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderPage();
    const list = screen.getByTestId('dashboard-deductions-list');
    expect(within(list).getByText('EOBI')).toBeTruthy();
    expect(within(list).getByText('Advance')).toBeTruthy();
    expect(within(list).getByText('EID Advance')).toBeTruthy();
    expect(within(list).getByText('Fine')).toBeTruthy();
    expect(within(list).getByText('PKR 1,000.00')).toBeTruthy();
    // No fifth category (correction reason/actor/bank) ever appears.
    expect(within(list).queryByText(/correction/i)).toBeNull();
    expect(within(list).queryByText(/bank/i)).toBeNull();
  });

  it('renders exactly the three Attention Required categories, each with its backend count', () => {
    mockUseDashboard.mockReturnValue({ data: fullDashboard(), isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByTestId('dashboard-attention-heldEntries')).toBeTruthy();
    expect(screen.getByTestId('dashboard-attention-pendingCorrections')).toBeTruthy();
    expect(screen.getByTestId('dashboard-attention-recoveryDue')).toBeTruthy();
    const recovery = screen.getByTestId('dashboard-attention-recoveryDue');
    expect(within(recovery).getByText('4')).toBeTruthy();
    expect(within(recovery).getByText('PKR 15,000.00')).toBeTruthy();
  });
});

describe('HomePage (Dashboard) — unavailable/permission-null widgets never fabricate zero', () => {
  it('shows Unavailable (never 0) for totalEmployees when the backend returns null', () => {
    mockUseDashboard.mockReturnValue({
      data: fullDashboard({ totalEmployees: null }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const card = screen.getByTestId('dashboard-stat-total-employees');
    expect(within(card).getByText('Unavailable')).toBeTruthy();
    expect(within(card).queryByText('0')).toBeNull();
    // Unavailable stat cards are never a clickable drill-down link.
    expect(card.tagName).not.toBe('A');
  });

  it('shows Unavailable (never 0/—) for netPayroll/pendingRelease/releaseProgress/deductions when null but a cycle exists', () => {
    mockUseDashboard.mockReturnValue({
      data: fullDashboard({ netPayroll: null, pendingRelease: null, releaseProgress: null, deductionBreakdown: null }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(within(screen.getByTestId('dashboard-stat-net-payroll')).getByText('Unavailable')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-stat-pending-release')).getByText('Unavailable')).toBeTruthy();
    expect(within(screen.getByTestId('dashboard-stat-release-progress')).getByText('Unavailable')).toBeTruthy();
    expect(screen.getByTestId('dashboard-deductions-unavailable')).toBeTruthy();
  });

  it('shows a hidden/unavailable Attention row (never a misleading zero) when pendingCorrections/recoveryDue is null', () => {
    mockUseDashboard.mockReturnValue({
      data: fullDashboard({ attention: { heldEntries: { count: 0 }, pendingCorrections: null, recoveryDue: null } }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    const corrections = screen.getByTestId('dashboard-attention-pendingCorrections');
    const recovery = screen.getByTestId('dashboard-attention-recoveryDue');
    expect(within(corrections).getByText('Unavailable')).toBeTruthy();
    expect(within(recovery).getByText('Unavailable')).toBeTruthy();
    // heldEntries is never null — a real 0 renders as a real 0, distinguishable from Unavailable.
    expect(within(screen.getByTestId('dashboard-attention-heldEntries')).getByText('0')).toBeTruthy();
  });

  it('distinguishes an authorized-but-empty Site Summary (real empty list) from an unauthorized one (null)', () => {
    mockUseDashboard.mockReturnValue({
      data: fullDashboard({ siteSummary: [], siteSummaryTotalSites: 0 }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId('dashboard-site-summary-empty')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-site-summary-unavailable')).toBeNull();

    cleanup();
    mockUseDashboard.mockReturnValue({
      data: fullDashboard({ siteSummary: null, siteSummaryTotalSites: null }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId('dashboard-site-summary-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-site-summary-empty')).toBeNull();
  });
});

describe('HomePage (Dashboard) — deep links', () => {
  it('links every widget to its own existing report/workflow route, never a new Dashboard-specific detail page', () => {
    mockUseDashboard.mockReturnValue({ data: fullDashboard(), isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByTestId('dashboard-stat-total-employees').getAttribute('href')).toBe('/employees');
    expect(screen.getByTestId('dashboard-stat-net-payroll').getAttribute('href')).toBe('/payroll-cycles/cycle-1/reports/payroll-summary');
    expect(screen.getByTestId('dashboard-stat-pending-release').getAttribute('href')).toBe('/payroll-cycles/cycle-1/reports/salary-release');
    expect(screen.getByTestId('dashboard-stat-release-progress').getAttribute('href')).toBe('/payroll-cycles/cycle-1/reports/salary-release');

    const correctionsLink = screen.getByTestId('dashboard-attention-pendingCorrections').querySelector('a');
    expect(correctionsLink?.getAttribute('href')).toBe('/corrections');
    const recoveryLink = screen.getByTestId('dashboard-attention-recoveryDue').querySelector('a');
    expect(recoveryLink?.getAttribute('href')).toBe('/reports/advance-recovery');
  });
});

describe('HomePage (Dashboard) — privacy: no sensitive vocabulary rendered', () => {
  it('never renders employee names, CNIC, bank/IBAN/account details, or audit metadata anywhere on the page', () => {
    mockUseDashboard.mockReturnValue({
      data: fullDashboard({
        siteSummary: [
          { siteId: 'site-1', siteName: 'Site One', employeeCount: 1, netPayroll: '1.00', releasedAmount: '1.00', pendingReleaseAmount: '0.00' },
        ],
      }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = renderPage();
    const text = container.textContent?.toLowerCase() ?? '';
    for (const forbidden of [
      'cnic',
      'iban',
      'account number',
      'released by',
      'correction reason',
      'jane doe',
      'employee name',
      'actor',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('HomePage (Dashboard) — accessibility basics', () => {
  it('gives each stat-card drill-down link a descriptive accessible name, not color/icon alone', () => {
    mockUseDashboard.mockReturnValue({ data: fullDashboard(), isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderPage();
    const netPayrollLink = screen.getByTestId('dashboard-stat-net-payroll');
    expect(netPayrollLink.getAttribute('aria-label')).toMatch(/net payroll/i);
    expect(netPayrollLink.getAttribute('aria-label')).toMatch(/pkr/i);
  });

  it('renders the Site Payroll Summary as a real table with column headers', () => {
    mockUseDashboard.mockReturnValue({ data: fullDashboard(), isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderPage();
    const table = screen.getByTestId('dashboard-site-summary-table');
    expect(within(table).getByRole('columnheader', { name: 'Site' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'Net Payroll' })).toBeTruthy();
  });
});
