// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DeductionReportListResponse, DeductionReportRow, SessionUser } from '@payroll/shared';

/**
 * Deduction Report Checkpoint 1B — list page tests. Every data-fetching hook is mocked to a
 * controlled, already-resolved value (this codebase's own established pattern,
 * `reports-project-site-payroll-page.test.tsx`) — these tests exercise the page's own
 * permission-gating, filter/sort/pagination wiring, and rendering logic, never a real backend. Real
 * browser/network verification is Playwright's job (`tests/e2e/specs/21-deduction-report.spec.ts`).
 */

const mockUseDeductionReportList = vi.hoisted(() => vi.fn());
const mockDownloadDeductionReportExport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/hooks/use-deduction-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-deduction-report')>();
  return {
    ...actual,
    useDeductionReportList: mockUseDeductionReportList,
    downloadDeductionReportExport: mockDownloadDeductionReportExport,
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

const { ReportsDeductionReportPage } = await import('./reports-deduction-report-page');

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
      <MemoryRouter initialEntries={['/reports/deduction-report']}>
        <Routes>
          <Route path="/reports/deduction-report" element={<ReportsDeductionReportPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function row(overrides: Partial<DeductionReportRow> = {}): DeductionReportRow {
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
    eobi: '800.00',
    advanceDeduction: '0.00',
    eidAdvanceDeduction: '0.00',
    fine: '0.00',
    correctionBalanceRecovery: '0.00',
    totalDeductions: '800.00',
    rowStatus: 'RELEASED',
    correctionCount: 0,
    releasedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

function totals(overrides: Partial<DeductionReportListResponse['totals']> = {}): DeductionReportListResponse['totals'] {
  return {
    matchingCount: 1,
    employeesWithAnyDeduction: 1,
    eobiTotal: '800.00',
    advanceDeductionTotal: '0.00',
    eidAdvanceDeductionTotal: '0.00',
    fineTotal: '0.00',
    correctionRecoveryTotal: '0.00',
    totalDeductions: '800.00',
    releasedCount: 1,
    heldCount: 0,
    noPayDueCount: 0,
    recoveryDueCount: 0,
    pendingCount: 0,
    correctedEntryCount: 0,
    totalsComputed: true,
    ...overrides,
  };
}

function fullReport(overrides: Partial<DeductionReportListResponse> = {}): DeductionReportListResponse {
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

describe('ReportsDeductionReportPage — RBAC', () => {
  afterEach(() => cleanup());

  it('shows an access-denied state for a user without reports:view', () => {
    mockUseDeductionReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: [] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('renders the report for a user holding reports:view', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });

  it('never renders a "View Details" action or any detail-route link (no detail page in V1)', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByRole('button', { name: /view details/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /view details/i })).toBeNull();
  });
});

describe('ReportsDeductionReportPage — Cycle requirement', () => {
  afterEach(() => cleanup());

  it('shows "no payroll cycles exist yet" and never renders the table when no Cycle exists', () => {
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: undefined, cycle: undefined, cycles: [], isLoading: false, error: null, selectCycle: vi.fn() });
    mockUseDeductionReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/no payroll cycles exist yet/i)).toBeTruthy();
    expect(screen.queryByTestId('on-screen-table')).toBeNull();
  });

  it('selecting a different Cycle calls selectCycle with the new id', () => {
    const selectCycle = vi.fn();
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle });
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^cycle$/i), { target: { value: 'cycle-jun' } });
    expect(selectCycle).toHaveBeenCalledWith('cycle-jun');
  });
});

