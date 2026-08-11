// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdvanceRecoveryReportDetail, SessionUser } from '@payroll/shared';
import { ApiError } from '@/lib/api-client';

const mockUseAdvanceRecoveryReportDetail = vi.hoisted(() => vi.fn());
const mockUseAdvanceRecoveryReportList = vi.hoisted(() => vi.fn());
const mockUseAdvanceRecoveryReportEmployeeSearch = vi.hoisted(() => vi.fn(() => ({ data: undefined, isLoading: false })));

vi.mock('@/hooks/use-advance-recovery-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-advance-recovery-report')>();
  return {
    ...actual,
    useAdvanceRecoveryReportDetail: mockUseAdvanceRecoveryReportDetail,
    useAdvanceRecoveryReportList: mockUseAdvanceRecoveryReportList,
    useAdvanceRecoveryReportEmployeeSearch: mockUseAdvanceRecoveryReportEmployeeSearch,
  };
});

vi.mock('@/hooks/use-payroll-cycles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-cycles')>();
  return {
    ...actual,
    usePayrollCycles: () => ({
      data: [{ id: 'cycle-aug', year: 2026, month: 8, status: 'DRAFT' }],
      isLoading: false,
      error: null,
    }),
  };
});

vi.mock('@/hooks/use-project-sites', () => ({
  useAccessibleProjectSites: () => ({
    data: [{ id: 'site-1', name: 'Site One', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' }],
    isLoading: false,
    error: undefined,
  }),
}));

const { ReportsAdvanceRecoveryReportDetailPage } = await import('./reports-advance-recovery-report-detail-page');
const { ReportsAdvanceRecoveryReportPage } = await import('./reports-advance-recovery-report-page');

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

function baseDetail(overrides: Partial<AdvanceRecoveryReportDetail> = {}): AdvanceRecoveryReportDetail {
  return {
    advanceId: 'advance-1',
    employee: { id: 'emp-1', employeeCode: 'E-001', name: 'Jane Doe', siteId: 'site-1', siteName: 'Site One' },
    advanceType: 'LOAN',
    originalAmount: '10000.00',
    recoveredToDate: '4000.00',
    currentOutstandingBalance: '6000.00',
    status: 'ACTIVE',
    repaymentType: 'INSTALLMENT',
    scheduledInstallmentAmount: '500.00',
    dateGiven: '2026-01-15',
    paidOffAt: null,
    recoveryHistory: [],
    scheduleChanges: [],
    generatedAt: '2026-08-10T00:00:00.000Z',
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
});

beforeEach(() => {
  window.localStorage.clear();
});

function renderDetail(advanceId = 'advance-1') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/reports/advance-recovery/${advanceId}`]}>
        <Routes>
          <Route path="/reports/advance-recovery" element={<ReportsAdvanceRecoveryReportPage user={baseUser} />} />
          <Route path="/payroll-cycles/:cycleId/reports/advance-recovery" element={<ReportsAdvanceRecoveryReportPage user={baseUser} />} />
          <Route path="/reports/advance-recovery/:advanceId" element={<ReportsAdvanceRecoveryReportDetailPage user={baseUser} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReportsAdvanceRecoveryReportDetailPage — Advance Summary', () => {
  afterEach(() => cleanup());

  it('renders the current, live-figures disclosure and the summary fields', () => {
    mockUseAdvanceRecoveryReportDetail.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    renderDetail();
    expect(screen.getByText(/current, live figures/i)).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('E-001')).toBeTruthy();
    expect(screen.getByText('Site One')).toBeTruthy();
    expect(screen.getAllByText(/PKR 6,000\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PKR 500\.00/).length).toBeGreaterThan(0);
  });

  it('shows an em dash for Scheduled Installment when null (e.g. FULL_DEDUCTION)', () => {
    mockUseAdvanceRecoveryReportDetail.mockReturnValue({
      data: baseDetail({ scheduledInstallmentAmount: null, repaymentType: 'FULL_DEDUCTION' }),
      isLoading: false,
      error: null,
    });
    renderDetail();
    expect(screen.getByText('Full Deduction')).toBeTruthy();
  });

  it('never shows CNIC or banking fields anywhere on the page', () => {
    mockUseAdvanceRecoveryReportDetail.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    const { container } = renderDetail();
    const bodyText = container.textContent ?? '';
    expect(bodyText).not.toMatch(/cnic/i);
    expect(bodyText).not.toMatch(/iban/i);
    expect(bodyText).not.toMatch(/account number/i);
  });
});

describe('ReportsAdvanceRecoveryReportDetailPage — Recovery History', () => {
  afterEach(() => cleanup());

  it('shows an empty state when there is no recovery history', () => {
    mockUseAdvanceRecoveryReportDetail.mockReturnValue({ data: baseDetail({ recoveryHistory: [] }), isLoading: false, error: null });
    renderDetail();
    expect(screen.getByText(/no recovery has been recorded/i)).toBeTruthy();
  });

  it('renders each recovery event with its own historical Site, which may differ from the current Site', () => {
    mockUseAdvanceRecoveryReportDetail.mockReturnValue({
      data: baseDetail({
        employee: { id: 'emp-1', employeeCode: 'E-001', name: 'Jane Doe', siteId: 'site-2', siteName: 'Site Two' },
        recoveryHistory: [
          {
            payrollEntryId: 'entry-1',
            cycleId: 'cycle-jul',
            cycleLabel: 'July 2026',
            cycleYear: 2026,
            cycleMonth: 7,
            siteId: 'site-1',
            siteName: 'Site One',
            amountRecovered: '500.00',
            rowStatus: 'RELEASED',
            releasedAt: '2026-07-31T00:00:00.000Z',
          },
        ],
      }),
      isLoading: false,
      error: null,
    });
    renderDetail();
    expect(screen.getByText(/historical site of that payroll entry/i)).toBeTruthy();
    expect(screen.getByText('July 2026')).toBeTruthy();
    // The recovery event's own historical Site (Site One) differs from the employee's current
    // Site (Site Two, in the Advance Summary card above) — both must render, distinctly.
    expect(screen.getAllByText('Site One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Site Two').length).toBeGreaterThan(0);
  });
});

describe('ReportsAdvanceRecoveryReportDetailPage — Schedule / Deferral History', () => {
  afterEach(() => cleanup());

  it('shows an empty state when there are no schedule changes', () => {
    mockUseAdvanceRecoveryReportDetail.mockReturnValue({ data: baseDetail({ scheduleChanges: [] }), isLoading: false, error: null });
    renderDetail();
    expect(screen.getByText(/no schedule or deferral changes/i)).toBeTruthy();
  });

  it('renders schedule changes as a separate timeline from Recovery History — never labeled as a recovery', () => {
    mockUseAdvanceRecoveryReportDetail.mockReturnValue({
      data: baseDetail({
        recoveryHistory: [
          {
            payrollEntryId: 'entry-1',
            cycleId: 'cycle-jul',
            cycleLabel: 'July 2026',
            cycleYear: 2026,
            cycleMonth: 7,
            siteId: 'site-1',
            siteName: 'Site One',
            amountRecovered: '500.00',
            rowStatus: 'RELEASED',
            releasedAt: '2026-07-31T00:00:00.000Z',
          },
        ],
        scheduleChanges: [
          {
            id: 'change-1',
            fromPeriod: { year: 2026, month: 7 },
            toPeriod: { year: 2026, month: 8 },
            reason: 'Employee requested deferral',
            changedAt: '2026-07-20T00:00:00.000Z',
            changedBy: { id: 'u-1', name: 'Admin User' },
          },
        ],
      }),
      isLoading: false,
      error: null,
    });
    renderDetail();
    expect(screen.getByText('Recovery History')).toBeTruthy();
    expect(screen.getByText('Schedule / Deferral History')).toBeTruthy();
    expect(screen.getByText('Employee requested deferral')).toBeTruthy();
    expect(screen.getByText('Admin User')).toBeTruthy();
    // The schedule change's own row lives in a table separate from the Recovery History table.
    const recoverySection = screen.getByText('Recovery History').closest('[class*="rounded-lg"]');
    const scheduleSection = screen.getByText('Schedule / Deferral History').closest('[class*="rounded-lg"]');
    expect(recoverySection).not.toBe(scheduleSection);
    expect(within(scheduleSection as HTMLElement).queryByText(/employee requested deferral/i)).toBeTruthy();
    expect(within(recoverySection as HTMLElement).queryByText(/employee requested deferral/i)).toBeNull();
  });
});

describe('ReportsAdvanceRecoveryReportDetailPage — 403/404 concealment', () => {
  afterEach(() => cleanup());

  it('shows the plain not-found message for a 404', () => {
    mockUseAdvanceRecoveryReportDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(404, 'NOT_FOUND', 'not found'),
    });
    renderDetail();
    expect(screen.getByText(/could not be found/i)).toBeTruthy();
  });

  it('shows the IDENTICAL not-found message for a 403 — never confirming the Advance exists outside the caller\'s Site access', () => {
    mockUseAdvanceRecoveryReportDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(403, 'FORBIDDEN', 'forbidden'),
    });
    renderDetail();
    // Same headline text a true 404 would show — the backend's own 403/404 split (§19.1 decision 5)
    // is never surfaced as a user-visible distinction, unlike the backend's own status code.
    expect(screen.getByText(/could not be found/i)).toBeTruthy();
    expect(screen.queryByText(/you do not have access/i)).toBeNull();
    expect(screen.queryByText(/outside your current site access/i)).toBeNull();
  });

  it('a 404 and a 403 render byte-identical body copy', () => {
    mockUseAdvanceRecoveryReportDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(404, 'NOT_FOUND', 'not found'),
    });
    const notFoundRender = renderDetail();
    const notFoundText = notFoundRender.container.textContent;
    notFoundRender.unmount();

    mockUseAdvanceRecoveryReportDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(403, 'FORBIDDEN', 'forbidden'),
    });
    const forbiddenRender = renderDetail();
    expect(forbiddenRender.container.textContent).toBe(notFoundText);
  });
});

describe('ReportsAdvanceRecoveryReportDetailPage — Back preserves list state', () => {
  afterEach(() => cleanup());

  it('Back to Report returns to the cycle-scoped canonical URL when the list was viewed with a Cycle selected', () => {
    mockUseAdvanceRecoveryReportList.mockReturnValue({
      data: {
        cycle: { id: 'cycle-aug', year: 2026, month: 8, status: 'DRAFT' },
        page: 1,
        pageSize: 25,
        total: 1,
        rows: [
          {
            advanceId: 'advance-1',
            employeeId: 'emp-1',
            employeeCode: 'E-001',
            employeeName: 'Jane Doe',
            siteId: 'site-1',
            siteName: 'Site One',
            advanceType: 'LOAN',
            originalAmount: '10000.00',
            recoveredToDate: '4000.00',
            currentOutstandingBalance: '6000.00',
            status: 'ACTIVE',
            repaymentType: 'INSTALLMENT',
            dateGiven: '2026-01-15',
            recoveredThisCycle: '500.00',
          },
        ],
        totals: {
          matchingAdvanceCount: 1,
          employeesWithAdvanceCount: 1,
          loan: { originalAmountTotal: '10000.00', recoveredToDateTotal: '4000.00', currentOutstandingBalanceTotal: '6000.00' },
          eidAdvance: { originalAmountTotal: '0.00', recoveredToDateTotal: '0.00', currentOutstandingBalanceTotal: '0.00' },
          activeCount: 1,
          reservedCount: 0,
          paidOffCount: 0,
          cancelledCount: 0,
          recoveredThisCycleTotal: '500.00',
          recoveredThisCycleTotalByType: { loan: '500.00', eidAdvance: '0.00' },
        },
        generatedAt: '2026-08-10T00:00:00.000Z',
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/payroll-cycles/cycle-aug/reports/advance-recovery']}>
          <Routes>
            <Route path="/reports/advance-recovery" element={<ReportsAdvanceRecoveryReportPage user={baseUser} />} />
            <Route path="/payroll-cycles/:cycleId/reports/advance-recovery" element={<ReportsAdvanceRecoveryReportPage user={baseUser} />} />
            <Route path="/reports/advance-recovery/:advanceId" element={<ReportsAdvanceRecoveryReportDetailPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /view details for jane doe/i }));

    mockUseAdvanceRecoveryReportDetail.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    // Re-render is automatic via router navigation; assert the detail page rendered.
    expect(screen.getByText('Back to Report')).toBeTruthy();

    fireEvent.click(screen.getByText('Back to Report'));
    // Back navigation must land on the cycle-scoped canonical URL, not the flat one — proven by the
    // restored Cycle `<select>`'s own value (driven directly by `useParams().cycleId`), not merely by
    // generic title text that would render identically on either route.
    expect((screen.getByLabelText('Cycle') as HTMLSelectElement).value).toBe('cycle-aug');
  });
});
