// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectSite } from '@/hooks/use-project-sites';

/**
 * Post-Checkpoint-1A UAT Stabilization — regression coverage for the reported "Add Project Site
 * modal retains prior site values" defect, targeting `SiteFormModal` directly (exported from
 * `project-sites-page.tsx` for exactly this purpose) rather than the full page — the create/edit
 * reset lifecycle lives entirely inside this one component, independent of the page's own list/
 * dropdown wiring, and the *end-to-end* page-level flow (create → Add another → close → Edit →
 * close → Create again) is covered by a real-browser Playwright spec instead
 * (`tests/e2e/specs/18-project-site-form-reset.spec.ts`), which doesn't share jsdom's own
 * Radix-DropdownMenu/pointer-event limitations.
 *
 * Root cause: the create-mode instance used to be a single, unconditionally-mounted instance for
 * the whole life of the page — `useState(site?.name ?? '')` only ever evaluates on first mount, so
 * nothing ever reset it across close/reopen. The fix makes `ProjectSitesPage` conditionally mount
 * it (`{createOpen && <SiteFormModal .../>}`) — a fresh, blank instance every time — plus an
 * explicit `resetForm()` for "Add another," which must blank the *same* still-open instance
 * (a remount alone can't cover that case). See `SiteFormModal`'s own doc comment for the full
 * root-cause writeup.
 */

const existingSite: ProjectSite = {
  id: 'site-1',
  name: 'ABL City Region Lahore',
  address: 'Lahore',
  unitLabel: 'Branch',
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

const createdSite: ProjectSite = {
  id: 'site-2',
  name: 'Site Alpha',
  address: '123 Alpha St',
  unitLabel: 'Department',
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

// jsdom has no real ResizeObserver — Radix's Checkbox (the "Add another" control) reads its own
// size via `@radix-ui/react-use-size`, which needs one to exist at all, same as the grid tests'
// own identical stub (`payroll-entry-grid.test.tsx`).
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = MockResizeObserver;

const apiRequestMock = vi.fn();

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return {
    ...actual,
    apiRequest: (...args: Parameters<typeof actual.apiRequest>) => apiRequestMock(...args),
  };
});

const { SiteFormModal } = await import('./project-sites-page');

function formValues() {
  return {
    name: (document.querySelector('#site-name') as HTMLInputElement | null)?.value ?? '',
    unitLabel: (document.querySelector('#site-unit-label') as HTMLInputElement | null)?.value ?? '',
    address: (document.querySelector('#site-address') as HTMLInputElement | null)?.value ?? '',
  };
}

function renderModal(props: { open: boolean; onOpenChange: (open: boolean) => void; site?: ProjectSite }) {
  apiRequestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && path === '/api/v1/sites') return Promise.resolve({ site: createdSite });
    if (method === 'PATCH' && path.startsWith('/api/v1/sites/')) return Promise.resolve({ site: existingSite });
    return Promise.reject(new Error(`Unhandled apiRequest in test: ${method} ${path}`));
  });

  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SiteFormModal {...props} />
    </QueryClientProvider>,
  );
}

describe('SiteFormModal — create-form reset lifecycle (Post-Checkpoint-1A UAT Stabilization)', () => {
  afterEach(() => cleanup());

  it('a freshly-mounted create instance (no `site` prop) opens blank', () => {
    renderModal({ open: true, onOpenChange: vi.fn() });
    expect(formValues()).toEqual({ name: '', unitLabel: 'Branch', address: '' });
    expect(screen.getByRole('heading', { name: 'New Project Site' })).not.toBeNull();
  });

  it('"Add another" clears the form immediately and keeps the modal open — never shows the just-created site', async () => {
    renderModal({ open: true, onOpenChange: vi.fn() });

    fireEvent.change(screen.getByLabelText('Site name'), { target: { value: createdSite.name } });
    fireEvent.change(screen.getByLabelText('Unit label'), { target: { value: createdSite.unitLabel } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: createdSite.address! } });
    fireEvent.click(screen.getByText('Add another after this one'));
    fireEvent.click(screen.getByRole('button', { name: /Create & add another/ }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('/api/v1/sites', expect.objectContaining({ method: 'POST' })));
    // Same instance, still open, but blank again — never the site that was just created.
    await waitFor(() => expect(formValues()).toEqual({ name: '', unitLabel: 'Branch', address: '' }));
    expect(screen.getByRole('heading', { name: 'New Project Site' })).not.toBeNull();
  });

  it('without "Add another" checked, a successful create requests close (never leaves stale values behind for the next open)', async () => {
    const onOpenChange = vi.fn();
    renderModal({ open: true, onOpenChange });

    fireEvent.change(screen.getByLabelText('Site name'), { target: { value: createdSite.name } });
    fireEvent.click(screen.getByRole('button', { name: 'Create site' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('an edit instance (`site` prop set) is seeded from that site’s own real values, not blank', () => {
    renderModal({ open: true, onOpenChange: vi.fn(), site: existingSite });
    expect(formValues()).toEqual({ name: existingSite.name, unitLabel: existingSite.unitLabel, address: existingSite.address });
    expect(screen.getByRole('heading', { name: 'Edit Project Site' })).not.toBeNull();
    // Edit never offers "Add another" — editing is always about exactly one already-selected site.
    expect(screen.queryByText('Add another after this one')).toBeNull();
  });

  it('a fresh create instance mounted after an edit instance unmounts is blank, never leaking the edited site’s values', () => {
    const { unmount } = renderModal({ open: true, onOpenChange: vi.fn(), site: existingSite });
    expect(formValues().name).toBe(existingSite.name);
    unmount();

    renderModal({ open: true, onOpenChange: vi.fn() });
    expect(formValues()).toEqual({ name: '', unitLabel: 'Branch', address: '' });
  });
});
