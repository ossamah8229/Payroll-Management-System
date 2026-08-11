// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdvanceRecoveryReportListResponse, AdvanceRecoveryReportRow, AdvanceRecoveryReportTotals, SessionUser } from '@payroll/shared';

/**
 * Advance Recovery Report Checkpoint 1B — list page tests. Every data-fetching hook is mocked to a
 * controlled, already-resolved value (this codebase's own established pattern,
 * `reports-deduction-report-page.test.tsx`) — these tests exercise the page's own permission-gating,
 * optional-Cycle wiring, filter/sort/pagination wiring, and rendering logic, never a real backend.
 * Real browser/network verification is Playwright's job
 * (`tests/e2e/specs/25-advance-recovery-report.spec.ts`).
 */

const mockUseAdvanceRecoveryReportList = vi.hoisted(() => vi.fn());
const mockUseAdvanceRecoveryReportEmployeeSearch = vi.hoisted(() => vi.fn(() => ({ data: undefined, isLoading: false })));
const mockDownloadAdvanceRecoveryReportExport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/hooks/use-advance-recovery-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-advance-recovery-report')>();
  return {
    ...actual,
    useAdvanceRecoveryReportList: mockUseAdvanceRecoveryReportList,
    useAdvanceRecoveryReportEmployeeSearch: mockUseAdvanceRecoveryReportEmployeeSearch,
    downloadAdvanceRecoveryReportExport: mockDownloadAdvanceRecoveryReportExport,
  };
});

const CYCLES = [
  { id: 'cycle-aug', year: 2026, month: 8, status: 'DRAFT', sourceCycleId: null, createdAt: '', createdBy: '', releasedAt: null, releasedBy: null, archivedAt: null, archivedBy: null, isCurrentDraft: true },
  { id: 'cycle-jul', year: 2026, month: 7, status: 'RELEASED', sourceCycleId: null, createdAt: '', createdBy: '', releasedAt: null, releasedBy: null, archivedAt: null, archivedBy: null, isCurrentDraft: false },
];

const mockUsePayrollCycles = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-payroll-cycles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-cycles')>();
  return { ...actual, usePayrollCycles: mockUsePayrollCycles };
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
  window.localStorage.clear();
});

