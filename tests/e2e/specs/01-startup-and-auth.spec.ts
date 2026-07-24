import { test, expect, login } from '../fixtures/auth';
import { MASTER_ADMIN_EMAIL, MASTER_ADMIN_PASSWORD, BACKEND_URL } from '../setup/config';

test.describe('Application startup and authentication', () => {
  test('backend health succeeds', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/health`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('frontend loads and redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL((url) => url.pathname === '/login');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('login succeeds and the authenticated shell renders', async ({ page }) => {
    await login(page, MASTER_ADMIN_EMAIL, MASTER_ADMIN_PASSWORD);

    await expect(page).toHaveURL('/');
    // The app shell (sidebar + topbar) — not just the page content — is what proves this is a
    // real authenticated render, not merely a URL change.
    await expect(page.locator('aside nav')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
  });

  test('logout succeeds and returns to a genuinely unauthenticated state', async ({ authenticatedPage: page }) => {
    // "MU" — the seeded Master User account's own initials (Terminology audit, Corrections
    // Workflow Redesign / RBAC Consistency Completion checkpoint: the seeded display name changed
    // from "Master Admin" to "Master User"), rendered both in the sidebar's own (non-interactive)
    // footer and the topbar's avatar dropdown trigger — `getByRole('button', ...)` is the one of
    // the two that's actually clickable.
    await page.getByRole('button', { name: 'MU' }).click();
    await page.getByText('Log out').click();

    await page.waitForURL((url) => url.pathname === '/login');

    // Confirm this isn't just a client-side route change — the session is really gone
    // server-side. Targets the backend directly — `vite preview` (serving the frontend) has no
    // `/api` proxy, unlike `vite dev`'s own dev-only one (`vite.config.ts`).
    const meRes = await page.request.get(`${BACKEND_URL}/api/v1/auth/me`);
    expect(meRes.status()).toBe(401);
  });
});
