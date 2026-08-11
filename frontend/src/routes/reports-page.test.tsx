// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionUser } from '@payroll/shared';
import { ReportsPage } from './reports-page';

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

function renderCatalogue(user: SessionUser) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportsPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReportsPage — Employee Payroll History catalogue card', () => {
  afterEach(() => cleanup());

  it('shows the Employee Payroll History card as a real link for a user holding statements:view', () => {
    renderCatalogue({ ...baseUser, permissions: ['reports:view', 'statements:view'] as SessionUser['permissions'] });
    const link = screen.getByText('Employee Payroll History').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/reports/employee-payroll-history');
  });

  it('hides the Employee Payroll History card entirely for a user without statements:view (never a broken link)', () => {
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    expect(screen.queryByText('Employee Payroll History')).toBeNull();
  });

  it('still shows Payroll Summary for a user without statements:view', () => {
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    expect(screen.getByText('Payroll Summary')).toBeTruthy();
  });
});

describe('ReportsPage — Project Site Payroll Report catalogue card', () => {
  afterEach(() => cleanup());

  it('shows the Project Site Payroll Report card as a real link for a user holding only reports:view', () => {
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    const link = screen.getByText('Project Site Payroll Report').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/reports/project-site-payroll');
  });

  it('requires no extra permission beyond the page-level reports:view gate (no requiredPermission override)', () => {
    // Contrast with Employee Payroll History, which is hidden without statements:view — Project
    // Site Payroll Report reuses reports:view alone (frozen decision 2).
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    expect(screen.getByText('Project Site Payroll Report').closest('a')).not.toBeNull();
  });
});

describe('ReportsPage — Deduction Report catalogue card', () => {
  afterEach(() => cleanup());

  it('shows the Deduction Report card as a real link for a user holding only reports:view', () => {
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    const link = screen.getByText('Deduction Report').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/reports/deduction-report');
  });

  it('requires no extra permission beyond the page-level reports:view gate (no requiredPermission override)', () => {
    // Contrast with Employee Payroll History, which is hidden without statements:view — Deduction
    // Report reuses reports:view alone (frozen decision 3, reports.md §17.1).
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    expect(screen.getByText('Deduction Report').closest('a')).not.toBeNull();
  });
});

describe('ReportsPage — Overtime Report catalogue card', () => {
  afterEach(() => cleanup());

  it('shows the Overtime Report card as a real link for a user holding only reports:view', () => {
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    const link = screen.getByText('Overtime Report').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/reports/overtime-report');
  });

  it('requires no extra permission beyond the page-level reports:view gate (no requiredPermission override)', () => {
    // Contrast with Employee Payroll History, which is hidden without statements:view — Overtime
    // Report reuses reports:view alone (frozen decision, reports.md §18.1).
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    expect(screen.getByText('Overtime Report').closest('a')).not.toBeNull();
  });
});

describe('ReportsPage — Advance Recovery Report catalogue card', () => {
  afterEach(() => cleanup());

  it('shows the Advance Recovery Report card as a real link for a user holding only reports:view (Checkpoint 1B: available: true)', () => {
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    const link = screen.getByText('Advance Recovery Report').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/reports/advance-recovery');
  });

  it('requires no extra permission beyond the page-level reports:view gate (no requiredPermission override)', () => {
    // Contrast with Employee Payroll History, which is hidden without statements:view — Advance
    // Recovery Report reuses reports:view alone (frozen backend decision, reports.md §19.1).
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    expect(screen.getByText('Advance Recovery Report').closest('a')).not.toBeNull();
  });
});

describe('ReportsPage — Salary Release Report catalogue card (Checkpoint 1B: OR permission gate)', () => {
  afterEach(() => cleanup());

  it('shows the Salary Release Report card as a real link for a user holding only reports:view', () => {
    renderCatalogue({ ...baseUser, permissions: ['reports:view'] as SessionUser['permissions'] });
    const link = screen.getByText('Salary Release Report').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/reports/salary-release');
  });

  it('shows the Salary Release Report card as a real link for a user holding only payroll:view (the Finance case — never reports:view)', () => {
    renderCatalogue({ ...baseUser, permissions: ['payroll:view'] as SessionUser['permissions'] });
    const link = screen.getByText('Salary Release Report').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/reports/salary-release');
  });

  it('shows the Salary Release Report card for a user holding both permissions', () => {
    renderCatalogue({ ...baseUser, permissions: ['reports:view', 'payroll:view'] as SessionUser['permissions'] });
    expect(screen.getByText('Salary Release Report').closest('a')).not.toBeNull();
  });

  it('hides the Salary Release Report card for a user holding neither reports:view nor payroll:view', () => {
    renderCatalogue({ ...baseUser, permissions: ['payroll:view'] as SessionUser['permissions'] });
    expect(screen.getByText('Salary Release Report')).toBeTruthy();
    // Same assertion restated with a permission that is neither of the two admitting keys, to prove
    // the gate is genuinely OR(reports:view, payroll:view), not just "any permission at all".
    cleanup();
    renderCatalogue({ ...baseUser, permissions: ['statements:view'] as SessionUser['permissions'] });
    expect(screen.queryByText('Salary Release Report')).toBeNull();
  });

  it('hides the Salary Release Report card for a user holding only payroll:release (does not imply access on its own)', () => {
    renderCatalogue({ ...baseUser, permissions: ['payroll:release'] as SessionUser['permissions'] });
    expect(screen.queryByText('Salary Release Report')).toBeNull();
  });

  it('a user without reports:view but with payroll:view still sees every other card hidden (the OR gate does not widen sibling reports)', () => {
    renderCatalogue({ ...baseUser, permissions: ['payroll:view'] as SessionUser['permissions'] });
    expect(screen.queryByText('Deduction Report')).toBeNull();
    expect(screen.queryByText('Overtime Report')).toBeNull();
    expect(screen.queryByText('Project Site Payroll Report')).toBeNull();
    expect(screen.queryByText('Advance Recovery Report')).toBeNull();
    expect(screen.queryByText('Payroll Summary')).toBeNull();
    // The catalogue shell itself is reachable (not an Access Denied page) — only the sibling cards
    // this user genuinely isn't authorized for stay hidden.
    expect(screen.queryByText(/you don.t have access to reports/i)).toBeNull();
    expect(screen.getByText('Report Catalogue')).toBeTruthy();
  });
});

describe('ReportsPage — page-level access (Checkpoint 1B: widened to reports:view OR payroll:view)', () => {
  afterEach(() => cleanup());

  it('denies a user with neither reports:view nor payroll:view', () => {
    renderCatalogue({ ...baseUser, permissions: [] as SessionUser['permissions'] });
    expect(screen.getByText(/you don.t have access to reports/i)).toBeTruthy();
  });

  it('admits a payroll:view-only user to the catalogue shell (the Finance case)', () => {
    renderCatalogue({ ...baseUser, permissions: ['payroll:view'] as SessionUser['permissions'] });
    expect(screen.queryByText(/you don.t have access to reports/i)).toBeNull();
    expect(screen.getByText('Report Catalogue')).toBeTruthy();
  });
});