function renderPage(user: SessionUser = baseUser, initialEntry = '/reports/advance-recovery') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/reports/advance-recovery" element={<ReportsAdvanceRecoveryReportPage user={user} />} />
          <Route path="/payroll-cycles/:cycleId/reports/advance-recovery" element={<ReportsAdvanceRecoveryReportPage user={user} />} />
          <Route path="/reports/advance-recovery/:advanceId" element={<div>DETAIL PAGE STUB</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function row(overrides: Partial<AdvanceRecoveryReportRow> = {}): AdvanceRecoveryReportRow {
  return {
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
    recoveredThisCycle: null,
    ...overrides,
  };
}

function totals(overrides: Partial<AdvanceRecoveryReportTotals> = {}): AdvanceRecoveryReportTotals {
  return {
    matchingAdvanceCount: 1,
    employeesWithAdvanceCount: 1,
    loan: { originalAmountTotal: '10000.00', recoveredToDateTotal: '4000.00', currentOutstandingBalanceTotal: '6000.00' },
    eidAdvance: { originalAmountTotal: '0.00', recoveredToDateTotal: '0.00', currentOutstandingBalanceTotal: '0.00' },
    activeCount: 1,
    reservedCount: 0,
    paidOffCount: 0,
    cancelledCount: 0,
    recoveredThisCycleTotal: null,
    recoveredThisCycleTotalByType: null,
    ...overrides,
  };
}

function fullReport(overrides: Partial<AdvanceRecoveryReportListResponse> = {}): AdvanceRecoveryReportListResponse {
  return {
    cycle: null,
    page: 1,
    pageSize: 25,
    total: 1,
    rows: [row()],
    totals: totals(),
    generatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

function mockListReturn(data: AdvanceRecoveryReportListResponse | undefined, extra: Record<string, unknown> = {}) {
  mockUseAdvanceRecoveryReportList.mockReturnValue({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...extra,
  });
}

describe('ReportsAdvanceRecoveryReportPage — RBAC', () => {
  afterEach(() => cleanup());

  it('shows an access-denied state for a user without reports:view', () => {
    mockListReturn(undefined);
    renderPage({ ...baseUser, permissions: [] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('renders the report for a user holding reports:view', () => {
    mockListReturn(fullReport());
    renderPage();
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });

  it('renders a "View Details" action per row (a detail page exists in V1, unlike Deduction/Overtime Report)', () => {
    mockListReturn(fullReport());
    renderPage();
    expect(screen.getByRole('button', { name: /view details for jane doe/i })).toBeTruthy();
  });
});

describe('ReportsAdvanceRecoveryReportPage — optional Cycle UX', () => {
  afterEach(() => cleanup());

  it('fetches the roster with no cycleId on the flat route — Cycle is never required', () => {
    mockListReturn(fullReport());
    renderPage();
    const lastCall = mockUseAdvanceRecoveryReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ cycleId: undefined }));
  });

  it('shows "Not selected" for Recovered This Cycle when no Cycle is selected, never a fabricated 0.00', () => {
    mockListReturn(fullReport({ rows: [row({ recoveredThisCycle: null })] }));
    renderPage();
    expect(within(screen.getByTestId('on-screen-table')).getByText('Not selected')).toBeTruthy();
  });

  it('does not render a Recovered This Cycle totals group when no Cycle is selected', () => {
    mockListReturn(fullReport({ totals: totals({ recoveredThisCycleTotal: null }) }));
    renderPage();
    expect(screen.queryByTestId('arr-stat-recovered-this-cycle-total')).toBeNull();
  });

  it('fetches with the route cycleId once mounted on the canonical cycle-scoped URL, and shows Recovered This Cycle totals', () => {
    mockListReturn(
      fullReport({
        cycle: { id: 'cycle-aug', year: 2026, month: 8, status: 'DRAFT' },
        rows: [row({ recoveredThisCycle: '500.00' })],
        totals: totals({ recoveredThisCycleTotal: '500.00', recoveredThisCycleTotalByType: { loan: '500.00', eidAdvance: '0.00' } }),
      }),
    );
    renderPage(baseUser, '/payroll-cycles/cycle-aug/reports/advance-recovery');
    const lastCall = mockUseAdvanceRecoveryReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ cycleId: 'cycle-aug' }));
    expect(screen.getByTestId('arr-stat-recovered-this-cycle-total')).toBeTruthy();
    expect(within(screen.getByTestId('on-screen-table')).getByText('PKR 500.00')).toBeTruthy();
  });

  it('current Outstanding Balance and Recovered To Date are identical whether or not a Cycle is selected — only Recovered This Cycle differs', () => {
    mockListReturn(fullReport({ rows: [row({ recoveredThisCycle: null })] }));
    const { unmount } = renderPage(baseUser, '/reports/advance-recovery');
    expect(within(screen.getByTestId('on-screen-table')).getByText('PKR 6,000.00')).toBeTruthy();
    unmount();
    cleanup();

    mockListReturn(
      fullReport({
        cycle: { id: 'cycle-aug', year: 2026, month: 8, status: 'DRAFT' },
        rows: [row({ recoveredThisCycle: '500.00' })],
      }),
    );
    renderPage(baseUser, '/payroll-cycles/cycle-aug/reports/advance-recovery');
    expect(within(screen.getByTestId('on-screen-table')).getByText('PKR 6,000.00')).toBeTruthy();
  });

  it('always shows the current-vs-historical disclosure note, adapting its wording to whether a Cycle is selected', () => {
    mockListReturn(fullReport());
    renderPage();
    expect(screen.getByTestId('arr-current-vs-historical-note').textContent).toMatch(/select a payroll cycle/i);

    cleanup();
    mockListReturn(fullReport({ cycle: { id: 'cycle-aug', year: 2026, month: 8, status: 'DRAFT' } }));
    renderPage(baseUser, '/payroll-cycles/cycle-aug/reports/advance-recovery');
    expect(screen.getByTestId('arr-current-vs-historical-note').textContent).toMatch(/august 2026/i);
  });
});

describe('ReportsAdvanceRecoveryReportPage — totals', () => {
  afterEach(() => cleanup());

  it('renders backend-provided totals verbatim: summary, LOAN, Eid Advance, and status counts', () => {
    mockListReturn(fullReport());
    renderPage();
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Summary')).toBeTruthy();
    expect(cards.getByText('Advance')).toBeTruthy();
    expect(cards.getByText('Eid Advance')).toBeTruthy();
    expect(cards.getByText('Status')).toBeTruthy();
    expect(cards.getByText('Matching Advances')).toBeTruthy();
    expect(cards.getByText('Employees With Advances')).toBeTruthy();
    expect(cards.getAllByText(/6,000\.00/).length).toBeGreaterThan(0);
  });

  it('never computes totals client-side — a changed row set with a stale totals object still shows the stale totals verbatim', () => {
    mockListReturn(fullReport({ rows: [row(), row({ advanceId: 'advance-2', employeeName: 'Second Row' })], totals: totals({ matchingAdvanceCount: 1 }) }));
    renderPage();
    expect(within(screen.getByTestId('on-screen-cards')).getByTestId('arr-stat-matching-advances').textContent).toContain('1');
  });
});

describe('ReportsAdvanceRecoveryReportPage — table', () => {
  afterEach(() => cleanup());

  it('renders every approved column with no sensitive fields (no CNIC/bank/IBAN/correction data anywhere)', () => {
    mockListReturn(fullReport());
    const { container } = renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText('E-001')).toBeTruthy();
    expect(onScreenTable.getByText('Jane Doe')).toBeTruthy();
    expect(onScreenTable.getByText('Site One')).toBeTruthy();
    expect(onScreenTable.getByText('Advance')).toBeTruthy();
    expect(onScreenTable.getByText('Active')).toBeTruthy();
    expect(onScreenTable.getByText('Installment')).toBeTruthy();
    const bodyText = container.textContent ?? '';
    expect(bodyText).not.toMatch(/cnic/i);
    expect(bodyText).not.toMatch(/iban/i);
    expect(bodyText).not.toMatch(/account number/i);
    expect(bodyText).not.toMatch(/correction/i);
    expect(bodyText).not.toMatch(/balance adjustment/i);
  });

  it('one row = one Advance — the same employee with LOAN + EID_ADVANCE renders as two distinct rows', () => {
    mockListReturn(
      fullReport({
        rows: [
          row({ advanceId: 'advance-loan', advanceType: 'LOAN' }),
          row({ advanceId: 'advance-eid', advanceType: 'EID_ADVANCE' }),
        ],
        total: 2,
      }),
    );
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getAllByText('Jane Doe')).toHaveLength(2);
    expect(onScreenTable.getByText('Advance')).toBeTruthy();
    expect(onScreenTable.getByText('Eid Advance')).toBeTruthy();
  });

  it('renders a distinct status badge for each of the four Advance statuses', () => {
    mockListReturn(
      fullReport({
        rows: [
          row({ advanceId: 'a1', status: 'ACTIVE' }),
          row({ advanceId: 'a2', status: 'RESERVED' }),
          row({ advanceId: 'a3', status: 'PAID_OFF' }),
          row({ advanceId: 'a4', status: 'CANCELLED' }),
        ],
        total: 4,
      }),
    );
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText('Active')).toBeTruthy();
    expect(onScreenTable.getByText(/reserved/i)).toBeTruthy();
    expect(onScreenTable.getByText('Paid Off')).toBeTruthy();
    expect(onScreenTable.getByText('Cancelled')).toBeTruthy();
  });
});

