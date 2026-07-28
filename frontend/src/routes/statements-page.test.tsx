// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionUser } from '@payroll/shared';
import { ApiError } from '@/lib/api-client';
import type { EmployeeStatement } from '@/hooks/use-employee-statement';

/**
 * Phase 7A Checkpoint 2 — Statements frontend page tests. Every data-fetching hook is mocked to a
 * controlled, already-resolved value (this codebase's own established pattern,
 * `payroll-entry-page.test.tsx`) — these tests exercise the page's own selection/gating/rendering
 * logic, never a real backend. Real browser/network verification is Playwright's job (this
 * checkpoint's own separate browser-verification pass), not these unit tests.
 */

const mockUseEmployeeStatement = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-employee-statement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-employee-statement')>();
  return { ...actual, useEmployeeStatement: mockUseEmployeeStatement };
});

vi.mock('@/hooks/use-project-sites', () => ({
  useAccessibleProjectSites: () => ({
    data: [
      { id: 'site-1', name: 'Site One', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
      { id: 'site-2', name: 'Site Two', address: null, unitLabel: 'Department', isActive: true, createdAt: '', updatedAt: '' },
    ],
    isLoading: false,
    error: undefined,
  }),
}));

vi.mock('@/hooks/use-project-units', () => ({
  useProjectUnits: (siteId: string | undefined) => ({
    data:
      siteId === 'site-1'
        ? [{ id: 'unit-1', siteId: 'site-1', name: 'Branch One', code: null, isActive: true, createdAt: '', updatedAt: '' }]
        : [],
    isLoading: false,
    error: undefined,
  }),
}));

vi.mock('@/hooks/use-payroll-cycles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-cycles')>();
  const cycles = [
    { id: 'cycle-jul', year: 2026, month: 7, status: 'DRAFT', sourceCycleId: null, createdAt: '', createdBy: '', releasedAt: null, releasedBy: null, archivedAt: null, archivedBy: null, isCurrentDraft: true },
    { id: 'cycle-jun', year: 2026, month: 6, status: 'RELEASED', sourceCycleId: null, createdAt: '', createdBy: '', releasedAt: null, releasedBy: null, archivedAt: null, archivedBy: null, isCurrentDraft: false },
    { id: 'cycle-may', year: 2026, month: 5, status: 'RELEASED', sourceCycleId: null, createdAt: '', createdBy: '', releasedAt: null, releasedBy: null, archivedAt: null, archivedBy: null, isCurrentDraft: false },
  ];
  return { ...actual, usePayrollCycles: () => ({ data: cycles, isLoading: false, error: undefined }) };
});

// A minimal, controlled stand-in for the real searchable StatementEmployeeLookup (its own
// search/debounce/candidate-rendering behavior is out of scope for this file — that's this
// component's own future dedicated test, mirroring `employee-lookup.test.tsx`'s precedent) — a
// plain `<select>` is enough to drive this page's own selection/gating logic. `siteId`/`unitId`
// are surfaced as data-attributes so a test can assert exactly what narrowing filters the page
// passed through, without needing to inspect the real network call.
vi.mock('@/components/statements/statement-employee-lookup', () => ({
  StatementEmployeeLookup: ({
    id,
    value,
    onChange,
    siteId,
    unitId,
    disabled,
  }: {
    id: string;
    value: string;
    onChange: (id: string, candidate: undefined) => void;
    siteId?: string;
    unitId?: string;
    disabled?: boolean;
  }) => (
    <select
      id={id}
      data-testid="employee-lookup"
      data-site-id={siteId ?? ''}
      data-unit-id={unitId ?? ''}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value, undefined)}
    >
      <option value="">Search…</option>
      <option value="emp-1">Jane Doe (E-001)</option>
      <option value="emp-2">Jane Roe (E-002)</option>
    </select>
  ),
}));

const { StatementsPage } = await import('./statements-page');