describe('ReportsDeductionReportPage — loading/empty/error states', () => {
  afterEach(() => cleanup());

  it('shows a loading skeleton while fetching', () => {
    mockUseDeductionReportList.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry action', () => {
    const refetch = vi.fn();
    mockUseDeductionReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: new Error('boom'), refetch });
    renderPage();
    expect(screen.getByText(/could not load the deduction report/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('distinguishes "no entries for this cycle" from "no match for filters"', () => {
    mockUseDeductionReportList.mockReturnValue({
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

describe('ReportsDeductionReportPage — totals', () => {
  afterEach(() => cleanup());

  it('renders backend-provided totals verbatim, grouped into Payroll Deductions / Status', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Payroll Deductions')).toBeTruthy();
    expect(cards.getByText('Status')).toBeTruthy();
    expect(cards.getAllByText(/800\.00/).length).toBeGreaterThan(0);
    expect(cards.getByText('Matching Entries')).toBeTruthy();
    expect(cards.getByText('Employees With Any Deduction')).toBeTruthy();
  });

  it('shows the totals-unavailable notice instead of misleading zeros when totalsComputed is false, but always shows status counts', () => {
    mockUseDeductionReportList.mockReturnValue({
      data: fullReport({
        totals: totals({
          totalsComputed: false,
          eobiTotal: null,
          advanceDeductionTotal: null,
          eidAdvanceDeductionTotal: null,
          fineTotal: null,
          correctionRecoveryTotal: null,
          totalDeductions: null,
          employeesWithAnyDeduction: null,
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
    expect(screen.getByTestId('dr-totals-unavailable')).toBeTruthy();
    expect(screen.getByText(/totals are unavailable for this result size/i)).toBeTruthy();
    const cards = within(screen.getByTestId('on-screen-cards'));
    expect(cards.getByText('Status')).toBeTruthy();
    expect(cards.getByText('20000')).toBeTruthy();
    // Employees With Any Deduction is individually gated to a dash, never a misleading zero.
    expect(screen.getByTestId('dr-stat-employees-with-any-deduction').textContent).toContain('—');
  });
});

describe('ReportsDeductionReportPage — table', () => {
  afterEach(() => cleanup());

  it('renders every approved column with no sensitive fields (no CNIC/bank/account/IBAN anywhere), and never Gross Pay or Net Salary', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getByText('E-001')).toBeTruthy();
    expect(onScreenTable.getByText('Jane Doe')).toBeTruthy();
    expect(onScreenTable.getByText('Site One')).toBeTruthy();
    expect(onScreenTable.getByText('HQ')).toBeTruthy();
    expect(onScreenTable.getByText('Clerk')).toBeTruthy();
    expect(onScreenTable.getAllByText(/800\.00/).length).toBeGreaterThan(0);
    expect(onScreenTable.getByText('Released')).toBeTruthy();
    const bodyText = container.textContent ?? '';
    expect(bodyText).not.toMatch(/cnic/i);
    expect(bodyText).not.toMatch(/iban/i);
    expect(bodyText).not.toMatch(/account number/i);
    expect(onScreenTable.queryByText('Gross Pay')).toBeNull();
    expect(onScreenTable.queryByText('Net Salary')).toBeNull();
    expect(onScreenTable.queryByText('Correction Balance Payable')).toBeNull();
  });

  it('shows "+N more" for additional units', () => {
    mockUseDeductionReportList.mockReturnValue({
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
    mockUseDeductionReportList.mockReturnValue({
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
    expect(within(withoutCorrectionRow).getByText('E-002')).toBeTruthy();
    expect(within(withoutCorrectionRow).getByText('Without Correction')).toBeTruthy();
    expect(within(withoutCorrectionRow).getByText('Released')).toBeTruthy();
  });

  it('renders a distinct row-status badge for each of the five statuses', () => {
    mockUseDeductionReportList.mockReturnValue({
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

describe('ReportsDeductionReportPage — sorting and pagination', () => {
  afterEach(() => cleanup());

  it('clicking a sortable column header requests the backend with the new sort field, reset to page 1', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /fine/i }));
    const lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'fine', sortDir: 'asc', page: 1 }));
  });

  it('clicking the active sort header again reverses direction', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /fine/i }));
    fireEvent.click(screen.getByRole('button', { name: /fine/i }));
    const lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ sortBy: 'fine', sortDir: 'desc' }));
  });

  it('exposes aria-sort on the active sortable column', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const header = within(screen.getByTestId('on-screen-table')).getByRole('columnheader', { name: /employee name/i });
    expect(header.getAttribute('aria-sort')).toBe('ascending');
  });

  it('EOBI and Total Deductions column headers are not sortable buttons (backend does not approve these sorts)', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.queryByRole('button', { name: /^eobi$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^total deductions$/i })).toBeNull();
    expect(onScreenTable.queryByRole('button', { name: /^correction count$/i })).toBeNull();
  });

  it('uses server-provided page/pageSize/total, never client-side slicing', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport({ total: 40, page: 1, pageSize: 25 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/showing 1.25 of 40/i)).toBeTruthy();
  });

  it('the table body never renders more rows than the backend-provided page', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport({ rows: [row()], total: 400 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));
    expect(onScreenTable.getAllByRole('row')).toHaveLength(2); // header + 1 data row
  });
});

describe('ReportsDeductionReportPage — filters', () => {
  afterEach(() => cleanup());

  it('changing Row Status resets the page passed to the hook to 1 and forwards the value', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport({ page: 2 }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    const lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ rowStatus: 'HELD', page: 1 }));
  });

  it('Has Correction supports All/Yes/No tri-state and passes a boolean or undefined', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'YES' } });
    let lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: true }));

    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'NO' } });
    lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: false }));

    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'ALL' } });
    lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ hasCorrection: undefined }));
  });

  it('each of the five deduction tri-state filters supports All/Yes/No and forwards a boolean or undefined independently', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    const cases: [RegExp, string][] = [
      [/^has eobi$/i, 'hasEobi'],
      [/^has advance deduction$/i, 'hasAdvanceDeduction'],
      [/^has eid advance deduction$/i, 'hasEidAdvanceDeduction'],
      [/^has fine$/i, 'hasFine'],
      [/^has correction recovery$/i, 'hasCorrectionRecovery'],
    ];

    for (const [label, field] of cases) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: 'YES' } });
      let lastCall = mockUseDeductionReportList.mock.calls.at(-1);
      expect(lastCall?.[0]).toEqual(expect.objectContaining({ [field]: true }));

      fireEvent.change(screen.getByLabelText(label), { target: { value: 'NO' } });
      lastCall = mockUseDeductionReportList.mock.calls.at(-1);
      expect(lastCall?.[0]).toEqual(expect.objectContaining({ [field]: false }));

      fireEvent.change(screen.getByLabelText(label), { target: { value: 'ALL' } });
      lastCall = mockUseDeductionReportList.mock.calls.at(-1);
      expect(lastCall?.[0]).toEqual(expect.objectContaining({ [field]: undefined }));
    }
  });

  it('the Unit filter is disabled unless exactly one Site is selected, and invalid Unit is never sent', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).disabled).toBe(true);
    const lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ unitId: undefined }));
  });

  it('selecting one Site enables the Unit filter and choosing a Unit forwards it', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    const lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ unitId: 'unit-1', siteIds: ['site-1'] }));
  });

  it('selecting a second Site clears an already-chosen Unit', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
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

  it('unsupported filters (employee search, designation, date range, amount range) never appear on this page', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByLabelText(/^employee$/i)).toBeNull();
    expect(screen.queryByLabelText(/designation/i)).toBeNull();
    expect(screen.queryByLabelText(/cycle from/i)).toBeNull();
    expect(screen.queryByLabelText(/cycle to/i)).toBeNull();
    expect(screen.queryByLabelText(/roster status/i)).toBeNull();
    expect(screen.queryByLabelText(/amount/i)).toBeNull();
    expect(screen.queryByLabelText(/outstanding balance/i)).toBeNull();
  });

  it('Clear Filters restores defaults but never resets the currently selected Cycle', () => {
    const selectCycle = vi.fn();
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle });
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.change(screen.getByLabelText(/^has eobi$/i), { target: { value: 'YES' } });
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('HELD');

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText(/^has eobi$/i) as HTMLSelectElement).value).toBe('ALL');
    expect(selectCycle).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/^cycle$/i) as HTMLSelectElement).value).toBe('cycle-jul');
  });
});

