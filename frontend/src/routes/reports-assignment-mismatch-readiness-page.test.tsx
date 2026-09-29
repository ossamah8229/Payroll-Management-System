// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AssignmentMismatchReadinessListResponse, AssignmentMismatchReadinessRow, SessionUser } from '@payroll/shared';

/**
 * Bulk Assignment-Mismatch Readiness Audit (approved 2026-09-28 architecture review) — list page
 * tests. Every data-fetching hook is mocked to a controlled, already-resolved value (this
 * codebase's own established pattern, `reports-overtime-report-page.test.tsx`) — these tests
 * exercise the page's own permission-gating, filter wiring, informational-only rendering, and empty
 * states, never a real backend. Real browser/network verification is Playwright's job.
 *
 * **The one behavior genuinely load-bearing for this page, checked explicitly below**: this report
 * renders NO mutation control of any kind — no Apply button, no bulk action, no
 * classification/review-state control. The existing "Apply current assignment" action lives
 * exclusively on the Payroll Entry grid, unchanged by this checkpoint.
 */

const mockUseAssignmentMismatchReadinessList = vi.hoisted(() => vi.fn());
const mockDownloadAssignmentMismatchReadinessExport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/hooks/use-assignment-mismatch-readiness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-assignment-mismatch-readiness')>();
  return {
    ...actual,
    useAssignmentMismatchReadinessList: mockUseAssignmentMismatchReadinessList,
    downloadAssignmentMismatchReadinessExport: mockDownloadAssignmentMismatchReadinessExport,
  };
});

const DRAFT_CYCLE = { id: 'cycle-sep', year: 2026, month: 9, status: 'DRAFT' as const, isCurrentDraft: true };

const mockUseCurrentPayrollCycle = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-payroll-cycles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-cycles')>();
  return {
    ...actual,
    useCurrentPayrollCycle: mockUseCurrentPayrollCycle,
  };
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

vi.mock('@/hooks/use-project-units', () => ({
  useProjectUnits: (siteId: string | undefined) => ({
    data: siteId === 'site-1' ? [{ id: 'unit-1', name: 'HQ', code: null }] : [],
    isLoading: false,
    error: undefined,
  }),
}));

const { ReportsAssignmentMismatchReadinessPage } = await import('./reports-assignment-mismatch-readiness-page');

const baseUser: SessionUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@test.local',
  roleId: 'role-1',
  roleCode: 'PAYROLL_STAFF',
  roleName: 'Payroll Staff',
  permissions: ['payroll:entry'] as SessionUser['permissions'],
  siteIds: ['site-1'],
  themeAccentColor: '#000000',
};

function mockDraftCycle(cycle: typeof DRAFT_CYCLE | null = DRAFT_CYCLE) {
  // `cycle ?? undefined`, not a default parameter — a caller explicitly passing `null` (never
  // `undefined`, which a JS default parameter would silently substitute back to `DRAFT_CYCLE`) is
  // how this helper represents "no current Draft cycle."
  mockUseCurrentPayrollCycle.mockReturnValue({ cycle: cycle ?? undefined, isLoading: false, error: null });
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
  mockDraftCycle();
});

