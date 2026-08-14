// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SessionUser } from '@payroll/shared';
import type { ProjectSite } from '@/hooks/use-project-sites';
import type { ProjectUnit } from '@/hooks/use-project-units';

/**
 * New Employee modal UAT correction (2026-08-14) — "Unit selector shows only the Unit name; users
 * rely on Unit/branch codes for quick recognition." `SiteUnitSelect` is the one shared cascading
 * selector both Employee Registry's own create/edit form and Payroll Entry's "New Employee" quick
 * action render through (`EmployeeFormModal`) — fixed here, once, rather than in either caller.
 *
 * `code` already comes back on every loaded `ProjectUnit` (`use-project-units.ts`'s own interface,
 * proven by the mocked hook below never needing a second, code-specific request) — this is a
 * presentation-only fix, no new endpoint, no frontend-side name→code lookup table.
 */

const masterAdminUser: SessionUser = {
  id: 'user-1',
  name: 'Master User',
  email: 'admin@example.com',
  roleId: 'role-1',
  roleCode: 'MASTER_ADMIN',
  roleName: 'Master Admin',
  permissions: [],
  siteIds: [],
  themeAccentColor: '#000000',
};

const siteA: ProjectSite = {
  id: 'site-a',
  name: 'Site A',
  address: null,
  unitLabel: 'Branch',
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

const unitWithCode: ProjectUnit = {
  id: 'unit-1',
  siteId: 'site-a',
  name: 'General Administration',
  code: 'GA-01',
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

const unitWithoutCode: ProjectUnit = {
  id: 'unit-2',
  siteId: 'site-a',
  name: 'Cleaning Department',
  code: null,
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

const unitLongName: ProjectUnit = {
  id: 'unit-3',
  siteId: 'site-a',
  name: 'A Very Long Branch Name That Stress-Tests The Option Rendering',
  code: 'VLB-99',
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

let mockedUnits: ProjectUnit[] = [];
let projectUnitsCallCount = 0;

vi.mock('@/hooks/use-project-sites', () => ({
  useAccessibleProjectSites: () => ({ data: [siteA], isLoading: false, error: undefined }),
}));

vi.mock('@/hooks/use-project-units', () => ({
  useProjectUnits: (siteId: string | undefined) => {
    if (siteId) projectUnitsCallCount++;
    return { data: siteId ? mockedUnits : undefined, isLoading: false, error: undefined };
  },
}));

const { SiteUnitSelect } = await import('./site-unit-select');

describe('SiteUnitSelect — Unit Name (CODE) display (UAT 2026-08-14)', () => {
  afterEach(() => {
    cleanup();
    mockedUnits = [];
    projectUnitsCallCount = 0;
  });

  it('shows "Name (CODE)" for a unit with a code, in both the option and the selected value', () => {
    mockedUnits = [unitWithCode];
    render(
      <SiteUnitSelect siteId="site-a" unitId="unit-1" onSiteChange={vi.fn()} onUnitChange={vi.fn()} user={masterAdminUser} />,
    );
    const select = screen.getByLabelText('Branch') as HTMLSelectElement;
    expect(screen.getByRole('option', { name: 'General Administration (GA-01)' })).toBeTruthy();
    expect(select.value).toBe('unit-1');
    expect((select.selectedOptions[0] as HTMLOptionElement).textContent).toBe('General Administration (GA-01)');
  });

  it('falls back to the plain name when a unit has no code, rather than showing "(null)" or empty parens', () => {
    mockedUnits = [unitWithoutCode];
    render(
      <SiteUnitSelect siteId="site-a" unitId="unit-2" onSiteChange={vi.fn()} onUnitChange={vi.fn()} user={masterAdminUser} />,
    );
    expect(screen.getByRole('option', { name: 'Cleaning Department' })).toBeTruthy();
    expect(screen.queryByText(/\(null\)/)).toBeNull();
  });

  it('keeps every option correctly paired with its own unit id, not a name-based guess, when several units are loaded', () => {
    mockedUnits = [unitWithCode, unitWithoutCode, unitLongName];
    const onUnitChange = vi.fn();
    render(
      <SiteUnitSelect siteId="site-a" unitId="" onSiteChange={vi.fn()} onUnitChange={onUnitChange} user={masterAdminUser} />,
    );
    const select = screen.getByLabelText('Branch') as HTMLSelectElement;
    expect(screen.getByRole('option', { name: 'General Administration (GA-01)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Cleaning Department' })).toBeTruthy();
    expect(
      screen.getByRole('option', { name: 'A Very Long Branch Name That Stress-Tests The Option Rendering (VLB-99)' }),
    ).toBeTruthy();

    fireEvent.change(select, { target: { value: 'unit-3' } });
    expect(onUnitChange).toHaveBeenCalledWith('unit-3');
  });

  it('clears the selected unit when the Project Site changes, so a stale unit id from the previous site is never submitted', () => {
    mockedUnits = [unitWithCode];
    const onSiteChange = vi.fn();
    const onUnitChange = vi.fn();
    render(
      <SiteUnitSelect siteId="site-a" unitId="unit-1" onSiteChange={onSiteChange} onUnitChange={onUnitChange} user={masterAdminUser} />,
    );
    fireEvent.change(screen.getByLabelText('Project site'), { target: { value: 'site-a' } });
    expect(onSiteChange).toHaveBeenCalledWith('site-a');
    expect(onUnitChange).toHaveBeenCalledWith('');
  });

  it('never issues a second/duplicate Unit request beyond the one load already backing the option list (no code-specific endpoint added)', () => {
    mockedUnits = [unitWithCode];
    render(
      <SiteUnitSelect siteId="site-a" unitId="unit-1" onSiteChange={vi.fn()} onUnitChange={vi.fn()} user={masterAdminUser} />,
    );
    expect(screen.getByRole('option', { name: 'General Administration (GA-01)' })).toBeTruthy();
    expect(projectUnitsCallCount).toBe(1);
  });
});