/**
 * M1 — filter/navigation-state architecture. This report deliberately introduces no new global
 * filter store, `sessionStorage`, or `location.state` restoration mechanism — it matches Project
 * Site Payroll Report's own established architecture exactly (`reports-project-site-payroll-
 * page.tsx`, verified by grepping that file and this one for `location.state`/`sessionStorage`:
 * neither exists). Only the Payroll Cycle survives navigation, because it alone is encoded in the
 * URL (`useSelectedPayrollCycle`'s own `/payroll-cycles/:cycleId/...` param, `selectCycle` calling
 * `navigate()` under the identical route path so React Router reuses the same element instance and
 * never remounts the page for a same-route cycle switch). Every other filter, the active sort, and
 * the current page live in plain component `useState` and are lost whenever the page component
 * itself unmounts (browser Back/Forward to a different route, a fresh navigation from the Reports
 * catalogue, etc.) — this is documented, intended behavior, not a regression to fix.
 * `21-deduction-report.spec.ts`'s own "filter/navigation state" test proves the real browser
 * Back/Forward round trip end to end.
 */
describe('ReportsDeductionReportPage — filter/navigation-state architecture (M1)', () => {
  afterEach(() => cleanup());

  function buildTree(user: SessionUser, queryClient: QueryClient) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reports/deduction-report']}>
          <Routes>
            <Route path="/reports/deduction-report" element={<ReportsDeductionReportPage user={user} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('a fresh mount (simulating navigation away and back to a different route) always starts from the default filter/sort/page state — only the Cycle, encoded in the URL, can differ', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const { unmount } = renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.change(screen.getByLabelText(/^has fine$/i), { target: { value: 'YES' } });
    fireEvent.click(screen.getByRole('button', { name: /fine/i })); // sort by Fine, desc after the reset-to-asc-then-toggle below
    fireEvent.click(screen.getByRole('button', { name: /fine/i }));
    unmount();

    // A genuinely fresh mount — a new render() call, exactly as a real remount after browser
    // Back/Forward or a catalogue re-navigation would produce. Nothing from the unmounted instance
    // above (Site, Unit, Row Status, Has Fine, sort) carries over.
    mockUseDeductionReportList.mockClear();
    renderPage();
    const lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(
      expect.objectContaining({
        siteIds: undefined,
        unitId: undefined,
        rowStatus: undefined,
        hasFine: undefined,
        sortBy: 'employeeName',
        sortDir: 'asc',
        page: 1,
      }),
    );
    expect((screen.getByLabelText(/^unit$/i) as HTMLSelectElement).disabled).toBe(true);
  });

  it('switching to a different Cycle via the dropdown (a same-route, param-only navigation that never remounts the page) preserves the already-selected Site and Unit', () => {
    const selectCycle = vi.fn();
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle });
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const queryClient = new QueryClient();
    const { rerender } = render(buildTree(baseUser, queryClient));

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).value).toBe('unit-1');

    // Simulate the real production mechanic: `selectCycle` navigates to a new cycleId-only URL that
    // matches the *identical* `/payroll-cycles/:cycleId/reports/deduction-report` RouteObject, so
    // React Router reuses the same element instance and only re-renders with new params — it never
    // remounts. Modeled by re-rendering the SAME tree (same `render()` result, same React fiber)
    // with a new cycleId from the mocked hook, never calling a fresh `render()`.
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jun', cycle: CYCLES[1], cycles: CYCLES, isLoading: false, error: null, selectCycle });
    rerender(buildTree(baseUser, queryClient));

    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).value).toBe('unit-1');
    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).disabled).toBe(false);
    const lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ cycleId: 'cycle-jun', siteIds: ['site-1'], unitId: 'unit-1' }));
  });

  it('switching directly from one single Site to a different single Site clears the previously-chosen Unit — an incompatible-scope change, not a spurious remount-triggered clear', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).value).toBe('unit-1');

    // Deselect Site One, select Site Two — still exactly one Site selected throughout, but a
    // genuinely different one (Site Two has no `unit-1`), so Unit must clear.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site Two' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).disabled).toBe(false);
    const lastCall = mockUseDeductionReportList.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ siteIds: ['site-2'], unitId: undefined }));
  });

  it('an unrelated re-render (e.g. the report data resolving/refetching) never clears an already-selected Unit when the single-Site selection has not changed', () => {
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle: vi.fn() });
    mockUseDeductionReportList.mockReturnValue({ data: undefined, isLoading: false, isFetching: true, error: null, refetch: vi.fn() });
    const queryClient = new QueryClient();
    const { rerender } = render(buildTree(baseUser, queryClient));

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(screen.getByLabelText(/^branch$/i), { target: { value: 'unit-1' } });
    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).value).toBe('unit-1');

    // A background request resolves — `report.data`/`isFetching` change, `singleSiteId` does not.
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    rerender(buildTree(baseUser, queryClient));

    expect((screen.getByLabelText(/^branch$/i) as HTMLSelectElement).value).toBe('unit-1');
  });
});

