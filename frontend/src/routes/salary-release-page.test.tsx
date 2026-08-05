// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionUser } from '@payroll/shared';
import type { PayrollCycle } from '@/hooks/use-payroll-cycles';
import type { UnitReleaseStatus } from '@/hooks/use-payroll-release';

/**
 * Phase 7E durability checkpoint (A7, items 12–15) — the frontend half of the release interlock
 * (A4): Release must be disabled/blocked while the cycle has any Payroll Entry row that isn't yet
 * server-confirmed saved (dirty, saving, retrying, or in conflict), and enabled again once
 * everything is saved. Seeds `payrollEntrySaveStatusStore` directly — the exact store the real
 * grid rows report into (`use-payroll-entry-editor.ts`'s `report`) — rather than re-deriving a
 * second signal, matching this checkpoint's own "reuse existing per-row status" requirement.
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

const testSite = { id: 'site-1', name: 'Test Site', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' };

const unitStatus: UnitReleaseStatus = {
  unit: { id: 'unit-1', name: 'Main Branch', code: 'BR-01', isActive: true },
  released: false,
  releasedAt: null,
  releasedBy: null,
  entryCount: 3,
  willReleaseCount: 3,
  heldCount: 0,
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

vi.mock('@/hooks/use-project-sites', () => ({
  useAccessibleProjectSites: () => ({ data: [testSite], isLoading: false, error: undefined }),
}));

vi.mock('@/hooks/use-payroll-release', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-release')>();
  return {
    ...actual,
    useUnitReleaseStatus: () => ({ data: [unitStatus], isLoading: false, error: undefined }),
    useReleaseProjectUnit: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock('@/hooks/use-payroll-cycles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-cycles')>();
  return {
    ...actual,
    useFinalizePayrollCycle: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRolloverPayrollCycle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock('@/hooks/use-payroll-entries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-payroll-entries')>();
  return {
    ...actual,
    usePayrollEntries: () => ({ data: [], isLoading: false, error: undefined }),
  };
});

const { SalaryReleasePage } = await import('./salary-release-page');
const { payrollEntrySaveStatusStore } = await import('@/lib/payroll-entry-save-status-store');

const testUser: SessionUser = {
  id: 'user-1',
  name: 'Test Finance',
  email: 'finance@test.local',
  roleId: 'role-1',
  roleCode: 'FINANCE',
  roleName: 'Finance',
  permissions: ['payroll:release', 'payroll:view'] as SessionUser['permissions'],
  siteIds: [testSite.id],
  themeAccentColor: '#000000',
};

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/payroll-cycles/${testCycle.id}/release`]}>
        <SalaryReleasePage user={testUser} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Salary Release page — release interlock while Payroll Entry has unsaved work (Phase 7E, A4)', () => {
  afterEach(() => {
    cleanup();
    payrollEntrySaveStatusStore.clear('release-guard-entry', testCycle.id);
  });

  it('blocks Release while a row is dirty (item 12)', () => {
    payrollEntrySaveStatusStore.set('release-guard-entry', testCycle.id, 'dirty');
    renderPage();
    expect(screen.getByRole('button', { name: /^release$/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/release is disabled/i)).not.toBeNull();
  });

  it('blocks Release while a row is saving (item 13)', () => {
    payrollEntrySaveStatusStore.set('release-guard-entry', testCycle.id, 'saving');
    renderPage();
    expect(screen.getByRole('button', { name: /^release$/i }).hasAttribute('disabled')).toBe(true);
  });

  it('blocks Release after a save failure (item 14)', () => {
    payrollEntrySaveStatusStore.set('release-guard-entry', testCycle.id, 'error', 'Save failed');
    renderPage();
    expect(screen.getByRole('button', { name: /^release$/i }).hasAttribute('disabled')).toBe(true);
  });

  it('allows Release once every relevant row is server-confirmed saved (item 15)', () => {
    payrollEntrySaveStatusStore.clear('release-guard-entry', testCycle.id);
    renderPage();
    expect(screen.getByRole('button', { name: /^release$/i }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/release is disabled/i)).toBeNull();
  });
});