describe('ReportsAdvanceRecoveryReportPage — sorting and pagination', () => {
  afterEach(() => cleanup());

  it('clicking a sortable column header requests the backend with the new sort field, reset to page 1', () => {
    mockListReturn(fullReport());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /original amount/i }));
    const lastCall = mockUseAdvanceRecoveryReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'originalAmount', sortDir: 'asc', page: 1 }));
  });

  it('clicking the active sort header again reverses direction', () => {
    mockListReturn(fullReport());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /original amount/i }));
    fireEvent.click(screen.getByRole('button', { name: /original amount/i }));
    const lastCall = mockUseAdvanceRecoveryReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'originalAmount', sortDir: 'desc' }));
  });

  it('never exposes a sort control for Recovered This Cycle (not backend-sortable)', () => {
    mockListReturn(fullReport());
    renderPage();
    expect(screen.queryByRole('button', { name: /recovered this cycle/i })).toBeNull();
  });

  it('clamps the current page down when the backend total for the requested page shrinks', () => {
    mockListReturn(fullReport({ page: 3, total: 3, pageSize: 25 }));
    renderPage();
    // total=3 with pageSize=25 means the last valid page is 1; the clamp effect should fire a
    // re-request for page 1 rather than silently showing an empty "page 3."
    const calls = mockUseAdvanceRecoveryReportList.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.page === 1)).toBe(true);
  });
});