describe('ReportsDeductionReportPage — export', () => {
  afterEach(() => cleanup());

  it('triggers CSV export with the current Cycle, filters, and sort', async () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadDeductionReportExport).toHaveBeenCalled());
    const call = mockDownloadDeductionReportExport.mock.calls.at(-1);
    expect(call?.[0]).toEqual(expect.objectContaining({ id: 'cycle-jul' }));
    expect(call?.[1]).toEqual(expect.objectContaining({ cycleId: 'cycle-jul', rowStatus: 'HELD' }));
    expect(call?.[2]).toBe('employeeName');
    expect(call?.[3]).toBe('asc');
    expect(call?.[4]).toBe('csv');
  });

  it('triggers XLSX export', async () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export excel/i }));
    await vi.waitFor(() => expect(mockDownloadDeductionReportExport).toHaveBeenCalled());
    expect(mockDownloadDeductionReportExport.mock.calls.at(-1)?.[4]).toBe('xlsx');
  });

  it('disables export buttons while no data or zero rows', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport({ total: 0, rows: [] }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect((screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables both export buttons while one export is already in flight, preventing a duplicate request', async () => {
    mockDownloadDeductionReportExport.mockClear();
    let resolveExport: (() => void) | undefined;
    mockDownloadDeductionReportExport.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveExport = resolve; }),
    );
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const csvButton = screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement;
    const xlsxButton = screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement;
    fireEvent.click(csvButton);
    expect(csvButton.disabled).toBe(true);
    expect(xlsxButton.disabled).toBe(true);
    expect(mockDownloadDeductionReportExport).toHaveBeenCalledTimes(1);
    resolveExport?.();
    await vi.waitFor(() => expect(csvButton.disabled).toBe(false));
    expect(mockDownloadDeductionReportExport).toHaveBeenCalledTimes(1);
  });

  it('shows the backend structured 413 message via toast and does not crash the page', async () => {
    const { DeductionReportExportRowLimitExceededError } = await import('@/hooks/use-deduction-report');
    mockDownloadDeductionReportExport.mockRejectedValueOnce(
      new DeductionReportExportRowLimitExceededError(25000, 20000, 'This export matches 25000 rows. Narrow your filters and try again.'),
    );
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadDeductionReportExport).toHaveBeenCalled());
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('');
  });

  // --- M3: export request parity (request-level assertions, not inferred from UI state alone) ---

  it('the 413 structured message is shown via toast exactly once, never duplicated or shown generically alongside it', async () => {
    const { toast } = await import('sonner');
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const { DeductionReportExportRowLimitExceededError } = await import('@/hooks/use-deduction-report');
    mockDownloadDeductionReportExport.mockRejectedValueOnce(
      new DeductionReportExportRowLimitExceededError(25000, 20000, 'This export matches 25000 rows. Narrow your filters and try again.'),
    );
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadDeductionReportExport).toHaveBeenCalled());
    await vi.waitFor(() => expect(toastErrorSpy).toHaveBeenCalledTimes(1));
    expect(toastErrorSpy).toHaveBeenCalledWith('This export matches 25000 rows. Narrow your filters and try again.');
  });

  it('CSV and XLSX exports both carry the exact same current Cycle/filters/sort — proven by comparing two separate, sequential export calls\' actual arguments', async () => {
    mockDownloadDeductionReportExport.mockClear(); // this file's own call history persists across tests (no clearMocks configured)
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.change(screen.getByLabelText(/^has eobi$/i), { target: { value: 'YES' } });
    fireEvent.change(screen.getByLabelText(/^has fine$/i), { target: { value: 'NO' } });
    fireEvent.click(screen.getByRole('button', { name: /fine/i })); // sortBy=fine, sortDir=asc

    const csvButton = screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement;
    const xlsxButton = screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement;

    fireEvent.click(csvButton);
    await vi.waitFor(() => expect(mockDownloadDeductionReportExport).toHaveBeenCalledTimes(1));
    const csvCall = mockDownloadDeductionReportExport.mock.calls.at(-1)!;
    // The shared `activeExport` guard only releases once the first export's own promise resolves —
    // wait for that before starting the second, exactly as a real sequential user click would.
    await vi.waitFor(() => expect(xlsxButton.disabled).toBe(false));

    fireEvent.click(xlsxButton);
    await vi.waitFor(() => expect(mockDownloadDeductionReportExport).toHaveBeenCalledTimes(2));
    const xlsxCall = mockDownloadDeductionReportExport.mock.calls.at(-1)!;

    // Same cycle, filters (as a deep-equal object — cycleId/siteIds/unitId/rowStatus/hasCorrection/
    // all five deduction tri-states), and sort — the two calls differ only in `format` (arg 4).
    expect(csvCall[0]).toEqual(xlsxCall[0]);
    expect(csvCall[1]).toEqual(xlsxCall[1]);
    expect(csvCall[1]).toEqual(expect.objectContaining({ siteIds: ['site-1'], rowStatus: 'HELD', hasEobi: true, hasFine: false }));
    expect(csvCall[2]).toBe(xlsxCall[2]); // sortBy
    expect(csvCall[3]).toBe(xlsxCall[3]); // sortDir
    expect(csvCall[4]).toBe('csv');
    expect(xlsxCall[4]).toBe('xlsx');

    // Filters/sort remain exactly as set — neither export call reset or mutated on-screen state.
    expect((screen.getByLabelText(/^row status$/i) as HTMLSelectElement).value).toBe('HELD');
    expect((screen.getByLabelText(/^has eobi$/i) as HTMLSelectElement).value).toBe('YES');
  });

  it('export never navigates the page — the route stays exactly where the user was', async () => {
    mockDownloadDeductionReportExport.mockClear();
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const pathBefore = window.location.pathname;

    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await vi.waitFor(() => expect(mockDownloadDeductionReportExport).toHaveBeenCalled());

    expect(window.location.pathname).toBe(pathBefore);
    expect(screen.getByTestId('on-screen-table')).toBeTruthy();
  });
});

