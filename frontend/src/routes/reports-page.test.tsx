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
