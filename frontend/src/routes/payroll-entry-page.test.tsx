// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionUser } from '@payroll/shared';
import type { PayrollCycle } from '@/hooks/use-payroll-cycles';

/**
 * Payroll Entry usability checkpoint (2026-07-24), item 4 — "Payroll Data must never be
 * imported." These tests render the real `PayrollEntryPage` toolbar (every hook it reads is
 * mocked below to a fixed, already-resolved DRAFT cycle, so the toolbar renders without a real
 * backend) and assert directly on what a browser paints: no Import affordance exists anywhere,
 * while every export action Payroll Entry is still meant to offer (`Print`, `Export CSV`,
 * `Export Excel`) is present and enabled.
 */

const testCycle: PayrollCycle = {
  id: 'cycle-1',
  year: 2026,
  month: 7,
  status: 'DRAFT',
  sourceCycleId: null,
  createdAt: '',
  createdBy: 'user-1',
  releasedAt: null,
  releasedBy: null,
  archivedAt: null,
  archivedBy: null,
  isCurrentDraft: true,
};

vi.mock('@/hooks/use-selected-payroll-cycle', () => ({
  useSelectedPayrollCycle: () => ({
    cycleId: testCycle.id,
    cycle: testCycle,
    cycles: [testCycle],
    isLoading: false,
    error: undefined,
    selectCycle: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-payroll-cycles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-cycles')>();
  return {
    ...actual,
    useReconcileDraftCycleRoster: () => ({ mutate: vi.fn() }),
  };
});

vi.mock('@/hooks/use-payroll-entries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-entries')>();
  return {
    ...actual,
    usePayrollEntries: () => ({ data: [], isLoading: false, error: undefined }),
  };
});

vi.mock('@/hooks/use-banks', () => ({
  useBanks: () => ({ data: [], isLoading: false, error: undefined }),
}));

vi.mock('@/hooks/use-project-sites', () => ({
  useAccessibleProjectSites: () => ({ data: [], isLoading: false, error: undefined }),
}));

// Imported after the mocks above so the module graph resolves to the mocked hooks.
const { PayrollEntryPage } = await import('./payroll-entry-page');
const { payrollEntrySaveStatusStore } = await import('@/lib/payroll-entry-save-status-store');

const testUser: SessionUser = {
  id: 'user-1',
  name: 'Test Admin',
  email: 'admin@test.local',
  roleId: 'role-1',
  roleCode: 'MASTER_ADMIN',
  roleName: 'Master Admin',
  permissions: ['payroll:entry', 'payroll-cycle:manage'] as SessionUser['permissions'],
  siteIds: [],
  themeAccentColor: '#000000',
};

// A data router (not plain `<MemoryRouter>`/`<Routes>`) — required as of the Phase 7E navigation
// guard (A3): `PayrollEntryPage` now calls `useBlocker`, which throws outside a data router's
// context. `otherPath` gives the nav-guard tests below something to navigate *to* and assert
// against.
function renderPage(initialPath = `/payroll-cycles/${testCycle.id}/payroll-entry`) {
  const queryClient = new QueryClient();
  const router = createMemoryRouter(
    [
      { path: '/payroll-cycles/:cycleId/payroll-entry', element: <PayrollEntryPage user={testUser} /> },
      { path: '/other-page', element: <div>Other Page</div> },
    ],
    { initialEntries: [initialPath] },
  );
  return {
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

describe('Payroll Entry page — import removed, export preserved', () => {
  afterEach(() => cleanup());

  it('no longer renders "Download Import Template"', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /download import template/i })).toBeNull();
  });

  it('no longer renders an "Import" action', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /^import$/i })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('still renders working Export CSV and Export Excel actions', () => {
    renderPage();
    const exportCsv = screen.getByRole('button', { name: /export csv/i });
    const exportExcel = screen.getByRole('button', { name: /export excel/i });
    expect(exportCsv.hasAttribute('disabled')).toBe(false);
    expect(exportExcel.hasAttribute('disabled')).toBe(false);
  });
});

/**
 * Phase 7E durability checkpoint (A3, item 4) — the in-app navigation guard. Seeds
 * `payrollEntrySaveStatusStore` directly (the same store the real grid rows report into) rather
 * than driving actual keystrokes through the grid, since this page's own `entries` are mocked
 * empty above (Import-removal suite's concern, not this one's) — the guard itself only ever reads
 * the store, never the grid, so this is a faithful test of the exact code path `PayrollEntryPage`
 * runs.
 */
describe('Payroll Entry page — in-app navigation guard while unsaved (Phase 7E, A3)', () => {
  afterEach(() => {
    cleanup();
    payrollEntrySaveStatusStore.clear('nav-guard-entry', testCycle.id);
  });

  it('blocks navigating away while the cycle has unsaved work, and lets the user stay', async () => {
    payrollEntrySaveStatusStore.set('nav-guard-entry', testCycle.id, 'dirty');
    const { router } = renderPage();

    router.navigate('/other-page');
    const stayButton = await screen.findByRole('button', { name: /stay on this page/i });
    expect(screen.getByText(/unsaved changes/i)).not.toBeNull();

    stayButton.click();
    expect(screen.queryByText('Other Page')).toBeNull();
    expect(router.state.location.pathname).toBe(`/payroll-cycles/${testCycle.id}/payroll-entry`);
  });

  it('navigates away once the user confirms "Leave anyway"', async () => {
    payrollEntrySaveStatusStore.set('nav-guard-entry', testCycle.id, 'dirty');
    const { router } = renderPage();

    router.navigate('/other-page');
    const leaveButton = await screen.findByRole('button', { name: /leave anyway/i });
    leaveButton.click();

    await screen.findByText('Other Page');
    expect(router.state.location.pathname).toBe('/other-page');
  });

  it('never blocks navigation when everything is already saved', async () => {
    payrollEntrySaveStatusStore.clear('nav-guard-entry', testCycle.id);
    const { router } = renderPage();

    router.navigate('/other-page');

    await screen.findByText('Other Page');
    expect(screen.queryByText(/unsaved changes/i)).toBeNull();
  });
});
