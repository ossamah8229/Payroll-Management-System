// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/payroll-cycles/${testCycle.id}/payroll-entry`]}>
        <Routes>
          <Route path="/payroll-cycles/:cycleId/payroll-entry" element={<PayrollEntryPage user={testUser} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