const baseUser: SessionUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@test.local',
  roleId: 'role-1',
  roleCode: 'PAYROLL_STAFF',
  roleName: 'Payroll Staff',
  permissions: ['statements:view'] as SessionUser['permissions'],
  siteIds: ['site-1'],
  themeAccentColor: '#000000',
};

function renderPage(user: SessionUser = baseUser) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/statements']}>
        <Routes>
          <Route path="/statements" element={<StatementsPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function selectEmployee(employeeId = 'emp-1') {
  fireEvent.change(screen.getByTestId('employee-lookup'), { target: { value: employeeId } });
}

const OPENING_BALANCES = { payableOutstanding: '600.00', recoveryOutstanding: '0.00', advanceOutstanding: '500.00' };
const CLOSING_BALANCES = { payableOutstanding: '100.00', recoveryOutstanding: '250.00', advanceOutstanding: '200.00' };

function fullStatement(overrides: Partial<EmployeeStatement> = {}): EmployeeStatement {
  return {
    employee: {
      employeeId: 'emp-1',
      employeeCode: 'E-001',
      cnic: '35201-1234567-1',
      name: 'Jane Doe',
      currentSiteId: 'site-1',
      currentSiteName: 'Site One',
    },
    range: {
      fromCycle: { id: 'cycle-jun', year: 2026, month: 6 },
      toCycle: { id: 'cycle-jul', year: 2026, month: 7 },
      cycleCount: 2,
    },
    scope: { advanceHistoryIncluded: true },
    openingBalances: OPENING_BALANCES,
    closingBalances: CLOSING_BALANCES,
    entries: [
      {
        id: 'correction:c1',
        date: '2026-06-05',
        cycleId: 'cycle-jun',
        cycleYear: 2026,
        cycleMonth: 6,
        category: 'CORRECTION',
        kind: 'CORRECTION_APPROVED',
        isInformational: true,
        movement: null,
        runningBalances: { payableOutstanding: '600.00', recoveryOutstanding: '0.00', advanceOutstanding: '500.00' },
        description: 'Correction Approved — Gross Pay changed from 50000 to 55000 (typo)',
        reference: { correctionId: 'c1' },
        sequence: 0,
      },
      {
        id: 'balance-adjustment-created:ba1',
        date: '2026-06-05',
        cycleId: 'cycle-jun',
        cycleYear: 2026,
        cycleMonth: 6,
        category: 'CORRECTION',
        kind: 'BALANCE_ADJUSTMENT_CREATED',
        isInformational: false,
        movement: { balance: 'PAYABLE', direction: 'INCREASE', amount: '5000.00' },
        runningBalances: { payableOutstanding: '5600.00', recoveryOutstanding: '0.00', advanceOutstanding: '500.00' },
        description: 'Balance Salary Payable created',
        reference: { correctionId: 'c1', balanceAdjustmentId: 'ba1' },
        sequence: 1,
      },
      {
        id: 'balance-adjustment-settlement:s1',
        date: '2026-07-01',
        cycleId: 'cycle-jul',
        cycleYear: 2026,
        cycleMonth: 7,
        category: 'CORRECTION',
        kind: 'BALANCE_ADJUSTMENT_SETTLED',
        isInformational: false,
        movement: { balance: 'PAYABLE', direction: 'DECREASE', amount: '5500.00' },
        runningBalances: { payableOutstanding: '100.00', recoveryOutstanding: '250.00', advanceOutstanding: '200.00' },
        description: 'Balance Salary Payable Settled — 2026-07: PKR 5500.00 applied',
        reference: { balanceAdjustmentId: 'ba1', balanceAdjustmentSettlementId: 's1' },
        sequence: 2,
      },
    ],
    generatedAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('StatementsPage — RBAC', () => {
  afterEach(() => cleanup());

  it('shows an access-denied state and no selection controls without statements:view', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage({ ...baseUser, permissions: [] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to statements/i)).toBeTruthy();
    expect(screen.queryByTestId('employee-lookup')).toBeNull();
  });
});

describe('StatementsPage — Employee-first selection (Checkpoint 2 correction)', () => {
  afterEach(() => cleanup());

  it('the Employee field is enabled immediately, with no Site/Unit prerequisite', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect((screen.getByTestId('employee-lookup') as HTMLSelectElement).disabled).toBe(false);
  });

  it('disables the Unit filter until a Site is chosen — a Unit is meaningless without one', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect((screen.getByLabelText(/^Unit \(optional\)/) as HTMLSelectElement).disabled).toBe(true);
  });

  it('enables the Unit filter, using the Site own unit label, once a Site is chosen', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Site \(optional/), { target: { value: 'site-1' } });
    expect((screen.getByLabelText(/^Branch \(optional\)/) as HTMLSelectElement).disabled).toBe(false);
  });

  it('passes the chosen Site/Unit through to the Employee lookup as narrowing filters, never as a gate', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Site \(optional/), { target: { value: 'site-1' } });
    fireEvent.change(screen.getByLabelText(/^Branch \(optional\)/), { target: { value: 'unit-1' } });
    const lookup = screen.getByTestId('employee-lookup');
    expect(lookup.getAttribute('data-site-id')).toBe('site-1');
    expect(lookup.getAttribute('data-unit-id')).toBe('unit-1');
    expect((lookup as HTMLSelectElement).disabled).toBe(false);
  });

  it('clears an already-selected Employee when the Site filter changes, never silently re-validating it', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    selectEmployee('emp-1');
    expect((screen.getByTestId('employee-lookup') as HTMLSelectElement).value).toBe('emp-1');
    fireEvent.change(screen.getByLabelText(/^Site \(optional/), { target: { value: 'site-2' } });
    expect((screen.getByTestId('employee-lookup') as HTMLSelectElement).value).toBe('');
  });

  it('clears an already-selected Employee when the Unit filter changes', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Site \(optional/), { target: { value: 'site-1' } });
    selectEmployee('emp-1');
    fireEvent.change(screen.getByLabelText(/^Branch \(optional\)/), { target: { value: 'unit-1' } });
    expect((screen.getByTestId('employee-lookup') as HTMLSelectElement).value).toBe('');
  });

  it('does not load a Statement until an Employee is selected', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(mockUseEmployeeStatement).toHaveBeenLastCalledWith(undefined, { fromCycleId: undefined, toCycleId: undefined });
    expect(screen.getByText(/search for an employee/i)).toBeTruthy();
  });

  it('never implies that selecting an employee grants access to their full history', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/never grants visibility into their full history/i)).toBeTruthy();
  });
});

