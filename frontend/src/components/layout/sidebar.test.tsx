// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SessionUser } from '@payroll/shared';

/**
 * Phase 7C — Sidebar company identity logo. `useCompanySettings` is mocked (this codebase's own
 * established pattern) so this exercises only the Sidebar's own `hasLogo` gating/fallback
 * behavior, never a real backend.
 */

const mockCompanySettingsData = vi.hoisted(() => ({ value: { hasLogo: false } }));

vi.mock('@/hooks/use-company-settings', () => ({
  COMPANY_LOGO_UI_URL: 'http://backend.test/api/v1/settings/company/logo/ui',
  useCompanySettings: () => ({ data: mockCompanySettingsData.value }),
}));

const { Sidebar } = await import('./sidebar');

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

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar user={testUser} />
    </MemoryRouter>,
  );
}

describe('Sidebar — company identity logo', () => {
  afterEach(() => {
    cleanup();
    mockCompanySettingsData.value = { hasLogo: false };
  });

  it('never issues an image request when no logo is set — the existing text block renders unchanged', () => {
    renderSidebar();
    // The logo <img> has alt="" (decorative) — an empty-alt image has implicit role
    // "presentation", not "img", so it's queried directly rather than via getByRole.
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByText('HR & Payroll')).not.toBeNull();
  });

  it('renders the logo image once hasLogo is true, alongside the unchanged company-name text', () => {
    mockCompanySettingsData.value = { hasLogo: true };
    renderSidebar();
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.src).toBe('http://backend.test/api/v1/settings/company/logo/ui');
    expect(screen.queryByText('HR & Payroll')).not.toBeNull();
  });

  it('removes the image and falls back safely if the logo request fails, without disturbing the text block', async () => {
    mockCompanySettingsData.value = { hasLogo: true };
    renderSidebar();
    const img = document.querySelector('img')!;
    fireEvent.error(img);

    await waitFor(() => expect(document.querySelector('img')).toBeNull());
    expect(screen.queryByText('HR & Payroll')).not.toBeNull();
  });
});
