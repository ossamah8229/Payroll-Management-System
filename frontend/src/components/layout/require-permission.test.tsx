// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionUser } from '@payroll/shared';

/**
 * Dashboard Checkpoint 1B UAT remediation, Issue A — a user denied a permission-gated route must
 * never be offered a "back" action that leads to the same denied route. `AppShell`'s own
 * `useCompanySettings` call is mocked (this codebase's established pattern, `sidebar.test.tsx`) so
 * this exercises only `RequirePermission`/`AccessDeniedPage`'s own gating and action rendering,
 * never a real backend.
 */

vi.mock('@/hooks/use-company-settings', () => ({
  COMPANY_LOGO_UI_URL: 'http://backend.test/api/v1/settings/company/logo/ui',
  useCompanySettings: () => ({ data: { hasLogo: false } }),
}));

const { RequirePermission } = await import('./require-permission');

const testUser: SessionUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'user@test.local',
  roleId: 'role-1',
  roleCode: 'PAYROLL_STAFF',
  roleName: 'Payroll Staff',
  permissions: [] as SessionUser['permissions'],
  siteIds: [],
  themeAccentColor: '#1B4F72',
};

afterEach(() => cleanup());

function renderGuard(hideHomeAction?: boolean) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RequirePermission user={testUser} permission="sites:manage" hideHomeAction={hideHomeAction}>
          <div>Protected content</div>
        </RequirePermission>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RequirePermission — denied-state action', () => {
  it('by default shows AccessDenied with a "Back to Dashboard" action pointing at "/" — every non-Dashboard route', () => {
    renderGuard();
    expect(screen.getByText('You do not have permission to access this page.')).toBeTruthy();
    expect(screen.queryByText('Protected content')).toBeNull();
    const link = screen.getByRole('link', { name: 'Back to Dashboard' });
    expect(link.getAttribute('href')).toBe('/');
  });

  it('omits the "Back to Dashboard" action when hideHomeAction is set, without weakening the denial itself', () => {
    renderGuard(true);
    expect(screen.getByText('You do not have permission to access this page.')).toBeTruthy();
    expect(screen.queryByText('Protected content')).toBeNull();
    // No dead-end action back to the same denied route — the guarded route here is `/` itself
    // (App.tsx's own Dashboard wiring), so the default action would otherwise relink to this same
    // AccessDenied screen.
    expect(screen.queryByRole('link', { name: 'Back to Dashboard' })).toBeNull();
    expect(screen.queryByText(/back to dashboard/i)).toBeNull();
  });
});