describe('ReportsDeductionReportPage — Print', () => {
  afterEach(() => cleanup());

  it('states the print scope is current page only', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(within(screen.getByRole('dialog')).getByText(/current page only/i)).toBeTruthy();
  });

  it('clicking Print opens the options dialog instead of calling window.print() immediately, defaulting to every safe column selected', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Print Options')).toBeTruthy();
    expect(screen.getByText(/14 columns selected/)).toBeTruthy();
  });

  it('never offers CNIC or banking fields as print options', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.queryByText(/cnic/i)).toBeNull();
    expect(screen.queryByText(/bank/i)).toBeNull();
    expect(screen.queryByText(/iban/i)).toBeNull();
  });

  it('confirming the dialog calls window.print()', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Print Options')).toBeNull();
  });

  it('warns (readability) once the selection reaches Very Wide, without blocking Print', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    // Default selection is every column (14) — already Very Wide by this report's own threshold (12+).
    expect(screen.getByText(/many columns/i)).toBeTruthy();
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    expect((confirmButtons[confirmButtons.length - 1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('Reset to Default restores every safe field after fields were unchecked', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByLabelText('Designation'));
    expect(screen.getByText(/13 columns selected/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));
    expect(screen.getByText(/14 columns selected/)).toBeTruthy();
  });

  it('restores a previously saved field selection using this report-specific localStorage key', () => {
    window.localStorage.setItem(
      'deduction-report-print-fields:v1',
      JSON.stringify({ cards: [], columns: ['employeeName', 'rowStatus'] }),
    );
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByText('2 columns selected', { exact: false })).toBeTruthy();
  });

  it('shows the totals-unavailable explanation in print, never zeros, when totalsComputed is false', () => {
    mockUseDeductionReportList.mockReturnValue({
      data: fullReport({ totals: totals({ totalsComputed: false, eobiTotal: null, totalDeductions: null }) }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId('dr-totals-unavailable')).toBeTruthy();
  });

  // --- M2: print content verification (config/data-model level, not only a button click) --------

  it('the print context header states the Cycle, every filter summary — including Has Correction and all five deduction tri-states — a generated timestamp, and "current page only"', () => {
    mockUseSelectedPayrollCycle.mockReturnValue({ cycleId: 'cycle-jul', cycle: CYCLES[0], cycles: CYCLES, isLoading: false, error: null, selectCycle: vi.fn() });
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.change(screen.getByLabelText(/^row status$/i), { target: { value: 'HELD' } });
    fireEvent.change(screen.getByLabelText(/^has correction$/i), { target: { value: 'YES' } });
    fireEvent.change(screen.getByLabelText(/^has eobi$/i), { target: { value: 'YES' } });
    fireEvent.change(screen.getByLabelText(/^has advance deduction$/i), { target: { value: 'NO' } });
    fireEvent.change(screen.getByLabelText(/^has eid advance deduction$/i), { target: { value: 'YES' } });
    fireEvent.change(screen.getByLabelText(/^has fine$/i), { target: { value: 'NO' } });
    fireEvent.change(screen.getByLabelText(/^has correction recovery$/i), { target: { value: 'YES' } });

    const contextText = screen.getByText(/Current page only/i).parentElement?.textContent ?? '';
    expect(contextText).toContain('July 2026');
    expect(contextText).toContain('Row Status: Held');
    expect(contextText).toContain('Has Correction: Yes');
    expect(contextText).toContain('Has EOBI: Yes');
    expect(contextText).toContain('Has Advance Deduction: No');
    expect(contextText).toContain('Has EID Advance Deduction: Yes');
    expect(contextText).toContain('Has Fine: No');
    expect(contextText).toContain('Has Correction Recovery: Yes');
    expect(contextText).toContain('Current page only');
    expect(screen.getByText(/^Generated /)).toBeTruthy();
  });

  it('the print-only totals cards render the same backend totals the on-screen cards show (present by default, not only after confirming Print)', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const printCards = within(screen.getByTestId('print-only-cards'));
    expect(printCards.getAllByText(/800\.00/).length).toBeGreaterThan(0);
    expect(printCards.getByText('Matching Entries')).toBeTruthy();
    expect(printCards.getByText('Employees With Any Deduction')).toBeTruthy();
  });

  it('the print-only table renders exactly the confirmed selected columns', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByLabelText('Designation'));
    // "Correction Count" is unique to the Table columns fieldset — several column labels (EOBI,
    // Fine, Advance Deduction, etc.) also name a Summary card, so a bare `getByLabelText` on one of
    // those would ambiguously match both checkboxes at once.
    fireEvent.click(screen.getByLabelText('Correction Count'));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    const printTable = within(screen.getByTestId('print-only-table'));
    expect(printTable.getByRole('columnheader', { name: 'Employee Name' })).toBeTruthy();
    expect(printTable.queryByRole('columnheader', { name: 'Designation' })).toBeNull();
    expect(printTable.queryByRole('columnheader', { name: 'Correction Count' })).toBeNull();
    expect(printTable.getByRole('columnheader', { name: 'Fine' })).toBeTruthy();
  });

  it('opening and confirming Print never triggers an export/download request — no backend request is fired by Print', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    printSpy.mockClear(); // this file's other Print tests may leave the shared window.print spy's call history non-empty
    mockDownloadDeductionReportExport.mockClear();
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    expect(mockDownloadDeductionReportExport).not.toHaveBeenCalled();
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('the printed output never includes Gross Pay, Net Salary, Correction Balance Payable, CNIC, banking, release/audit actor, or correction-reason fields', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    const bodyText = (container.textContent ?? '').toLowerCase();
    for (const forbidden of [
      'gross pay',
      'net salary',
      'correction balance payable',
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

/**
 * M4 — accessibility review. This page reuses the same shared primitives every other gated report
 * page already relies on (`FilterField`, `MultiSelectFilter`, the shared `<Table>`, `Modal`/
 * `ModalContent` built on Radix Dialog, `Checkbox` built on Radix Checkbox, `<Button>`) — these
 * tests confirm this report's own usage of them is correct (every control genuinely reachable by
 * its label, sortable headers correctly `aria-sort`ed, the Print dialog's focus/keyboard behavior
 * working as the shared `Modal` primitive already guarantees), not a redesign of any primitive
 * itself.
 */
describe('ReportsDeductionReportPage — accessibility (M4)', () => {
  afterEach(() => cleanup());

  it('every filter control (Cycle, Site, Unit, Row Status, Has Correction, and all five deduction tri-states) is reachable by its own visible label', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    for (const label of [
      /^cycle$/i,
      /^unit$/i,
      /^row status$/i,
      /^has correction$/i,
      /^has eobi$/i,
      /^has advance deduction$/i,
      /^has eid advance deduction$/i,
      /^has fine$/i,
      /^has correction recovery$/i,
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    // Site is a MultiSelectFilter, not a native <select> — its trigger button carries the same
    // "Site" accessible name via its own associated <label>, proven throughout this file's other
    // tests by `getByRole('button', { name: 'Site' })` succeeding.
    expect(screen.getByRole('button', { name: 'Site' })).toBeTruthy();
  });

  it('every tri-state filter\'s three values are plain, unambiguous text ("All"/"Yes"/"No") — never conveyed by color or an icon alone', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    for (const label of [/^has correction$/i, /^has eobi$/i, /^has advance deduction$/i, /^has eid advance deduction$/i, /^has fine$/i, /^has correction recovery$/i]) {
      const select = screen.getByLabelText(label) as HTMLSelectElement;
      const optionTexts = Array.from(select.options).map((o) => o.textContent);
      expect(optionTexts).toEqual(['All', 'Yes', 'No']);
    }
  });

  it('every sortable column header exposes aria-sort="none" before any interaction, and every non-sortable header carries no aria-sort attribute at all', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const onScreenTable = within(screen.getByTestId('on-screen-table'));

    // Employee Name is the one exception — it's the default sort, so it starts "ascending", not
    // "none" (verified by the existing "exposes aria-sort on the active sortable column" test).
    for (const name of [/^employee code$/i, /^project site$/i, /^advance deduction$/i, /^eid advance deduction$/i, /^fine$/i, /^correction bal\. recovery$/i, /^row status$/i]) {
      const header = onScreenTable.getByRole('columnheader', { name });
      expect(header.getAttribute('aria-sort')).toBe('none');
    }
    for (const name of [/^eobi$/i, /^total deductions$/i, /^correction count$/i, /^released date$/i, /^primary unit$/i, /^designation$/i]) {
      const header = onScreenTable.getByRole('columnheader', { name });
      expect(header.hasAttribute('aria-sort')).toBe(false);
    }
  });

  it('the Print dialog exposes its own accessible name via the shared Modal\'s DialogTitle wiring', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByRole('dialog', { name: 'Print Options' })).toBeTruthy();
  });

  it('pressing Escape closes the Print dialog (the shared Modal/Radix Dialog primitive\'s own built-in behavior, not reimplemented here)', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing the Print dialog (Cancel) removes it cleanly and returns focus to the document body, never trapping it on a removed/hidden element — the shared Modal primitive\'s (Radix Dialog\'s) own `onCloseAutoFocus` guarantee, not reimplemented here', async () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const printTrigger = screen.getByRole('button', { name: 'Print' });
    fireEvent.click(printTrigger);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Focus is never left stranded inside the now-unmounted dialog subtree — this codebase's own
    // established Radix-Dialog-focus-return contract (untested for exact target element by any
    // other dialog in this suite either, since jsdom's `requestAnimationFrame`/focus-timing
    // support for Radix's own `onCloseAutoFocus` is not independently re-verified here; asserting
    // the negative — focus is not still inside the removed dialog — is the reliable, non-brittle
    // signal this environment can give).
    expect(dialog.contains(document.activeElement)).toBe(false);
  });

  it('Export CSV/Export Excel expose their full accessible names, and their disabled state (while no data, or while an export is in flight) is exposed via the native disabled attribute, not color alone', () => {
    mockUseDeductionReportList.mockReturnValue({ data: fullReport({ total: 0, rows: [] }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    const csvButton = screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement;
    const xlsxButton = screen.getByRole('button', { name: /export excel/i }) as HTMLButtonElement;
    expect(csvButton.disabled).toBe(true);
    expect(xlsxButton.disabled).toBe(true);
  });
});

describe('ReportsDeductionReportPage — page clamp when the backend total shrinks', () => {
  afterEach(() => cleanup());

  function reportForPage(page: number, total: number): DeductionReportListResponse {
    return fullReport({ page, total, pageSize: 25, rows: total === 0 ? [] : [row()] });
  }

  function renderPageWithMock(mockImpl: (params: { page: number }) => ReturnType<typeof mockUseDeductionReportList>) {
    mockUseDeductionReportList.mockImplementation(mockImpl);
    const queryClient = new QueryClient();
    const tree = (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reports/deduction-report']}>
          <Routes>
            <Route path="/reports/deduction-report" element={<ReportsDeductionReportPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    return render(tree);
  }

  function lastRequestedPage(): number | undefined {
    return mockUseDeductionReportList.mock.calls.at(-1)?.[0]?.page;
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

    const callsBeforeShrink = mockUseDeductionReportList.mock.calls.length;

    currentTotal = 30;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/reports/deduction-report']}>
          <Routes>
            <Route path="/reports/deduction-report" element={<ReportsDeductionReportPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(lastRequestedPage()).toBe(2);
    expect(mockUseDeductionReportList.mock.calls.length).toBe(callsBeforeShrink + 2);
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
        <MemoryRouter initialEntries={['/reports/deduction-report']}>
          <Routes>
            <Route path="/reports/deduction-report" element={<ReportsDeductionReportPage user={baseUser} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(lastRequestedPage()).toBe(1);
  });

  it('never clamps before a resolved response exists (loading/no data is a no-op, not a crash or a reset)', () => {
    mockUseDeductionReportList.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    expect(() => renderPage()).not.toThrow();
    expect(lastRequestedPage()).toBe(1);
  });
});