describe('StatementsPage — Statement request parameters', () => {
  afterEach(() => cleanup());

  it('requests the selected employee with no range once Employee is chosen (Latest 12 Cycles default)', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    selectEmployee('emp-1');
    expect(mockUseEmployeeStatement).toHaveBeenLastCalledWith('emp-1', { fromCycleId: undefined, toCycleId: undefined });
  });

  it('does not request a Statement while a Custom Range is only partially chosen', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    selectEmployee('emp-1');
    fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }));
    fireEvent.change(screen.getByLabelText('From Cycle'), { target: { value: 'cycle-may' } });
    expect(mockUseEmployeeStatement).toHaveBeenLastCalledWith(undefined, { fromCycleId: undefined, toCycleId: undefined });
  });

  it('requests the exact fromCycleId/toCycleId once a full Custom Range is chosen', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    selectEmployee('emp-1');
    fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }));
    fireEvent.change(screen.getByLabelText('From Cycle'), { target: { value: 'cycle-may' } });
    fireEvent.change(screen.getByLabelText('To Cycle'), { target: { value: 'cycle-jul' } });
    expect(mockUseEmployeeStatement).toHaveBeenLastCalledWith('emp-1', { fromCycleId: 'cycle-may', toCycleId: 'cycle-jul' });
  });

  it('refuses to request a Statement, and shows an inline warning, when From is later than To', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    selectEmployee('emp-1');
    fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }));
    fireEvent.change(screen.getByLabelText('From Cycle'), { target: { value: 'cycle-jul' } });
    fireEvent.change(screen.getByLabelText('To Cycle'), { target: { value: 'cycle-may' } });
    expect(mockUseEmployeeStatement).toHaveBeenLastCalledWith(undefined, { fromCycleId: undefined, toCycleId: undefined });
    expect(screen.getByText(/from cycle must not be later than to cycle/i)).toBeTruthy();
  });
});