function renderPage(user: SessionUser = baseUser) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reports/assignment-mismatch-readiness']}>
        <Routes>
          <Route path="/reports/assignment-mismatch-readiness" element={<ReportsAssignmentMismatchReadinessPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function row(overrides: Partial<AssignmentMismatchReadinessRow> = {}): AssignmentMismatchReadinessRow {
  return {
    payrollEntryId: 'entry-1',
    employeeId: 'emp-1',
    employeeCode: 'E-001',
    employeeName: 'Jane Doe',
    designation: 'Guard',
    payrollSiteId: 'site-1',
    payrollSiteName: 'Site One',
    workLines: [
      { workLineId: 'wl-1', unit: { id: 'unit-1', name: 'HQ', code: null }, isPrimary: true, unitMismatch: true, hasAttendanceOrOt: false },
    ],
    currentEmployeeSiteId: 'site-2',
    currentEmployeeSiteName: 'Site Two',
    currentEmployeeUnit: { id: 'unit-2', name: 'Warehouse', code: null },
    siteMismatch: true,
    unitMismatch: true,
    shape: 'SINGLE_LINE',
    workLineCount: 1,
    held: false,
    hasAttendanceOrOt: false,
    safeOneClickShape: true,
    ...overrides,
  };
}

function totals(overrides: Partial<AssignmentMismatchReadinessListResponse['totals']> = {}): AssignmentMismatchReadinessListResponse['totals'] {
  return {
    matchingCount: 1,
    siteMismatchCount: 1,
    unitOnlyMismatchCount: 0,
    splitCount: 0,
    heldCount: 0,
    safeOneClickShapeCount: 1,
    ...overrides,
  };
}

function fullReport(overrides: Partial<AssignmentMismatchReadinessListResponse> = {}): AssignmentMismatchReadinessListResponse {
  return {
    cycle: DRAFT_CYCLE,
    page: 1,
    pageSize: 25,
    total: 1,
    rows: [row()],
    totals: totals(),
    generatedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

function mockReport(data: AssignmentMismatchReadinessListResponse | undefined, extra: Record<string, unknown> = {}) {
  mockUseAssignmentMismatchReadinessList.mockReturnValue({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...extra,
  });
}

describe('ReportsAssignmentMismatchReadinessPage — RBAC', () => {
  afterEach(() => cleanup());

  it('shows an access-denied state for a user holding neither payroll:entry nor payroll:view', () => {
    mockReport(undefined);
    renderPage({ ...baseUser, permissions: [] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to this report/i)).toBeTruthy();
  });

  it('renders the report for a user holding payroll:entry alone', () => {
    mockReport(fullReport());
    renderPage({ ...baseUser, permissions: ['payroll:entry'] as SessionUser['permissions'] });
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });

  it('renders the report for a user holding payroll:view alone', () => {
    mockReport(fullReport());
    renderPage({ ...baseUser, permissions: ['payroll:view'] as SessionUser['permissions'] });
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
  });
});

describe('ReportsAssignmentMismatchReadinessPage — strictly read-only (no mutation control)', () => {
  afterEach(() => cleanup());

  it('never renders an Apply / Apply current assignment button or any other mutation control', () => {
    mockReport(fullReport());
    renderPage();
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /sync/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /classify/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reconcile/i })).toBeNull();
  });

  it('renders "Safe One-Click Shape" as an informational badge only, never a clickable control', () => {
    mockReport(fullReport());
    renderPage();
    const badge = screen.getAllByText('Yes').find((el) => el.tagName.toLowerCase() !== 'button');
    expect(badge).toBeTruthy();
    expect(screen.queryByRole('button', { name: /yes/i })).toBeNull();
  });

  it('explains, neutrally, that a mismatch may be intentional', () => {
    mockReport(fullReport());
    renderPage();
    const explanation = screen.getByTestId('amr-explanation');
    expect(explanation.textContent).toMatch(/current employee assignment differs from payroll assignment/i);
    expect(explanation.textContent).toMatch(/may be intentional.*payroll deputation or recorded attendance allocation/i);
    expect(explanation.textContent).not.toMatch(/stale|incorrect|error|wrong/i);
  });
});

