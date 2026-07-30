// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionUser } from '@payroll/shared';

/**
 * Phase 7C — Company Settings "Company Logo" section tests. Every data hook is mocked to a
 * controlled, already-resolved value (this codebase's own established pattern,
 * `payroll-entry-page.test.tsx`/`statements-page.test.tsx`) — real upload/network behavior is
 * Playwright's job; these tests exercise the page's own gating/rendering/interaction logic.
 * No jest-dom matchers are configured in this project — assertions use plain
 * `toBeNull`/`not.toBeNull`/direct property checks, matching every existing test file's own style.
 */

const mockUploadMutateAsync = vi.hoisted(() => vi.fn());
const mockRemoveMutateAsync = vi.hoisted(() => vi.fn());
const mockUpdateSettingsMutateAsync = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
const mockCompanySettingsData = vi.hoisted(() => ({
  value: {
    id: 'company-1',
    companyName: 'Acme Co',
    registeredAddress: null,
    phone: null,
    email: null,
    hasLogo: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: mockToastSuccess, error: mockToastError }),
}));

vi.mock('@/hooks/use-company-settings', () => ({
  COMPANY_LOGO_UI_URL: 'http://backend.test/api/v1/settings/company/logo/ui',
  COMPANY_LOGO_PRINT_URL: 'http://backend.test/api/v1/settings/company/logo/print',
  useCompanySettings: () => ({ data: mockCompanySettingsData.value, isLoading: false }),
  useUpdateCompanySettings: () => ({ mutateAsync: mockUpdateSettingsMutateAsync, isPending: false }),
  useUploadCompanyLogo: () => ({ mutateAsync: mockUploadMutateAsync, isPending: false }),
  useRemoveCompanyLogo: () => ({ mutateAsync: mockRemoveMutateAsync, isPending: false }),
}));

const { SettingsPage } = await import('./settings-page');

const managerUser: SessionUser = {
  id: 'user-1',
  name: 'Master User',
  email: 'master@test.local',
  roleId: 'role-1',
  roleCode: 'MASTER_ADMIN',
  roleName: 'Master Admin',
  permissions: ['settings:manage'] as SessionUser['permissions'],
  siteIds: [],
  themeAccentColor: '#1B4F72',
};

const readOnlyUser: SessionUser = {
  ...managerUser,
  id: 'user-2',
  roleCode: 'PAYROLL_STAFF',
  roleName: 'Payroll Staff',
  permissions: [] as SessionUser['permissions'],
};

function renderSettingsPage(user: SessionUser) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings — Company Logo section', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockCompanySettingsData.value = { ...mockCompanySettingsData.value, hasLogo: false };
  });

  it('shows the placeholder and "No logo uploaded yet" copy for a read-only user when no logo is set', () => {
    renderSettingsPage(readOnlyUser);
    expect(screen.queryByText('No logo uploaded yet.')).not.toBeNull();
    // Read-only users never see mutation controls.
    expect(screen.queryByRole('button', { name: 'Upload Logo' })).toBeNull();
  });

  it('shows the real logo image for a read-only user once one is set — never the stale "Storage Provider" copy', () => {
    mockCompanySettingsData.value = { ...mockCompanySettingsData.value, hasLogo: true };
    renderSettingsPage(readOnlyUser);
    expect(screen.queryByAltText('Company logo')).not.toBeNull();
    expect(screen.queryByText(/Storage Provider/i)).toBeNull();
  });

  it('lets a Master User (settings:manage) see an enabled "Upload Logo" control — not the stale disabled stub', () => {
    renderSettingsPage(managerUser);
    const uploadButton = screen.getByRole('button', { name: 'Upload Logo' }) as HTMLButtonElement;
    expect(uploadButton.disabled).toBe(false);
    expect(screen.queryByText(/becomes available once Storage Provider is implemented/i)).toBeNull();
  });

  it('uploads the selected file and shows a success toast', async () => {
    mockUploadMutateAsync.mockResolvedValueOnce({ settings: { ...mockCompanySettingsData.value, hasLogo: true } });
    renderSettingsPage(managerUser);

    const file = new File(['fake-png-bytes'], 'logo.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockUploadMutateAsync).toHaveBeenCalledWith(file));
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Company logo uploaded'));
  });

  it('shows an error toast when the upload fails, without crashing the page', async () => {
    const { ApiError } = await import('@/lib/api-client');
    mockUploadMutateAsync.mockRejectedValueOnce(
      new ApiError(400, 'BAD_REQUEST', 'Only PNG, JPEG, or SVG logo files are accepted'),
    );
    renderSettingsPage(managerUser);

    const file = new File(['not-an-image'], 'file.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Only PNG, JPEG, or SVG logo files are accepted'),
    );
    // The page itself must still be intact — the upload button is still there, not a crashed tree.
    expect(screen.queryByRole('button', { name: 'Upload Logo' })).not.toBeNull();
  });

  it('rejects an oversized file client-side (2 MB) without ever calling the upload mutation', async () => {
    renderSettingsPage(managerUser);

    const oversized = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [oversized] } });

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Logo file exceeds the 2 MB maximum upload size'));
    expect(mockUploadMutateAsync).not.toHaveBeenCalled();
  });

  it('offers Replace and Remove once a logo exists, and confirms before removing', async () => {
    mockCompanySettingsData.value = { ...mockCompanySettingsData.value, hasLogo: true };
    mockRemoveMutateAsync.mockResolvedValueOnce({ settings: { ...mockCompanySettingsData.value, hasLogo: false } });
    renderSettingsPage(managerUser);

    expect(screen.queryByRole('button', { name: 'Replace Logo' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    // A confirmation modal must appear — removal is not one click. Its own confirmation copy
    // proves the modal actually opened, not just that a second "Remove" button exists somewhere.
    expect(mockRemoveMutateAsync).not.toHaveBeenCalled();
    await screen.findByText(/Remove the company logo\?/i);

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[removeButtons.length - 1]!);

    await waitFor(() => expect(mockRemoveMutateAsync).toHaveBeenCalled());
  });

  it('does not render any settings:manage-gated mutation control for a read-only user', () => {
    mockCompanySettingsData.value = { ...mockCompanySettingsData.value, hasLogo: true };
    renderSettingsPage(readOnlyUser);
    expect(screen.queryByRole('button', { name: 'Replace Logo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});
