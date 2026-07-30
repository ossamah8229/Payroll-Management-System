// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Phase 7C — Login page logo fallback. `useSession`/`useLogin` are mocked to controlled values
 * (this codebase's own established pattern) so this exercises only the page's own logo/fallback
 * and submit behavior, never a real backend. Real image-loading behavior against a live backend is
 * Playwright's job.
 */

const mockLoginMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-session', () => ({
  useSession: () => ({ data: null, isLoading: false }),
  useLogin: () => ({ mutateAsync: mockLoginMutateAsync, isPending: false }),
}));

vi.mock('@/hooks/use-company-settings', () => ({
  COMPANY_LOGO_UI_URL: 'http://backend.test/api/v1/settings/company/logo/ui',
}));

const { LoginPage } = await import('./login-page');

function renderLoginPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Login page — company logo fallback', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('attempts to load the real logo image', () => {
    renderLoginPage();
    const img = screen.getByAltText('Company logo') as HTMLImageElement;
    expect(img.src).toBe('http://backend.test/api/v1/settings/company/logo/ui');
  });

  it('falls back to the placeholder when the logo image fails to load (no logo set, or the request errors)', async () => {
    renderLoginPage();
    const img = screen.getByAltText('Company logo');
    fireEvent.error(img);

    await waitFor(() => expect(screen.queryByAltText('Company logo')).toBeNull());
    // The building-icon placeholder remains present so the login card layout never collapses.
    expect(document.querySelector('svg')).not.toBeNull();
  });

  it('still submits the login form after a logo load failure — the logo can never block login', async () => {
    mockLoginMutateAsync.mockResolvedValueOnce(undefined);
    renderLoginPage();

    fireEvent.error(screen.getByAltText('Company logo'));
    await waitFor(() => expect(screen.queryByAltText('Company logo')).toBeNull());

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@test.local' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'CorrectHorseBattery1!' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(mockLoginMutateAsync).toHaveBeenCalled());
  });
});
