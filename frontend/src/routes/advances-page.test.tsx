// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@payroll/shared';

/**
 * v1.0.4 Advances Scalability/Deputation/Cancel-Semantics checkpoint — Advances page tests. Every
 * data-fetching hook is mocked to a controlled, already-resolved value (this codebase's own
 * established pattern, `reports-advance-recovery-report-page.test.tsx`) — these tests exercise the
 * page's own pagination wiring, Site/Unit rendering, and Cancelled-Outstanding-masking logic, never
 * a real backend. Real browser/network verification is local UAT / Playwright's job.
 */

const mockUseAdvances = vi.hoisted(() => vi.fn());
const mockMutate = vi.hoisted(() => vi.fn().mockResolvedValue({ advance: {} }));

vi.mock('@/hooks/use-advances', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-advances')>();
  return {
    ...actual,
    useAdvances: mockUseAdvances,
    useCreateAdvance: () => ({ mutateAsync: mockMutate, isPending: false }),
    useUpdateAdvance: () => ({ mutateAsync: mockMutate, isPending: false }),
    useDeferAdvanceSchedule: () => ({ mutateAsync: mockMutate, isPending: false }),
    useCancelAdvance: () => ({ mutateAsync: mockMutate, isPending: false }),
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

vi.mock('@/hooks/use-payroll-cycles', () => ({
  useCurrentPayrollCycle: () => ({ cycle: null, isLoading: false, error: undefined }),
}));

const { AdvancesPage } = await import('./advances-page');

const baseUser: SessionUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@test.local',
  roleId: 'role-1',
  roleCode: 'PAYROLL_STAFF',
  roleName: 'Payroll Staff',
  permissions: ['advances:manage'] as SessionUser['permissions'],
  siteIds: ['site-1', 'site-2'],
  themeAccentColor: '#000000',
};

interface TestAdvance {
  id: string;
  employeeId: string;
  employee: {
    id: string;
    name: string;
    employeeCode: string | null;
    cnic: string | null;
    fatherName: string | null;
    siteId: string;
    site: { id: string; name: string; unitLabel: string };
    unit: { id: string; name: string; code: string | null };
  };
  type: 'LOAN' | 'EID_ADVANCE';
  totalAmount: string;
  outstandingBalance: string;
  dateGiven: string;
  repaymentType: 'FULL_DEDUCTION' | 'INSTALLMENT';
  scheduledInstallmentAmount: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'RESERVED' | 'PAID_OFF' | 'CANCELLED';
  originalScheduledPeriodId: string | null;
  currentScheduledPeriodId: string | null;
  originalScheduledPeriod: null;
  currentScheduledPeriod: null;
  paidOffAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function advance(overrides: Partial<TestAdvance> = {}): TestAdvance {
  return {
    id: 'advance-1',
    employeeId: 'emp-1',
    employee: {
      id: 'emp-1',
      name: 'Jane Doe',
      employeeCode: 'E-001',
      cnic: null,
      fatherName: null,
      siteId: 'site-1',
      site: { id: 'site-1', name: 'Site One', unitLabel: 'Branch' },
      unit: { id: 'unit-1', name: 'Branch One', code: null },
    },
    type: 'LOAN',
    totalAmount: '10000.00',
    outstandingBalance: '6000.00',
    dateGiven: '2026-01-15',
    repaymentType: 'INSTALLMENT',
    scheduledInstallmentAmount: null,
    notes: null,
    status: 'ACTIVE',
    originalScheduledPeriodId: null,
    currentScheduledPeriodId: null,
    originalScheduledPeriod: null,
    currentScheduledPeriod: null,
    paidOffAt: null,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    ...overrides,
  };
}

function mockAdvancesReturn(
  data: { advances: TestAdvance[]; total: number; page: number; pageSize: number } | undefined,
  extra: Record<string, unknown> = {},
) {
  mockUseAdvances.mockReturnValue({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    ...extra,
  });
}

function renderPage(user: SessionUser = baseUser) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdvancesPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
  mockUseAdvances.mockReset();
  mockMutate.mockClear();
});

afterEach(() => cleanup());