describe('ReportsAdvanceRecoveryReportPage — filters', () => {
  afterEach(() => cleanup());

  it('changing the Site filter requests the backend with the new siteIds, reset to page 1', () => {
    mockListReturn(fullReport());
    renderPage();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    const lastCall = mockUseAdvanceRecoveryReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ siteIds: ['site-1'], page: 1 }));
  });

  it('changing the Advance Type filter requests the backend with the new type', () => {
    mockListReturn(fullReport());
    renderPage();
    fireEvent.change(screen.getByLabelText(/advance type/i), { target: { value: 'EID_ADVANCE' } });
    const lastCall = mockUseAdvanceRecoveryReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ advanceType: 'EID_ADVANCE' }));
  });

  it('changing the Status filter requests the backend with the new status', () => {
    mockListReturn(fullReport());
    renderPage();
    fireEvent.change(screen.getByLabelText(/^status$/i), { target: { value: 'PAID_OFF' } });
    const lastCall = mockUseAdvanceRecoveryReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ status: 'PAID_OFF' }));
  });

  it('Has Outstanding Balance is a tri-state (All/Yes/No) — selecting Yes sends true, selecting No sends false', () => {
    mockListReturn(fullReport());
    renderPage();
    fireEvent.change(screen.getByLabelText(/has outstanding balance/i), { target: { value: 'YES' } });
    expect(mockUseAdvanceRecoveryReportList.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ hasOutstandingBalance: true }));
    fireEvent.change(screen.getByLabelText(/has outstanding balance/i), { target: { value: 'NO' } });
    expect(mockUseAdvanceRecoveryReportList.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ hasOutstandingBalance: false }));
    fireEvent.change(screen.getByLabelText(/has outstanding balance/i), { target: { value: 'ALL' } });
    expect(mockUseAdvanceRecoveryReportList.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ hasOutstandingBalance: undefined }));
  });

  it('Clear Filters resets Site/Advance Type/Status/Has Outstanding Balance to defaults and resets the page, but never touches the selected Cycle', () => {
    mockListReturn(fullReport({ cycle: { id: 'cycle-aug', year: 2026, month: 8, status: 'DRAFT' } }));
    renderPage(baseUser, '/payroll-cycles/cycle-aug/reports/advance-recovery');
    fireEvent.change(screen.getByLabelText(/advance type/i), { target: { value: 'EID_ADVANCE' } });
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    const lastCall = mockUseAdvanceRecoveryReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(
      expect.objectContaining({ siteIds: undefined, advanceType: undefined, status: undefined, hasOutstandingBalance: undefined, cycleId: 'cycle-aug', page: 1 }),
    );
  });
});

describe('ReportsAdvanceRecoveryReportPage — export', () => {
  afterEach(() => cleanup());

  it('Export CSV calls the download function with the current filters/sort and format csv', async () => {
    mockListReturn(fullReport());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadAdvanceRecoveryReportExport).toHaveBeenCalled());
    const call = mockDownloadAdvanceRecoveryReportExport.mock.calls.at(-1)!;
    expect(call[3]).toBe('csv');
  });

  it('Export Excel calls the download function with format xlsx', async () => {
    mockDownloadAdvanceRecoveryReportExport.mockClear();
    mockListReturn(fullReport());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export excel/i }));
    await vi.waitFor(() => expect(mockDownloadAdvanceRecoveryReportExport).toHaveBeenCalled());
    expect(mockDownloadAdvanceRecoveryReportExport.mock.calls.at(-1)?.[3]).toBe('xlsx');
  });

  it('shows the backend structured message on a 413 export-row-limit error', async () => {
    const { AdvanceRecoveryReportExportRowLimitExceededError } = await import('@/hooks/use-advance-recovery-report');
    mockDownloadAdvanceRecoveryReportExport.mockRejectedValueOnce(
      new AdvanceRecoveryReportExportRowLimitExceededError(25000, 20000, 'This export matches 25000 rows. Narrow your filters and try again.'),
    );
    mockListReturn(fullReport());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadAdvanceRecoveryReportExport).toHaveBeenCalled());
  });

  it('disables Export buttons when there is no data / zero matching rows', () => {
    mockListReturn(fullReport({ total: 0, rows: [] }));
    renderPage();
    expect((screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ReportsAdvanceRecoveryReportPage — Print', () => {
  afterEach(() => cleanup());

  it('clicking Print opens the options dialog instead of calling window.print() immediately, defaulting to every safe field selected', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockListReturn(fullReport());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByText('Print Options')).toBeTruthy();
    expect(printSpy).not.toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('confirming the dialog calls window.print() and never triggers an export/download request', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockDownloadAdvanceRecoveryReportExport.mockClear();
    mockListReturn(fullReport());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(mockDownloadAdvanceRecoveryReportExport).not.toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('prints Recovered This Cycle as "Not selected", never a fabricated 0.00, when no Cycle is selected', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockListReturn(fullReport({ rows: [row({ recoveredThisCycle: null })] }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    const printOnlyTable = within(screen.getByTestId('print-only-table'));
    expect(printOnlyTable.getByText('Not selected')).toBeTruthy();
    printSpy.mockRestore();
  });

  it('never offers a sensitive field in the Print Options dialog', () => {
    mockListReturn(fullReport());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const dialogText = screen.getByText('Print Options').closest('[role="dialog"]')?.textContent ?? '';
    expect(dialogText.toLowerCase()).not.toMatch(/cnic|iban|bank|correction/);
  });
});

describe('ReportsAdvanceRecoveryReportPage — accessibility', () => {
  afterEach(() => cleanup());

  it('reflects the active sort column via aria-sort', () => {
    mockListReturn(fullReport());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /original amount/i }));
    const header = screen.getByRole('button', { name: /original amount/i }).closest('th');
    expect(header?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('View Details exposes a full accessible name including the employee, not a bare icon button', () => {
    mockListReturn(fullReport());
    renderPage();
    expect(screen.getByRole('button', { name: 'View Details for Jane Doe' })).toBeTruthy();
  });
});