describe('ReportsAssignmentMismatchReadinessPage — rendering', () => {
  afterEach(() => cleanup());

  it('shows the no-Draft-cycle empty state when there is no current Draft cycle', () => {
    mockDraftCycle(null);
    mockReport(undefined);
    renderPage();
    expect(screen.getByText(/no draft payroll cycle right now/i)).toBeTruthy();
  });

  it('shows the no-mismatches empty state when the cycle has zero mismatches and no filters are active', () => {
    mockReport(fullReport({ total: 0, rows: [], totals: totals({ matchingCount: 0, siteMismatchCount: 0, safeOneClickShapeCount: 0 }) }));
    renderPage();
    expect(screen.getByText(/no assignment mismatches in this cycle/i)).toBeTruthy();
  });

  it('renders a Held badge for a held row and none for a not-held row', () => {
    mockReport(
      fullReport({
        rows: [row({ payrollEntryId: 'entry-held', employeeName: 'Held Employee', held: true }), row({ payrollEntryId: 'entry-not-held' })],
        total: 2,
      }),
    );
    renderPage();
    expect(screen.getAllByText('Held').length).toBeGreaterThan(0);
  });

  it('renders every mismatched work line for a split entry, not just the primary line', () => {
    mockReport(
      fullReport({
        rows: [
          row({
            shape: 'SPLIT',
            workLineCount: 2,
            workLines: [
              { workLineId: 'wl-primary', unit: { id: 'unit-1', name: 'HQ', code: null }, isPrimary: true, unitMismatch: false, hasAttendanceOrOt: false },
              { workLineId: 'wl-secondary', unit: { id: 'unit-3', name: 'Annex', code: null }, isPrimary: false, unitMismatch: true, hasAttendanceOrOt: false },
            ],
          }),
        ],
      }),
    );
    renderPage();
    expect(screen.getByText('HQ')).toBeTruthy();
    expect(screen.getByText('Annex')).toBeTruthy();
    // "Split" also appears as a Shape-filter <option>, so assert on the row's own Shape badge
    // specifically (a <span>, unlike the filter's <option>).
    const splitBadge = screen.getAllByText('Split').find((el) => el.tagName.toLowerCase() === 'span');
    expect(splitBadge).toBeTruthy();
  });

  it('labels the pagination row count "entry" for one row and "entries" for several', () => {
    mockReport(fullReport({ total: 1 }));
    renderPage();
    expect(screen.getByText('Showing 1–1 of 1 entry')).toBeTruthy();
    cleanup();
    mockReport(fullReport({ total: 2, rows: [row({ payrollEntryId: 'entry-a' }), row({ payrollEntryId: 'entry-b' })] }));
    renderPage();
    expect(screen.getByText('Showing 1–2 of 2 entries')).toBeTruthy();
  });

  it('renders the stat cards from the totals payload', () => {
    mockReport(fullReport({ totals: totals({ matchingCount: 3, siteMismatchCount: 2, unitOnlyMismatchCount: 1, heldCount: 1 }) }));
    renderPage();
    expect(screen.getByTestId('amr-stat-matching').textContent).toContain('3');
    expect(screen.getByTestId('amr-stat-site').textContent).toContain('2');
    expect(screen.getByTestId('amr-stat-unit').textContent).toContain('1');
    expect(screen.getByTestId('amr-stat-held').textContent).toContain('1');
  });
});

describe('ReportsAssignmentMismatchReadinessPage — filters', () => {
  afterEach(() => cleanup());

  it('Clear Filters resets Shape/Held/Safe-shape-only back to defaults', () => {
    mockReport(fullReport());
    renderPage();

    const shapeSelect = screen.getByLabelText('Shape') as HTMLSelectElement;
    fireEvent.change(shapeSelect, { target: { value: 'SPLIT' } });
    expect(shapeSelect.value).toBe('SPLIT');

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(shapeSelect.value).toBe('');
  });

  it('passes safeShapeOnly through to the list hook once the checkbox is checked', () => {
    mockReport(fullReport());
    renderPage();

    fireEvent.click(screen.getByRole('checkbox', { name: /safe one-click shape only/i }));

    const lastCall = mockUseAssignmentMismatchReadinessList.mock.calls.at(-1)?.[0];
    expect(lastCall.safeShapeOnly).toBe(true);
  });
});