describe('AdvancesPage — Deputation Visibility (v1.0.4 Part B)', () => {
  it('shows Site and Unit columns for each row', () => {
    mockAdvancesReturn({ advances: [advance()], total: 1, page: 1, pageSize: 25 });
    renderPage();
    expect(screen.getByText('Site One')).toBeTruthy();
    expect(screen.getByText('Branch One')).toBeTruthy();
  });

  it('distinguishes two same-named employees via Site/Unit context', () => {
    mockAdvancesReturn({
      advances: [
        advance({
          id: 'advance-a',
          employeeId: 'emp-a',
          employee: {
            id: 'emp-a',
            name: 'Muhammad Talha',
            employeeCode: null,
            cnic: null,
            fatherName: null,
            siteId: 'site-1',
            site: { id: 'site-1', name: 'Site One', unitLabel: 'Branch' },
            unit: { id: 'unit-1', name: 'Branch One', code: null },
          },
        }),
        advance({
          id: 'advance-b',
          employeeId: 'emp-b',
          employee: {
            id: 'emp-b',
            name: 'Muhammad Talha',
            employeeCode: null,
            cnic: null,
            fatherName: null,
            siteId: 'site-2',
            site: { id: 'site-2', name: 'Site Two', unitLabel: 'Branch' },
            unit: { id: 'unit-2', name: 'Branch Two', code: null },
          },
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    renderPage();
    expect(screen.getAllByText('Muhammad Talha')).toHaveLength(2);
    expect(screen.getByText('Site One')).toBeTruthy();
    expect(screen.getByText('Site Two')).toBeTruthy();
    expect(screen.getByText('Branch One')).toBeTruthy();
    expect(screen.getByText('Branch Two')).toBeTruthy();
  });
});

describe('AdvancesPage — Cancel Business Semantics (v1.0.4 Part C/D/E)', () => {
  it('displays Outstanding as PKR 0.00 for a Cancelled Advance even though the raw stored balance is nonzero', () => {
    mockAdvancesReturn({
      advances: [advance({ status: 'CANCELLED', totalAmount: '10000.00', outstandingBalance: '6000.00' })],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderPage();
    const table = within(screen.getByRole('table'));
    // Original amount remains visible, unmasked.
    expect(table.getByText('PKR 10,000.00')).toBeTruthy();
    // Outstanding is masked to 0 for a Cancelled row — never the raw 6000 remainder.
    expect(table.getByText('PKR 0.00')).toBeTruthy();
    expect(table.queryByText('PKR 6,000.00')).toBeNull();
    expect(table.getByText('Cancelled')).toBeTruthy();
  });

  it('shows the true Outstanding Balance for a non-Cancelled Advance (no masking applied)', () => {
    mockAdvancesReturn({
      advances: [advance({ status: 'ACTIVE', outstandingBalance: '6000.00' })],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderPage();
    expect(screen.getByText('PKR 6,000.00')).toBeTruthy();
  });

  it('the Cancel dialog explains the amount is waived, never implies it is still owed', () => {
    mockAdvancesReturn({ advances: [advance({ status: 'ACTIVE' })], total: 1, page: 1, pageSize: 25 });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/waived, not still owed/i)).toBeTruthy();
  });
});

describe('AdvancesPage — Pagination (v1.0.4 Part A)', () => {
  it('requests page 1 with the established page size on first render', () => {
    mockAdvancesReturn({ advances: [advance()], total: 1, page: 1, pageSize: 25 });
    renderPage();
    const lastCall = mockUseAdvances.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ page: 1, pageSize: 25 }));
  });

  it('renders pagination controls with the backend-provided total, and advances the page on Next', () => {
    const advances = Array.from({ length: 25 }, (_, i) => advance({ id: `advance-${i}`, employeeId: `emp-${i}` }));
    mockAdvancesReturn({ advances, total: 60, page: 1, pageSize: 25 });
    renderPage();
    expect(screen.getByText(/showing 1.25 of 60 advances/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const lastCall = mockUseAdvances.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ page: 2 }));
  });

  it('does not hide Cancelled Advances — the default status filter stays "All"', () => {
    mockAdvancesReturn({ advances: [advance({ status: 'CANCELLED' })], total: 1, page: 1, pageSize: 25 });
    renderPage();
    const lastCall = mockUseAdvances.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ status: undefined }));
    expect(within(screen.getByRole('table')).getByText('Cancelled')).toBeTruthy();
  });

  it('sends multiple selected sites server-side (siteIds), not a client-side filter', () => {
    mockAdvancesReturn({ advances: [advance()], total: 1, page: 1, pageSize: 25 });
    renderPage();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Site' }), { button: 0 });
    // This checkbox-style multi-select dropdown deliberately stays open across selections (unlike
    // a single-select menu) so several sites can be checked in one sitting.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site One' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Site Two' }));
    const lastCall = mockUseAdvances.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ siteIds: expect.arrayContaining(['site-1', 'site-2']) }));
  });
});