describe('StatementsPage — Loading, empty, and error states', () => {
  afterEach(() => cleanup());

  it('shows a loading state and disables the selection controls while a request is pending', () => {
    mockUseEmployeeStatement.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() });
    renderPage();
    selectEmployee('emp-1');
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect((screen.getByLabelText(/^Site \(optional/) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByTestId('employee-lookup') as HTMLSelectElement).disabled).toBe(true);
  });

  it('shows a useful empty state when the resolved Statement has no ledger entries', () => {
    mockUseEmployeeStatement.mockReturnValue({
      data: fullStatement({ entries: [], closingBalances: OPENING_BALANCES }),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    selectEmployee('emp-1');
    expect(screen.getByText(/no ledger entries for this statement period/i)).toBeTruthy();
    // Opening/Closing Balances still render even with zero entries.
    expect(screen.getByText('Opening Balances')).toBeTruthy();
    expect(screen.getByText('Closing Balances')).toBeTruthy();
  });

  it('shows a 403 state with no retry action and no raw backend detail', () => {
    mockUseEmployeeStatement.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new ApiError(403, 'FORBIDDEN', 'insufficient permission'),
      refetch: vi.fn(),
    });
    renderPage();
    selectEmployee('emp-1');
    expect(screen.getByText(/you do not have access to this statement/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.queryByText('insufficient permission')).toBeNull();
  });

  it('shows a safe 404 state (covers both genuine not-found and site-scope concealment) with no retry action', () => {
    mockUseEmployeeStatement.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new ApiError(404, 'NOT_FOUND', 'Employee not found'),
      refetch: vi.fn(),
    });
    renderPage();
    selectEmployee('emp-1');
    expect(screen.getByText(/no statement is available for this selection/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.queryByText(/no advances|does not exist/i)).toBeNull();
  });

  it('shows a generic retryable state for a network/server failure, and refetch() is called on retry', () => {
    const refetch = vi.fn();
    mockUseEmployeeStatement.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new ApiError(500, 'INTERNAL_ERROR', 'boom'),
      refetch,
    });
    renderPage();
    selectEmployee('emp-1');
    const retryButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryButton);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('StatementsPage — Statement rendering', () => {
  afterEach(() => cleanup());

  function renderWithStatement(statement: EmployeeStatement) {
    mockUseEmployeeStatement.mockReturnValue({ data: statement, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderPage();
    selectEmployee('emp-1');
  }

  it('renders the Statement header as an Employee Statement of Account, not a Payslip', () => {
    renderWithStatement(fullStatement());
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('Employee Statement of Account')).toBeTruthy();
    expect(screen.queryByText(/payslip/i)).toBeNull();
    expect(screen.getByText('E-001')).toBeTruthy();
    expect(screen.getByText('35201-1234567-1')).toBeTruthy();
  });

  it('renders Opening Balances with Payable/Recovery/Advance kept separate, never combined', () => {
    renderWithStatement(fullStatement());
    const openingCard = screen.getByText('Opening Balances').closest('.rounded-lg') as HTMLElement;
    expect(within(openingCard).getByText('PKR 600.00')).toBeTruthy(); // payableOutstanding
    expect(within(openingCard).getByText('PKR 0.00')).toBeTruthy(); // recoveryOutstanding
    expect(within(openingCard).getByText('PKR 500.00')).toBeTruthy(); // advanceOutstanding
    expect(within(openingCard).queryByText(/^PKR 1,100\.00$/)).toBeNull(); // never a summed total
  });

  it('renders Closing Balances with Payable/Recovery/Advance kept separate, never combined', () => {
    renderWithStatement(fullStatement());
    const closingCard = screen.getByText('Closing Balances').closest('.rounded-lg') as HTMLElement;
    expect(within(closingCard).getByText('PKR 100.00')).toBeTruthy();
    expect(within(closingCard).getByText('PKR 250.00')).toBeTruthy();
    expect(within(closingCard).getByText('PKR 200.00')).toBeTruthy();
  });

  it('renders a financial movement row with direction, amount, and the affected balance', () => {
    renderWithStatement(fullStatement());
    const row = screen.getByText('Balance Salary Payable created').closest('tr') as HTMLElement;
    expect(within(row).getByText(/\+\s*PKR 5,000\.00/)).toBeTruthy();
    expect(within(row).getByText('Payable')).toBeTruthy();
    expect(within(row).queryByText('Informational')).toBeNull();
  });

  it('renders an informational row without a monetary movement figure in its Movement cell', () => {
    renderWithStatement(fullStatement());
    const row = screen.getByText(/Correction Approved/).closest('tr') as HTMLElement;
    // Movement is the 4th cell (Date/Period, Category, Description, Movement, then the three
    // always-populated Running Balance cells) — those trailing cells legitimately show PKR
    // figures even on an informational row, so the assertion is scoped to the Movement cell only.
    const movementCell = within(row).getAllByRole('cell')[3]!;
    expect(within(movementCell).getByText('Informational')).toBeTruthy();
    expect(within(movementCell).queryByText(/PKR/)).toBeNull();
  });

  it('renders each row own runningBalances exactly as supplied, never a frontend recalculation', () => {
    renderWithStatement(fullStatement());
    // The middle row's runningBalances (5600.00 / 0.00 / 500.00) differ from both the opening
    // (600/0/500) and closing (100/250/200) balances — if this figure appears verbatim, it can
    // only have come from that row's own `runningBalances`, not from any local arithmetic.
    const row = screen.getByText('Balance Salary Payable created').closest('tr') as HTMLElement;
    expect(within(row).getByText('PKR 5,600.00')).toBeTruthy();
  });

  it('shows the Advance-history restriction notice when the scope says CURRENT_SITE_OUT_OF_SCOPE, without implying "no advances"', () => {
    renderWithStatement(fullStatement({ scope: { advanceHistoryIncluded: false, advanceHistoryRestriction: 'CURRENT_SITE_OUT_OF_SCOPE' } }));
    expect(screen.getByText(/advance history restricted/i)).toBeTruthy();
    expect(screen.queryByText(/no advances/i)).toBeNull();
  });

  it('does not show the Advance-history restriction notice for a normal full-scope response', () => {
    renderWithStatement(fullStatement({ scope: { advanceHistoryIncluded: true } }));
    expect(screen.queryByText(/advance history restricted/i)).toBeNull();
  });

  it('renders a long ledger inside a horizontally-scrollable container, not an unbounded page-wide overflow', () => {
    const manyEntries = Array.from({ length: 60 }, (_, i) => ({
      ...fullStatement().entries[0]!,
      id: `entry-${i}`,
      description: `A reasonably long description for ledger row number ${i} to check wrapping behaviour`,
    }));
    renderWithStatement(fullStatement({ entries: manyEntries }));
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(60);
    const scrollContainer = document.querySelector('.overflow-x-auto');
    expect(scrollContainer).toBeTruthy();
  });
});

describe('StatementsPage — no financial mutation', () => {
  it('imports no mutation hook and issues no non-GET request path', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(currentDir, 'statements-page.tsx'), 'utf-8');
    expect(source).not.toMatch(/useMutation/);
    expect(source).not.toMatch(/method:\s*['"](POST|PATCH|PUT|DELETE)['"]/);
  });
});
